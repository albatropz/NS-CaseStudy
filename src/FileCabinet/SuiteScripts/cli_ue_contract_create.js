
/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */

define(['N/error', 'N/record'], (error, record) => {

    // ==========================================
    // MONTH CALCULATOR
    // ==========================================

    const countMonths = (startDate, endDate) => {
        return (
            (endDate.getFullYear() - startDate.getFullYear()) * 12 +
            (endDate.getMonth() - startDate.getMonth() + 1)
        );
    };


    // ==========================================
    // SHARED BILLING SCHEDULE GENERATOR
    // ==========================================

    function generateBillingSchedule(salesOrder) {

        const startDate = salesOrder.getValue({
            fieldId: 'startdate'
        });

        const endDate = salesOrder.getValue({
            fieldId: 'enddate'
        });

        const paymentTerms = salesOrder.getValue({
            fieldId: 'terms'
        });

        const billingType = salesOrder.getValue({
            fieldId: 'custbody_cli_billing_type'
        });

        const netDaysValue = salesOrder.getValue({
            fieldId: 'custbody_cli_net_days'
        });

        const netDays = Number(netDaysValue);


        // ======================================
        // CALCULATE MONTHLY RENTAL FROM ITEMS
        // ======================================

        const lineCount = salesOrder.getLineCount({
            sublistId: 'item'
        });

        let itemAmount = 0;

        for (let i = 0; i < lineCount; i++) {

            const amount = salesOrder.getSublistValue({
                sublistId: 'item',
                fieldId: 'amount',
                line: i
            });

            itemAmount += Number(amount) || 0;
        }


        // ======================================
        // VALIDATE CONTRACT DATES
        // ======================================

        if (!startDate || !endDate) {
            throw error.create({
                name: 'MISSING_DATES',
                message: 'Contract start and end dates are required.',
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
                message: 'Invalid contract date range.',
                notifyOff: false
            });
        }

        const months = countMonths(start, end);


        // ======================================
        // DETERMINE BILLING FREQUENCY
        // ======================================

        let billingMonths;

        switch (String(paymentTerms)) {

            case '5': // Monthly
                billingMonths = 1;
                break;

            case '6': // Quarterly
                billingMonths = 3;
                break;

            case '4': // Semi-Annual
                billingMonths = 6;
                break;

            case '1': // Annually
                billingMonths = 12;
                break;

            default:
                throw error.create({
                    name: 'INVALID_PAYMENT_TERMS',
                    message: 'Unsupported payment terms.',
                    notifyOff: false
                });
        }


        // ======================================
        // DETERMINE BILLING TYPE
        // ======================================

        let dueDateRule;

        switch (String(billingType)) {

            case '1':
                dueDateRule = 'ADVANCE';
                break;

            case '2':
                dueDateRule = 'ARREARS';
                break;

            case '3':
                dueDateRule = 'NET_DAYS';
                break;

            default:
                throw error.create({
                    name: 'INVALID_BILLING_TYPE',
                    message: 'Please select a valid Billing Type.',
                    notifyOff: false
                });
        }


        // ======================================
        // VALIDATE NET DAYS
        // ======================================

        if (dueDateRule === 'NET_DAYS') {

            if (
                netDaysValue === '' ||
                netDaysValue === null ||
                netDaysValue === undefined ||
                !Number.isInteger(netDays) ||
                netDays <= 0
            ) {
                throw error.create({
                    name: 'INVALID_NET_DAYS',
                    message: 'Net Days must be a positive whole number.',
                    notifyOff: false
                });
            }
        }


        // ======================================
        // CALCULATE DUE DATE
        // ======================================

        function calculateDueDate(periodStart, periodEnd) {

            let dueDate;

            switch (dueDateRule) {

                case 'ADVANCE':
                    dueDate = new Date(periodStart);
                    break;

                case 'ARREARS':
                    dueDate = new Date(periodEnd);
                    break;

                case 'NET_DAYS':
                    dueDate = new Date(periodStart);
                    dueDate.setDate(
                        dueDate.getDate() + netDays
                    );
                    break;
            }

            return dueDate;
        }


        // ======================================
        // GENERATE ALL BILLING PERIODS
        // ======================================

        const billingSchedule = [];

        for (
            let i = 0;
            i < months;
            i += billingMonths
        ) {

            const periodStart = i === 0
                ? new Date(start)
                : new Date(
                    start.getFullYear(),
                    start.getMonth() + i,
                    1
                );

            const periodEnd = new Date(
                start.getFullYear(),
                start.getMonth() + i + billingMonths,
                0
            );

            const actualEnd =
                periodEnd > end ? new Date(end) : periodEnd;

            const monthsInPeriod = Math.min(
                billingMonths,
                months - i
            );

            const billingAmount =
                itemAmount * monthsInPeriod;

            const dueDate = calculateDueDate(
                periodStart,
                actualEnd
            );

            billingSchedule.push({
                periodNumber: billingSchedule.length + 1,
                periodFrom: periodStart,
                periodTo: actualEnd,
                billingAmount: billingAmount,
                dueDate: dueDate
            });
        }

        return billingSchedule;
    }


    // ==========================================
    // BEFORE SUBMIT
    // ==========================================

    function beforeSubmit(context) {

        if (context.type !== context.UserEventType.CREATE) {
            return;
        }

        const salesOrder = context.newRecord;

        const billingSchedule =
            generateBillingSchedule(salesOrder);

        if (billingSchedule.length === 0) {
            return;
        }

        const firstPeriod = billingSchedule[0];


        // ======================================
        // NEW: GET CONTRACT DATES
        // ======================================

        const startDate = salesOrder.getValue({
            fieldId: 'startdate'
        });

        const endDate = salesOrder.getValue({
            fieldId: 'enddate'
        });


        // ======================================
        // FIXED: CALCULATE CONTRACT DURATION
        // ======================================

        const contractMonths = countMonths(
            new Date(startDate),
            new Date(endDate)
        );


        // ======================================
        // FIXED: CALCULATE TOTAL CONTRACT VALUE
        // ======================================

        const totalContractValue = billingSchedule.reduce(
            (total, period) => total + period.billingAmount,
            0
        );


        // ======================================
        // FIXED: CALCULATE MONTHLY RENTAL
        // ======================================

        const monthlyRental =
            totalContractValue / contractMonths;


        // ======================================
        // NEW: STORE FINANCIAL SUMMARY
        // ======================================

        salesOrder.setValue({
            fieldId: 'custbody_cli_monthly_rental',
            value: monthlyRental
        });

        salesOrder.setValue({
            fieldId: 'custbody_cli_contract_months',
            value: contractMonths
        });

        salesOrder.setValue({
            fieldId: 'custbody_cli_contract_total',
            value: totalContractValue
        });


        // ======================================
        // EXISTING: STORE FIRST BILLING PERIOD
        // ======================================

        salesOrder.setValue({
            fieldId: 'custbody_cli_billing_amount',
            value: firstPeriod.billingAmount
        });

        salesOrder.setValue({
            fieldId: 'custbody_cli_covered_period_from',
            value: firstPeriod.periodFrom
        });

        salesOrder.setValue({
            fieldId: 'custbody_cli_covered_period_to',
            value: firstPeriod.periodTo
        });

        salesOrder.setValue({
            fieldId: 'custbody_cli_due_date',
            value: firstPeriod.dueDate
        });


        // ======================================
        // AUDIT LOG
        // ======================================

        log.audit({
            title: 'Contract Billing Validated',
            details: {
                contractMonths: contractMonths,
                monthlyRental: monthlyRental,
                totalContractValue: totalContractValue,
                totalPeriods: billingSchedule.length,
                firstBillingAmount: firstPeriod.billingAmount
            }
        });
    }


    // ==========================================
    // AFTER SUBMIT
    // ==========================================

    function afterSubmit(context) {

        if (context.type !== context.UserEventType.CREATE) {
            return;
        }

        const salesOrder = context.newRecord;
        const salesOrderId = salesOrder.id;

        const billingSchedule =
            generateBillingSchedule(salesOrder);


        // ======================================
        // CREATE ALL BILLING SCHEDULE RECORDS
        // ======================================

        billingSchedule.forEach((period, index) => {

            const billingRecord = record.create({
                type: 'customrecord_cli_billing_schedule',
                isDynamic: false
            });

            billingRecord.setValue({
                fieldId: 'name',
                value: `SO-${salesOrderId}-Period-${index + 1}`
            });

            billingRecord.setValue({
                fieldId: 'custrecord_cli_bs_sales_order',
                value: Number(salesOrderId)
            });

            billingRecord.setValue({
                fieldId: 'custrecord_cli_bs_period',
                value: period.periodNumber
            });

            billingRecord.setValue({
                fieldId: 'custrecord_cli_bs_from',
                value: period.periodFrom
            });

            billingRecord.setValue({
                fieldId: 'custrecord_cli_bs_to',
                value: period.periodTo
            });

            billingRecord.setValue({
                fieldId: 'custrecord_cli_bs_amount',
                value: period.billingAmount
            });

            billingRecord.setValue({
                fieldId: 'custrecord_cli_bs_due_date',
                value: period.dueDate
            });

            const billingRecordId = billingRecord.save();

            log.debug({
                title: 'Billing Period Created',
                details: {
                    salesOrderId: salesOrderId,
                    billingRecordId: billingRecordId,
                    period: index + 1
                }
            });
        });


        // ======================================
        // FINAL AUDIT LOG
        // ======================================

        log.audit({
            title: 'Billing Schedule Generated',
            details: {
                salesOrderId: salesOrderId,
                totalPeriods: billingSchedule.length,
                totalAmount: billingSchedule.reduce(
                    (total, period) =>
                        total + period.billingAmount,
                    0
                )
            }
        });
    }


    // ==========================================
    // RETURN ENTRY POINTS
    // ==========================================

    return {
        beforeSubmit,
        afterSubmit
    };

});
