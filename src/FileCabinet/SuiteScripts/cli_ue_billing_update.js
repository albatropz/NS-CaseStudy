
/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 *
 * EDIT ONLY
 * Recalculate Sales Order items and billing schedule
 * when Payment Terms change.
 */
define([
    'N/record',
    'N/search',
    'N/error',
    'N/format'
], (record, search, error, format) => {

    const BILL_TYPE = 'customrecord_cli_billing_schedule';

    const round2 = value =>
        Math.round((value + Number.EPSILON) * 100) / 100;

    const fail = (name, message) => {
        throw error.create({
            name,
            message,
            notifyOff: false
        });
    };

    // ==========================================
    // DATE HELPERS
    // ==========================================

    const addContractMonths = (date, months) => {
        const result = new Date(
            date.getFullYear(),
            date.getMonth() + months,
            1
        );

        const lastDay = new Date(
            result.getFullYear(),
            result.getMonth() + 1,
            0
        ).getDate();

        result.setDate(
            Math.min(date.getDate(), lastDay)
        );

        return result;
    };

    const addDays = (date, days) => {
        const result = new Date(date);

        result.setDate(
            result.getDate() + days
        );

        return result;
    };

    const sameDate = (a, b) =>
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate();

    const countDays = (start, end) => {
        const a = Date.UTC(
            start.getFullYear(),
            start.getMonth(),
            start.getDate()
        );

        const b = Date.UTC(
            end.getFullYear(),
            end.getMonth(),
            end.getDate()
        );

        return Math.round((b - a) / 86400000) + 1;
    };

    const getEffectiveEndDate = (start, end) => {
        const months =
            (end.getFullYear() - start.getFullYear()) * 12 +
            end.getMonth() - start.getMonth();

        if (
            months > 0 &&
            sameDate(addContractMonths(start, months), end)
        ) {
            return addDays(end, -1);
        }

        return new Date(end);
    };

    const countMonths = (start, end) => {
        let months = 0;

        while (
            addContractMonths(start, months) <= end
        ) {
            months++;
        }

        return months;
    };

    // ==========================================
    // PAYMENT TERMS
    // ==========================================

    const getBillingMonths = paymentTerms => {
        switch (String(paymentTerms)) {
            case '5': return 1;  // Monthly
            case '6': return 3;  // Quarterly
            case '4': return 6;  // Semiannual
            case '1': return 12; // Annual

            default:
                fail(
                    'INVALID_PAYMENT_TERMS',
                    'Unsupported Payment Terms.'
                );
        }
    };

    // ==========================================
    // PRORATED AMOUNT
    // ==========================================

    const calculateProratedAmount = (
        start,
        end,
        monthlyRate
    ) => {
        let amount = 0;
        let current = new Date(start);

        while (current <= end) {
            const monthEnd = new Date(
                current.getFullYear(),
                current.getMonth() + 1,
                0
            );

            const segmentEnd =
                monthEnd < end ? monthEnd : end;

            amount +=
                countDays(current, segmentEnd) /
                monthEnd.getDate() *
                monthlyRate;

            current = addDays(segmentEnd, 1);
        }

        return amount;
    };

    // ==========================================
    // BILLING AMOUNT CALCULATOR
    // ==========================================

    const calculateBillingAmount = (
        contractStart,
        periodStart,
        periodEnd,
        monthlyRate,
        startMonthIndex,
        billingMonths
    ) => {
        let amount = 0;
        let currentStart = new Date(periodStart);

        for (let m = 0; m < billingMonths; m++) {
            const nextAnniversary = addContractMonths(
                contractStart,
                startMonthIndex + m + 1
            );

            const fullMonthEnd = addDays(
                nextAnniversary,
                -1
            );

            if (fullMonthEnd <= periodEnd) {
                amount += monthlyRate;
                currentStart = new Date(nextAnniversary);
            } else {
                if (currentStart <= periodEnd) {
                    amount += calculateProratedAmount(
                        currentStart,
                        periodEnd,
                        monthlyRate
                    );
                }

                break;
            }
        }

        return round2(amount);
    };

    // ==========================================
    // GENERATE BILLING SCHEDULE
    // CHANGED: Accept original monthly rental
    // ==========================================

    function generateBillingSchedule(so, monthlyRental) {
        const startValue = so.getValue({
            fieldId: 'startdate'
        });

        const endValue = so.getValue({
            fieldId: 'enddate'
        });

        if (!startValue || !endValue) {
            fail(
                'MISSING_DATES',
                'Contract dates are required.'
            );
        }

        const start = new Date(startValue);
        const end = new Date(endValue);

        if (
            Number.isNaN(start.getTime()) ||
            Number.isNaN(end.getTime()) ||
            end < start
        ) {
            fail(
                'INVALID_DATE_RANGE',
                'Invalid contract dates.'
            );
        }

        const effectiveEnd = getEffectiveEndDate(
            start,
            end
        );

        const contractMonths = countMonths(
            start,
            effectiveEnd
        );

        const billingMonths = getBillingMonths(
            so.getValue({ fieldId: 'terms' })
        );

        const billingType = String(
            so.getValue({
                fieldId: 'custbody_cli_billing_type'
            })
        );

        const netDaysValue = so.getValue({
            fieldId: 'custbody_cli_net_days'
        });

        const netDays = Number(netDaysValue);

        if (!['1', '2', '3'].includes(billingType)) {
            fail(
                'INVALID_BILLING_TYPE',
                'Invalid Billing Type.'
            );
        }

        if (
            billingType === '3' &&
            (
                netDaysValue == null ||
                netDaysValue === '' ||
                !Number.isInteger(netDays) ||
                netDays <= 0
            )
        ) {
            fail(
                'INVALID_NET_DAYS',
                'Net Days must be a positive whole number.'
            );
        }

        const billingSchedule = [];

        for (
            let i = 0;
            addContractMonths(start, i) <= effectiveEnd;
            i += billingMonths
        ) {
            const periodStart = addContractMonths(
                start,
                i
            );

            const periodEnd = addDays(
                addContractMonths(
                    start,
                    i + billingMonths
                ),
                -1
            );

            const actualEnd =
                periodEnd > effectiveEnd
                    ? new Date(effectiveEnd)
                    : periodEnd;

            const billingAmount = calculateBillingAmount(
                start,
                periodStart,
                actualEnd,
                monthlyRental,
                i,
                billingMonths
            );

            // Quantity for the selected payment term
            const fullTermRate =
                monthlyRental * billingMonths;

            const isFullPeriod = sameDate(
                actualEnd,
                periodEnd
            );

            const quantity = isFullPeriod
                ? 1
                : (
                    fullTermRate !== 0
                        ? billingAmount / fullTermRate
                        : 0
                );

            // Billing due date
            let dueDate;

            if (billingType === '1') {
                dueDate = new Date(periodStart);
            } else if (billingType === '2') {
                dueDate = new Date(actualEnd);
            } else {
                dueDate = addDays(
                    periodStart,
                    netDays
                );
            }

            billingSchedule.push({
                periodNumber: billingSchedule.length + 1,
                periodFrom: periodStart,
                periodTo: actualEnd,
                billingAmount,
                quantity,
                dueDate
            });
        }

        return {
            billingSchedule,
            monthlyRental,
            contractMonths,
            billingMonths
        };
    }

    // ==========================================
    // GET EXISTING BILLING RECORDS
    // ==========================================

    function getExistingBillingRecords(salesOrderId) {
        const bills = [];

        search.create({
            type: BILL_TYPE,
            filters: [
                [
                    'custrecord_cli_bs_sales_order',
                    'anyof',
                    salesOrderId
                ]
            ],
            columns: [
                'internalid',
                'custrecord_cli_bs_due_date',
                'custrecord_cli_bs_status'
            ]
        }).run().each(result => {
            bills.push({
                id: result.id,
                dueDate: result.getValue({
                    name: 'custrecord_cli_bs_due_date'
                }),
                status: result.getValue({
                    name: 'custrecord_cli_bs_status'
                })
            });

            return true;
        });

        return bills;
    }

    // ==========================================
    // VALIDATE EXISTING BILLING RECORDS
    // ==========================================

    function validateExistingBills(bills) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (const bill of bills) {
            if (!bill.dueDate) {
                fail(
                    'MISSING_BILL_DUE_DATE',
                    'Existing billing record has no due date.'
                );
            }

            let dueDate;

            try {
                dueDate = format.parse({
                    value: bill.dueDate,
                    type: format.Type.DATE
                });
            } catch (e) {
                fail(
                    'INVALID_BILL_DUE_DATE',
                    'Cannot parse existing billing due date.'
                );
            }

            if (
                !(dueDate instanceof Date) ||
                Number.isNaN(dueDate.getTime())
            ) {
                fail(
                    'INVALID_BILL_DUE_DATE',
                    'Existing billing record has an invalid due date.'
                );
            }

            dueDate.setHours(0, 0, 0, 0);

            if (dueDate < today) {
                fail(
                    'PAST_DUE_BILLING_RECORD',
                    'At least one billing period is past due. ' +
                    'Regeneration stopped.'
                );
            }

            // Safety: block processed or unverified statuses
            if (
                bill.status !== '' &&
                bill.status != null
            ) {
                fail(
                    'BILL_STATUS_REVIEW_REQUIRED',
                    'Billing record ' + bill.id +
                    ' has a status. Review status mapping ' +
                    'before regeneration.'
                );
            }
        }
    }

    // ==========================================
    // ADDED: RECOVER MONTHLY ITEM RATES
    // ==========================================

    function getMonthlyRatesFromOldSO(
        oldSO,
        oldBillingMonths
    ) {
        const rates = [];

        const lineCount = oldSO.getLineCount({
            sublistId: 'item'
        });

        for (let i = 0; i < lineCount; i++) {
            const oldTermRate = Number(
                oldSO.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'rate',
                    line: i
                })
            ) || 0;

            // CHANGED: Recover monthly rental rate
            const monthlyRate =
                oldTermRate / oldBillingMonths;

            rates.push(monthlyRate);
        }

        return rates;
    }

    // ==========================================
    // ADDED: UPDATE SALES ORDER SUMMARY
    // ==========================================

    function setSalesOrderSummary(so, data) {
        const schedule = data.billingSchedule;

        if (!schedule.length) {
            return;
        }

        const first = schedule[0];

        const totalContractValue = round2(
            schedule.reduce(
                (sum, period) =>
                    sum + period.billingAmount,
                0
            )
        );

        so.setValue({
            fieldId: 'custbody_cli_monthly_rental',
            value: data.monthlyRental
        });

        so.setValue({
            fieldId: 'custbody_cli_contract_months',
            value: data.contractMonths
        });

        so.setValue({
            fieldId: 'custbody_cli_contract_total',
            value: totalContractValue
        });

        so.setValue({
            fieldId: 'custbody_cli_billing_amount',
            value: first.billingAmount
        });

        so.setValue({
            fieldId: 'custbody_cli_covered_period_from',
            value: first.periodFrom
        });

        so.setValue({
            fieldId: 'custbody_cli_covered_period_to',
            value: first.periodTo
        });

        so.setValue({
            fieldId: 'custbody_cli_due_date',
            value: first.dueDate
        });
    }

    // ==========================================
    // ADDED: BEFORE SUBMIT - EDIT ONLY
    // ==========================================

    function beforeSubmit(context) {
        if (
            context.type !== context.UserEventType.EDIT
        ) {
            return;
        }

        const oldSO = context.oldRecord;
        const newSO = context.newRecord;

        const oldTerms = oldSO.getValue({
            fieldId: 'terms'
        });

        const newTerms = newSO.getValue({
            fieldId: 'terms'
        });

        // Only run when Payment Terms change
        if (String(oldTerms) === String(newTerms)) {
            return;
        }

        const oldBillingMonths = getBillingMonths(
            oldTerms
        );

        const newBillingMonths = getBillingMonths(
            newTerms
        );

        const oldCount = oldSO.getLineCount({
            sublistId: 'item'
        });

        const newCount = newSO.getLineCount({
            sublistId: 'item'
        });

        if (oldCount !== newCount || newCount === 0) {
            fail(
                'ITEM_LINES_CHANGED',
                'Change Payment Terms separately from ' +
                'adding or removing item lines.'
            );
        }

        // Validate that item lines were not reordered
        for (let i = 0; i < newCount; i++) {
            const oldItem = String(
                oldSO.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'item',
                    line: i
                })
            );

            const newItem = String(
                newSO.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'item',
                    line: i
                })
            );

            if (oldItem !== newItem) {
                fail(
                    'ITEM_LINES_CHANGED',
                    'Do not reorder or replace item lines ' +
                    'while changing Payment Terms.'
                );
            }
        }

        // CHANGED: Validate before saving Sales Order
        const existingBills = getExistingBillingRecords(
            oldSO.id
        );

        validateExistingBills(existingBills);

        // Recover monthly rates using OLD payment terms
        const monthlyRates = getMonthlyRatesFromOldSO(
            oldSO,
            oldBillingMonths
        );

        const monthlyRental = monthlyRates.reduce(
            (sum, rate) => sum + rate,
            0
        );

        // Generate schedule using NEW payment terms
        const billingData = generateBillingSchedule(
            newSO,
            monthlyRental
        );

        const totalQuantity =
            billingData.billingSchedule.reduce(
                (sum, period) =>
                    sum + period.quantity,
                0
            );

        const totalAmount = round2(
            billingData.billingSchedule.reduce(
                (sum, period) =>
                    sum + period.billingAmount,
                0
            )
        );

        // ======================================
        // UPDATE EXISTING ITEM LINES
        // ======================================

        let allocatedAmount = 0;

        for (let i = 0; i < newCount; i++) {
            const monthlyRate = monthlyRates[i];

            // CHANGED: Rate based on new Payment Terms
            const newRate =
                monthlyRate * newBillingMonths;

            // CHANGED: Full prorated amount per item
            const lineAmount =
                i === newCount - 1
                    ? round2(
                        totalAmount - allocatedAmount
                    )
                    : round2(
                        monthlyRental
                            ? totalAmount *
                              monthlyRate / monthlyRental
                            : 0
                    );

            allocatedAmount += lineAmount;

            // CHANGED: Quantity matches billing schedule
            newSO.setSublistValue({
                sublistId: 'item',
                fieldId: 'quantity',
                line: i,
                value: Math.round(
                    totalQuantity * 1e10
                ) / 1e10
            });

            // CHANGED: New term-based Rate
            newSO.setSublistValue({
                sublistId: 'item',
                fieldId: 'rate',
                line: i,
                value: newRate
            });

            // CHANGED: Full prorated Amount
            newSO.setSublistValue({
                sublistId: 'item',
                fieldId: 'amount',
                line: i,
                value: lineAmount
            });
        }

        // Update custom body fields
        setSalesOrderSummary(
            newSO,
            billingData
        );

        log.audit({
            title: 'Sales Order Payment Terms Updated',
            details: {
                salesOrderId: oldSO.id,
                oldTerms,
                newTerms,
                monthlyRental,
                totalQuantity,
                totalAmount
            }
        });
    }

    // ==========================================
    // CREATE BILLING RECORDS
    // ==========================================

    function createBillingRecords(
        salesOrderId,
        billingSchedule
    ) {
        billingSchedule.forEach((period, index) => {
            const bill = record.create({
                type: BILL_TYPE,
                isDynamic: false
            });

            bill.setValue({
                fieldId: 'name',
                value:
                    `SO-${salesOrderId}-Period-${index + 1}`
            });

            bill.setValue({
                fieldId: 'custrecord_cli_bs_sales_order',
                value: Number(salesOrderId)
            });

            bill.setValue({
                fieldId: 'custrecord_cli_bs_period',
                value: period.periodNumber
            });

            bill.setValue({
                fieldId: 'custrecord_cli_bs_from',
                value: period.periodFrom
            });

            bill.setValue({
                fieldId: 'custrecord_cli_bs_to',
                value: period.periodTo
            });

            bill.setValue({
                fieldId: 'custrecord_cli_bs_amount',
                value: period.billingAmount
            });

            bill.setValue({
                fieldId: 'custrecord_cli_bs_due_date',
                value: period.dueDate
            });

            bill.setValue({
                fieldId: 'custrecord_cli_quantity',
                value: period.quantity
            });

            bill.save();
        });
    }

    // ==========================================
    // DELETE EXISTING BILLING RECORDS
    // ==========================================

    function deleteExistingBillingRecords(bills) {
        bills.forEach(bill => {
            record.delete({
                type: BILL_TYPE,
                id: bill.id
            });
        });
    }

    // ==========================================
    // CHANGED: AFTER SUBMIT - EDIT ONLY
    // ==========================================

    function afterSubmit(context) {
        if (
            context.type !== context.UserEventType.EDIT
        ) {
            return;
        }

        const oldTerms = context.oldRecord.getValue({
            fieldId: 'terms'
        });

        const newTerms = context.newRecord.getValue({
            fieldId: 'terms'
        });

        if (String(oldTerms) === String(newTerms)) {
            return;
        }

        const so = context.newRecord;
        const salesOrderId = so.id;

        const newBillingMonths = getBillingMonths(
            newTerms
        );

        // CHANGED: Saved Rates are now term-based.
        // Convert them back into monthly rental rates.
        const lineCount = so.getLineCount({
            sublistId: 'item'
        });

        let monthlyRental = 0;

        for (let i = 0; i < lineCount; i++) {
            const termRate = Number(
                so.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'rate',
                    line: i
                })
            ) || 0;

            monthlyRental +=
                termRate / newBillingMonths;
        }

        // Generate schedule with correct monthly rental
        const billingData = generateBillingSchedule(
            so,
            monthlyRental
        );

        // Search and validate existing billing records
        const existingBills = getExistingBillingRecords(
            salesOrderId
        );

        validateExistingBills(existingBills);

        // Remove old unprocessed billing schedule
        deleteExistingBillingRecords(existingBills);

        // Create new billing schedule
        createBillingRecords(
            salesOrderId,
            billingData.billingSchedule
        );

        log.audit({
            title: 'Billing Schedule Regenerated',
            details: {
                salesOrderId,
                oldTerms,
                newTerms,
                monthlyRental,
                oldPeriods: existingBills.length,
                newPeriods:
                    billingData.billingSchedule.length
            }
        });
    }

    return {
        beforeSubmit,
        afterSubmit
    };
});
