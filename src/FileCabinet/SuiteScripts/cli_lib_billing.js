/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * File:      cli_lib_billing.js
 * Purpose:   Single source of truth for lease billing math.
 *            Used by cli_ue_contract_create.js and cli_ue_billing_update.js
 *            so CREATE and EDIT can never disagree.
 *
 * Rules implemented here:
 *  1. A "contract month" runs anniversary to anniversary (e.g. 1/19 to 2/18).
 *  2. A partial month is prorated over THAT contract month's own day count.
 *     Therefore the contract total is the same at any billing frequency.
 *  3. Master totals (item QTY and item AMOUNT per line) are computed first.
 *  4. Succeeding bills are a breakdown of the master totals. The LAST period
 *     is a balancing figure (master total minus running total), never computed.
 *  5. Works for one or many item lines (units). Each line has its own rate.
 */
define(['N/error', 'N/log', 'N/record', 'N/runtime'], (error, log, record, runtime) => {

    const BILL_TYPE = 'customrecord_cli_billing_schedule';

    // Payment Terms internal ID -> months per billing period.
    // Internal IDs differ per account. Change them HERE ONLY.
    const TERMS_BILLING_MONTHS = {
        '5': 1,   // Monthly
        '6': 3,   // Quarterly
        '4': 6,   // Semi-Annual
        '1': 12   // Annual
    };

    // ==========================================
    // BASIC HELPERS
    // ==========================================

    const round2 = value =>
        Math.round((value + Number.EPSILON) * 100) / 100;

    // NetSuite keeps only 5 decimals on the item line quantity
    const roundQty = value =>
        Math.round((value + Number.EPSILON) * 1e5) / 1e5;

    // Log first, then throw, so every validation failure is traceable
    const fail = (name, message) => {
        log.error({ title: name, details: message });
        throw error.create({ name, message, notifyOff: false });
    };

    // ==========================================
    // DATE HELPERS
    // ==========================================

    // Same day-of-month N months later, clamped to month end (Jan 31 + 1 = Feb 28)
    const addContractMonths = (date, months) => {
        const result = new Date(date.getFullYear(), date.getMonth() + months, 1);
        const lastDay = new Date(
            result.getFullYear(), result.getMonth() + 1, 0
        ).getDate();
        result.setDate(Math.min(date.getDate(), lastDay));
        return result;
    };

    const addDays = (date, days) => {
        const result = new Date(date);
        result.setDate(result.getDate() + days);
        return result;
    };

    const sameDate = (a, b) =>
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate();

    // Inclusive day count (start and end both counted)
    const countDays = (start, end) => {
        const a = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
        const b = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
        return Math.round((b - a) / 86400000) + 1;
    };

    // If the end date falls exactly on an anniversary (e.g. 1/1/2026 to 1/1/2027),
    // the last covered day is the day before.
    const getEffectiveEndDate = (start, end) => {
        const months =
            (end.getFullYear() - start.getFullYear()) * 12 +
            end.getMonth() - start.getMonth();

        if (months > 0 && sameDate(addContractMonths(start, months), end)) {
            return addDays(end, -1);
        }
        return new Date(end);
    };

    const countMonths = (start, effectiveEnd) => {
        let months = 0;
        while (addContractMonths(start, months) <= effectiveEnd) months++;
        return months;
    };

    // ==========================================
    // PAYMENT TERMS
    // ==========================================

    const getBillingMonths = terms => {
        const months = TERMS_BILLING_MONTHS[String(terms)];
        if (!months) fail('INVALID_PAYMENT_TERMS', 'Unsupported Payment Terms: ' + terms);
        return months;
    };

    // ==========================================
    // READ MONTHLY RATES FROM ITEM LINES
    // divisor = 1 on CREATE (entered rate is monthly)
    // divisor = billing months when reading a saved SO (rate is term-based)
    // ==========================================

    const readMonthlyRates = (rec, divisor) => {
        const rates = [];
        const lineCount = rec.getLineCount({ sublistId: 'item' });

        for (let i = 0; i < lineCount; i++) {
            const rate = Number(
                rec.getSublistValue({ sublistId: 'item', fieldId: 'rate', line: i })
            ) || 0;

            // 5 decimals matches the rate field and removes float noise
            rates.push(Number((rate / divisor).toFixed(5)));
        }

        log.debug({
            title: 'readMonthlyRates',
            details: { divisor, rates }
        });

        return rates;
    };

    // ==========================================
    // VALIDATE HEADER INPUTS
    // ==========================================

    const readInputs = rec => {
        const startValue = rec.getValue({ fieldId: 'startdate' });
        const endValue = rec.getValue({ fieldId: 'enddate' });

        if (!startValue || !endValue) {
            fail('MISSING_DATES', 'Contract start and end dates are required.');
        }

        const start = new Date(startValue);
        const end = new Date(endValue);

        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
            fail('INVALID_DATE_RANGE', 'Invalid contract dates.');
        }

        const billingMonths = getBillingMonths(rec.getValue({ fieldId: 'terms' }));
        const billingType = String(rec.getValue({ fieldId: 'custbody_cli_billing_type' }));
        const netDaysValue = rec.getValue({ fieldId: 'custbody_cli_net_days' });
        const netDays = Number(netDaysValue);

        if (!['1', '2', '3'].includes(billingType)) {
            fail('INVALID_BILLING_TYPE', 'Select a valid Billing Type.');
        }

        // Billing type 3 = Net Days, so Net Days is mandatory
        if (
            billingType === '3' &&
            (netDaysValue === '' || netDaysValue == null ||
             !Number.isInteger(netDays) || netDays <= 0)
        ) {
            fail('INVALID_NET_DAYS', 'Net Days must be a positive whole number.');
        }

        return {
            start,
            end,
            effectiveEnd: getEffectiveEndDate(start, end),
            billingMonths,
            billingType,
            netDays
        };
    };

    // ==========================================
    // GENERATE SCHEDULE (CORE)
    //
    // monthlyRates = one monthly rate per item line.
    //
    // Step 1: split the contract into billing periods and measure each period
    //         in "contract months" (partial month = coveredDays / monthDays).
    // Step 2: compute MASTER totals (qty and amount per line).
    // Step 3: break the masters down per period. The last period is the
    //         balancing figure, so everything adds up exactly.
    // ==========================================

    const generateSchedule = (rec, monthlyRates) => {

        const inputs = readInputs(rec);
        const { start, effectiveEnd, billingMonths, billingType, netDays } = inputs;

        if (!monthlyRates.length) {
            fail('NO_ITEM_LINES', 'At least one item line is required.');
        }

        // ----- Step 1: periods and their month fractions -----
        const periods = [];
        let totalMonths = 0;

        for (
            let i = 0;
            addContractMonths(start, i) <= effectiveEnd;
            i += billingMonths
        ) {
            const periodStart = addContractMonths(start, i);

            const fullPeriodEnd = addDays(
                addContractMonths(start, i + billingMonths), -1
            );

            const periodEnd =
                fullPeriodEnd > effectiveEnd ? new Date(effectiveEnd) : fullPeriodEnd;

            // Sum each contract month inside this billing period
            let monthFraction = 0;

            for (let m = 0; m < billingMonths; m++) {
                const monthStart = addContractMonths(start, i + m);

                // Contract ended before this month began
                if (monthStart > effectiveEnd) break;

                const monthEnd = addDays(
                    addContractMonths(start, i + m + 1), -1
                );

                const coveredEnd = monthEnd < effectiveEnd ? monthEnd : effectiveEnd;

                // Full month gives exactly 1. Partial month gives covered / own days
                monthFraction +=
                    countDays(monthStart, coveredEnd) / countDays(monthStart, monthEnd);
            }

            // Due date by Billing Type: 1 Advance, 2 Arrears, 3 Net Days
            let dueDate;
            if (billingType === '1') dueDate = new Date(periodStart);
            else if (billingType === '2') dueDate = new Date(periodEnd);
            else dueDate = addDays(periodStart, netDays);

            totalMonths += monthFraction;

            periods.push({
                periodNumber: periods.length + 1,
                periodFrom: periodStart,
                periodTo: periodEnd,
                dueDate,
                monthFraction
            });
        }

        // ----- Step 2: MASTER totals -----
        // Quantity is date based, so it is the same for every item line
        const totalQty = roundQty(totalMonths / billingMonths);

        const lines = monthlyRates.map(monthlyRate => ({
            monthlyRate,
            termRate: Number((monthlyRate * billingMonths).toFixed(5)),
            amount: round2(monthlyRate * totalMonths),   // master amount per line
            periodAmounts: []
        }));

        // ----- Step 3: break masters down, last period balances -----
        let runningQty = 0;
        const runningAmounts = lines.map(() => 0);

        periods.forEach((period, p) => {

            const isLast = p === periods.length - 1;

            // Quantity
            if (isLast) {
                // Balancing figure: master qty minus running total
                period.quantity = roundQty(totalQty - runningQty);
            } else {
                period.quantity = roundQty(period.monthFraction / billingMonths);
                runningQty = roundQty(runningQty + period.quantity);
            }

            // Amount per line, then summed for the period
            let periodAmount = 0;

            lines.forEach((line, l) => {
                const lineAmount = isLast
                    ? round2(line.amount - runningAmounts[l])
                    : round2(line.monthlyRate * period.monthFraction);

                runningAmounts[l] = round2(runningAmounts[l] + lineAmount);
                line.periodAmounts.push(lineAmount);
                periodAmount = round2(periodAmount + lineAmount);
            });

            period.billingAmount = periodAmount;

            log.debug({
                title: 'Schedule period',
                details: {
                    period: period.periodNumber,
                    from: period.periodFrom,
                    to: period.periodTo,
                    isLastBalancing: isLast,
                    monthFraction: period.monthFraction,
                    quantity: period.quantity,
                    billingAmount: period.billingAmount,
                    runningQty
                }
            });
        });

        const totalAmount = round2(lines.reduce((sum, l) => sum + l.amount, 0));

        const result = {
            schedule: periods,
            lines,
            billingMonths,
            totals: {
                monthlyRental: round2(monthlyRates.reduce((s, r) => s + r, 0)),
                contractMonths: countMonths(start, effectiveEnd),
                totalQty,
                totalAmount
            }
        };

        log.audit({
            title: 'Billing schedule generated',
            details: {
                periods: periods.length,
                lines: lines.length,
                billingMonths,
                totalQty,
                totalAmount
            }
        });

        return result;
    };

    // ==========================================
    // WRITE MASTER VALUES TO ITEM LINES (beforeSubmit)
    // ==========================================

    const applyItemLines = (so, calc) => {
        const lineCount = so.getLineCount({ sublistId: 'item' });

        if (lineCount !== calc.lines.length) {
            fail('ITEM_LINE_MISMATCH', 'Item line count changed during calculation.');
        }

        calc.lines.forEach((line, i) => {
            so.setSublistValue({
                sublistId: 'item', fieldId: 'quantity', line: i,
                value: calc.totals.totalQty
            });
            so.setSublistValue({
                sublistId: 'item', fieldId: 'rate', line: i,
                value: line.termRate
            });
            // Master amount wins. Qty x Rate may differ by a few cents.
            so.setSublistValue({
                sublistId: 'item', fieldId: 'amount', line: i,
                value: line.amount
            });

            log.debug({
                title: 'Item line updated',
                details: {
                    line: i,
                    quantity: calc.totals.totalQty,
                    rate: line.termRate,
                    amount: line.amount
                }
            });
        });
    };

    // ==========================================
    // WRITE SUMMARY BODY FIELDS (beforeSubmit)
    // ==========================================

    const setSummaryFields = (so, calc) => {
        const first = calc.schedule[0];

        so.setValue({ fieldId: 'custbody_cli_monthly_rental', value: calc.totals.monthlyRental });
        so.setValue({ fieldId: 'custbody_cli_contract_months', value: calc.totals.contractMonths });
        so.setValue({ fieldId: 'custbody_cli_contract_total', value: calc.totals.totalAmount });
        so.setValue({ fieldId: 'custbody_cli_billing_amount', value: first.billingAmount });
        so.setValue({ fieldId: 'custbody_cli_covered_period_from', value: first.periodFrom });
        so.setValue({ fieldId: 'custbody_cli_covered_period_to', value: first.periodTo });
        so.setValue({ fieldId: 'custbody_cli_due_date', value: first.dueDate });
    };

    // ==========================================
    // CREATE SUCCEEDING BILLING RECORDS (afterSubmit)
    // ==========================================

    const createBillingRecords = (salesOrderId, schedule) => {

        schedule.forEach(period => {
            const bill = record.create({ type: BILL_TYPE, isDynamic: false });

            bill.setValue({
                fieldId: 'name',
                value: `SO-${salesOrderId}-Period-${period.periodNumber}`
            });
            bill.setValue({ fieldId: 'custrecord_cli_bs_sales_order', value: Number(salesOrderId) });
            bill.setValue({ fieldId: 'custrecord_cli_bs_period', value: period.periodNumber });
            bill.setValue({ fieldId: 'custrecord_cli_bs_from', value: period.periodFrom });
            bill.setValue({ fieldId: 'custrecord_cli_bs_to', value: period.periodTo });
            bill.setValue({ fieldId: 'custrecord_cli_bs_amount', value: period.billingAmount });
            bill.setValue({ fieldId: 'custrecord_cli_bs_due_date', value: period.dueDate });
            bill.setValue({ fieldId: 'custrecord_cli_quantity', value: period.quantity });

            const billId = bill.save();

            log.debug({
                title: 'Billing period created',
                details: {
                    salesOrderId,
                    billId,
                    period: period.periodNumber,
                    amount: period.billingAmount,
                    quantity: period.quantity
                }
            });
        });

        // Governance check: many periods x save cost can add up
        log.audit({
            title: 'Billing records created',
            details: {
                salesOrderId,
                periods: schedule.length,
                remainingUsage: runtime.getCurrentScript().getRemainingUsage()
            }
        });
    };

    // ==========================================
    // VERIFY SAVED ITEM LINES AGAINST SCHEDULE (afterSubmit)
    // Record is already saved here, so we log instead of throwing.
    // ==========================================

    const verifySavedLines = (so, calc) => {
        const lineCount = so.getLineCount({ sublistId: 'item' });
        let savedAmount = 0;
        let savedQty = 0;

        for (let i = 0; i < lineCount; i++) {
            savedAmount += Number(
                so.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: i })
            ) || 0;
            savedQty = Number(
                so.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i })
            ) || 0;
        }

        const scheduleAmount = round2(
            calc.schedule.reduce((sum, p) => sum + p.billingAmount, 0)
        );

        const amountOk = Math.abs(round2(savedAmount) - scheduleAmount) < 0.005;
        const qtyOk = Math.abs(savedQty - calc.totals.totalQty) < 0.000005;

        const details = {
            savedAmount: round2(savedAmount),
            scheduleAmount,
            savedQty,
            scheduleQty: calc.totals.totalQty
        };

        if (amountOk && qtyOk) {
            log.debug({ title: 'Item vs schedule check: OK', details });
        } else {
            log.error({ title: 'Item vs schedule MISMATCH', details });
        }

        return amountOk && qtyOk;
    };

    return {
        BILL_TYPE,
        round2,
        roundQty,
        fail,
        getBillingMonths,
        readMonthlyRates,
        generateSchedule,
        applyItemLines,
        setSummaryFields,
        createBillingRecords,
        verifySavedLines
    };
});
