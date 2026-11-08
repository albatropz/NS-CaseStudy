
/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */

// CHANGED: Added N/record
define(['N/error', 'N/record'], (error, record) => {

    // Existing month calculation
    const countMonths = (startDate, endDate) => {
        return (
            (endDate.getFullYear() - startDate.getFullYear()) * 12 +
            (endDate.getMonth() - startDate.getMonth() + 1)
        );
    };

    // Shared billing schedule generator
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

        // Calculate monthly amount from Items
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

        // Validate contract dates
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

        // Determine billing frequency
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

        // Determine Billing Type
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

        // Validate Net Days
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

        // Shared due date calculation
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

        // Generate all billing periods
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

        // NEW: Return results to both entry points
        return billingSchedule;
    }

    // CHANGED: Simplified beforeSubmit
    function beforeSubmit(context) {

        if (context.type !== context.UserEventType.CREATE) {
            return;
        }

        const salesOrder = context.newRecord;

        // Call shared generator
        const billingSchedule =
            generateBillingSchedule(salesOrder);

        if (billingSchedule.length === 0) {
            return;
        }

        const firstPeriod = billingSchedule[0];

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

        log.audit({
            title: 'Contract Billing Validated',
            details: {
                totalPeriods: billingSchedule.length,
                firstBillingAmount: firstPeriod.billingAmount
            }
        });
    }

    // Create all billing schedule records
    function afterSubmit(context) {

        if (context.type !== context.UserEventType.CREATE) {
            return;
        }

        const salesOrder = context.newRecord;
        const salesOrderId = salesOrder.id;

        // Generate populated array
        const billingSchedule =
            generateBillingSchedule(salesOrder);

        // Create a custom record for each billing period
       
        billingSchedule.forEach((period, index) => {

            const billingRecord = record.create({
                type: 'customrecord_cli_billing_schedule',
                isDynamic: false
            });

            // Populate required Name field
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

    return {
        beforeSubmit,
        afterSubmit
    };

});
