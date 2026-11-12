
/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/error', 'N/record'], (error, record) => {

    const round2 = value =>
        Math.round((value + Number.EPSILON) * 100) / 100;

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

        return Math.round(
            (b - a) / 86400000
        ) + 1;
    };

    const getEffectiveEndDate = (start, end) => {

        const months =
            (end.getFullYear() - start.getFullYear()) * 12 +
            end.getMonth() - start.getMonth();

        if (
            months > 0 &&
            sameDate(
                addContractMonths(start, months),
                end
            )
        ) {
            return addDays(end, -1);
        }

        return new Date(end);
    };

    const countMonths = (start, effectiveEnd) => {

        let months = 0;

        while (
            addContractMonths(start, months) <= effectiveEnd
        ) {
            months++;
        }

        return months;
    };

    // ==========================================
    // PAYMENT TERMS HELPER
    // ==========================================

    const getBillingMonths = terms => {

        switch (String(terms)) {

            case '5':
                return 1;  // Monthly

            case '6':
                return 3;  // Quarterly

            case '4':
                return 6;  // Semi-Annual

            case '1':
                return 12; // Annual

            default:
                throw error.create({
                    name: 'INVALID_PAYMENT_TERMS',
                    message: 'Unsupported payment terms.',
                    notifyOff: false
                });
        }
    };

    // ==========================================
    // READ MONTHLY ITEM RATES
    // ==========================================

    const getMonthlyRates = (so, divisor) => {

        const rates = [];

        const lineCount = so.getLineCount({
            sublistId: 'item'
        });

        for (let i = 0; i < lineCount; i++) {

            const rate = Number(
                so.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'rate',
                    line: i
                })
            ) || 0;

            rates.push(rate / divisor);
        }

        return rates;
    };

    // ==========================================
    // CHANGED: BILLING SCHEDULE GENERATOR
    // ==========================================

    function generateBillingSchedule(so, monthlyRental) {

        const startDate = so.getValue({
            fieldId: 'startdate'
        });

        const endDate = so.getValue({
            fieldId: 'enddate'
        });

        if (!startDate || !endDate) {

            throw error.create({
                name: 'MISSING_DATES',
                message:
                    'Contract start and end dates are required.',
                notifyOff: false
            });
        }

        const start = new Date(startDate);
        const end = new Date(endDate);

        if (
            Number.isNaN(start.getTime()) ||
            Number.isNaN(end.getTime()) ||
            end < start
        ) {

            throw error.create({
                name: 'INVALID_DATE_RANGE',
                message: 'Invalid contract dates.',
                notifyOff: false
            });
        }

        const effectiveEnd = getEffectiveEndDate(
            start,
            end
        );

        const billingMonths = getBillingMonths(
            so.getValue({
                fieldId: 'terms'
            })
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

            throw error.create({
                name: 'INVALID_BILLING_TYPE',
                message: 'Select a valid Billing Type.',
                notifyOff: false
            });
        }

        if (
            billingType === '3' &&
            (
                netDaysValue === '' ||
                netDaysValue == null ||
                !Number.isInteger(netDays) ||
                netDays <= 0
            )
        ) {

            throw error.create({
                name: 'INVALID_NET_DAYS',
                message:
                    'Net Days must be a positive whole number.',
                notifyOff: false
            });
        }

        const schedule = [];

        // Rate for one complete billing period
        const termRate =
            monthlyRental * billingMonths;

        // Generate contract-based billing periods
        for (
            let i = 0;
            addContractMonths(start, i) <= effectiveEnd;
            i += billingMonths
        ) {

            const periodStart = addContractMonths(
                start,
                i
            );

            const fullPeriodEnd = addDays(
                addContractMonths(
                    start,
                    i + billingMonths
                ),
                -1
            );

            const periodEnd =
                fullPeriodEnd > effectiveEnd
                    ? new Date(effectiveEnd)
                    : fullPeriodEnd;

            // ======================================
            // CHANGED: DAY-BASED QUANTITY
            // ======================================

            const consumedDays = countDays(
                periodStart,
                periodEnd
            );

            const totalPeriodDays = countDays(
                periodStart,
                fullPeriodEnd
            );

            const quantity =
                consumedDays / totalPeriodDays;

            // ======================================
            // CHANGED: BILLING AMOUNT
            // ======================================

            const billingAmount = round2(
                quantity * termRate
            );

            // ======================================
            // DUE DATE
            // ======================================

            let dueDate;

            if (billingType === '1') {

                // Advance billing
                dueDate = new Date(periodStart);

            } else if (billingType === '2') {

                // Arrears billing
                dueDate = new Date(periodEnd);

            } else {

                // Net Days billing
                dueDate = addDays(
                    periodStart,
                    netDays
                );
            }

            schedule.push({

                periodNumber: schedule.length + 1,

                periodFrom: periodStart,

                periodTo: periodEnd,

                billingAmount: billingAmount,

                quantity: quantity,

                dueDate: dueDate
            });
        }

        return schedule;
    }

    // ==========================================
    // BEFORE SUBMIT
    // ==========================================

    function beforeSubmit(context) {

        if (
            context.type !==
            context.UserEventType.CREATE
        ) {
            return;
        }

        const so = context.newRecord;

        const billingMonths = getBillingMonths(
            so.getValue({
                fieldId: 'terms'
            })
        );

        // On CREATE, entered rates are monthly rates
        const monthlyRates = getMonthlyRates(
            so,
            1
        );

        const monthlyRental = monthlyRates.reduce(
            (sum, rate) => sum + rate,
            0
        );

        const schedule = generateBillingSchedule(
            so,
            monthlyRental
        );

        if (!schedule.length) return;

        // ======================================
        // TOTAL QUANTITY
        // ======================================

        const totalQuantity = schedule.reduce(
            (sum, period) =>
                sum + period.quantity,
            0
        );

        // ======================================
        // TOTAL CONTRACT AMOUNT
        // ======================================

        const totalContractValue = round2(
            schedule.reduce(
                (sum, period) =>
                    sum + period.billingAmount,
                0
            )
        );

        // ======================================
        // UPDATE SALES ORDER ITEM LINES
        // ======================================

        let allocatedAmount = 0;

        for (
            let i = 0;
            i < monthlyRates.length;
            i++
        ) {

            const monthlyRate = monthlyRates[i];

            const termRate =
                monthlyRate * billingMonths;

            const lineAmount =
                i === monthlyRates.length - 1
                    ? round2(
                        totalContractValue -
                        allocatedAmount
                    )
                    : round2(
                        monthlyRental
                            ? totalContractValue *
                              monthlyRate /
                              monthlyRental
                            : 0
                    );

            allocatedAmount += lineAmount;

            // CHANGED: Total prorated quantity
            so.setSublistValue({
                sublistId: 'item',
                fieldId: 'quantity',
                line: i,
                value: Math.round(
                    totalQuantity * 1e10
                ) / 1e10
            });

            // Rate based on payment terms
            so.setSublistValue({
                sublistId: 'item',
                fieldId: 'rate',
                line: i,
                value: termRate
            });

            // Total contract amount per item
            so.setSublistValue({
                sublistId: 'item',
                fieldId: 'amount',
                line: i,
                value: lineAmount
            });
        }

        // ======================================
        // FINANCIAL SUMMARY FIELDS
        // ======================================

        const start = new Date(
            so.getValue({
                fieldId: 'startdate'
            })
        );

        const effectiveEnd = getEffectiveEndDate(
            start,
            new Date(
                so.getValue({
                    fieldId: 'enddate'
                })
            )
        );

        const first = schedule[0];

        so.setValue({
            fieldId: 'custbody_cli_monthly_rental',
            value: monthlyRental
        });

        so.setValue({
            fieldId: 'custbody_cli_contract_months',
            value: countMonths(
                start,
                effectiveEnd
            )
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

        log.audit({
            title: 'Contract Billing Validated',
            details: {
                monthlyRental,
                billingMonths,
                totalQuantity,
                totalContractValue,
                periods: schedule.length
            }
        });
    }

    // ==========================================
    // AFTER SUBMIT
    // ==========================================

    function afterSubmit(context) {

        if (
            context.type !==
            context.UserEventType.CREATE
        ) {
            return;
        }

        const so = context.newRecord;
        const soId = so.id;

        const billingMonths = getBillingMonths(
            so.getValue({
                fieldId: 'terms'
            })
        );

        // Saved item rates are term-based
        // Convert back to monthly rates
        const monthlyRates = getMonthlyRates(
            so,
            billingMonths
        );

        const monthlyRental = monthlyRates.reduce(
            (sum, rate) => sum + rate,
            0
        );

        const schedule = generateBillingSchedule(
            so,
            monthlyRental
        );

        // ======================================
        // CREATE SUCCEEDING BILLING RECORDS
        // ======================================

        schedule.forEach((period, index) => {

            const bill = record.create({
                type:
                    'customrecord_cli_billing_schedule',
                isDynamic: false
            });

            bill.setValue({
                fieldId: 'name',
                value:
                    `SO-${soId}-Period-${index + 1}`
            });

            bill.setValue({
                fieldId:
                    'custrecord_cli_bs_sales_order',
                value: Number(soId)
            });

            bill.setValue({
                fieldId:
                    'custrecord_cli_bs_period',
                value: period.periodNumber
            });

            bill.setValue({
                fieldId:
                    'custrecord_cli_bs_from',
                value: period.periodFrom
            });

            bill.setValue({
                fieldId:
                    'custrecord_cli_bs_to',
                value: period.periodTo
            });

            bill.setValue({
                fieldId:
                    'custrecord_cli_bs_amount',
                value: period.billingAmount
            });

            bill.setValue({
                fieldId:
                    'custrecord_cli_bs_due_date',
                value: period.dueDate
            });

            bill.setValue({
                fieldId:
                    'custrecord_cli_quantity',
                value: period.quantity
            });

            const billId = bill.save();

            log.debug({
                title: 'Billing Period Created',
                details: {
                    salesOrderId: soId,
                    billingRecordId: billId,
                    period: period.periodNumber,
                    amount: period.billingAmount,
                    quantity: period.quantity
                }
            });
        });

        log.audit({
            title: 'Billing Schedule Generated',
            details: {
                salesOrderId: soId,
                periods: schedule.length,
                totalAmount: round2(
                    schedule.reduce(
                        (sum, p) =>
                            sum + p.billingAmount,
                        0
                    )
                )
            }
        });
    }

    return {
        beforeSubmit,
        afterSubmit
    };
});
