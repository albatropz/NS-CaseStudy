/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * File:      cli_lib_invoice.js
 * Purpose:   Creates ONE Sales Invoice from ONE Billing Schedule record.
 *            Used by the Invoice Generation Suitelet (cli_sl_invoice_generation.js).
 *            Keep it in the same folder as cli_lib_billing.js.
 *
 * How the invoice is populated:
 *  1. The invoice is transformed from the schedule's Sales Order, so the customer,
 *     subsidiary, location, terms and item lines come from the contract.
 *  2. Each item line gets the schedule's period quantity, the term rate and that
 *     line's share of the period amount. The shares come from cli_lib_billing.js,
 *     the same math that built the schedule, so they add up to the schedule amount.
 *  3. The invoice number is written back to the schedule record, which is what
 *     removes the schedule from the Invoice Generation filter.
 *
 * Prerequisite: a custom field on the Billing Schedule record that links to the
 * invoice (see INVOICE_FIELD below).
 */
define([
    'N/record',
    'N/search',
    'N/runtime',
    'N/log',
    './cli_lib_billing'
], (record, search, runtime, log, billing) => {

    const BILL_TYPE = billing.BILL_TYPE;
    const SO_FIELD = 'custrecord_cli_bs_sales_order';

    // Custom field on customrecord_cli_billing_schedule. Type: List/Record, list:
    // Transaction (or Invoice). It stays EMPTY until an invoice is created.
    // The Suitelet filter hides every schedule that has a value here.
    const INVOICE_FIELD = 'custrecord_cli_bs_invoice';

    // Governance: stop starting new invoices when this little usage is left.
    // One invoice costs roughly 45 units (SO load, transform, save, link, lookups).
    const MIN_USAGE = 150;

    const hasEnoughUsage = () =>
        runtime.getCurrentScript().getRemainingUsage() > MIN_USAGE;

    // Select fields come back from lookupFields as [{ value, text }]
    const firstValue = field =>
        Array.isArray(field) ? (field[0] ? field[0].value : '') : (field || '');

    // ==========================================
    // READ THE SCHEDULE RECORD
    // ==========================================
    const readSchedule = scheduleId => {

        const r = search.lookupFields({
            type: BILL_TYPE,
            id: scheduleId,
            columns: [
                'name',
                SO_FIELD,
                'custrecord_cli_bs_period',
                'custrecord_cli_bs_amount',
                'custrecord_cli_bs_from',
                'custrecord_cli_bs_to',
                INVOICE_FIELD
            ]
        });

        return {
            id: scheduleId,
            name: r.name,
            soId: firstValue(r[SO_FIELD]),
            period: Number(r.custrecord_cli_bs_period) || 0,
            amount: Number(r.custrecord_cli_bs_amount) || 0,
            from: r.custrecord_cli_bs_from,
            to: r.custrecord_cli_bs_to,
            invoiceId: firstValue(r[INVOICE_FIELD])
        };
    };

    // ==========================================
    // CREATE ONE INVOICE FROM ONE SCHEDULE
    // Never throws. The outcome is returned so the Suitelet can show it
    // and carry on with the next schedule.
    // ==========================================
    const createInvoiceFromSchedule = scheduleId => {

        const result = { scheduleId, name: 'Schedule ' + scheduleId, ok: false };

        try {

            const schedule = readSchedule(scheduleId);
            result.name = schedule.name || result.name;

            log.debug({ title: 'Invoice requested for schedule', details: schedule });

            // Guard against a double click or a second user
            if (schedule.invoiceId) {
                result.skipped = true;
                result.invoiceId = schedule.invoiceId;
                result.message = 'Already has an invoice.';
                log.audit({ title: 'Invoice skipped', details: result });
                return result;
            }

            if (!schedule.soId || !schedule.period) {
                billing.fail('INVALID_SCHEDULE', 'The schedule has no Sales Order or period number.');
            }

            // ----- Rebuild the schedule from the Sales Order -----
            // The schedule record stores one amount per period (all items together).
            // The per-item split only exists in the math, so it is recalculated here.
            const so = record.load({ type: record.Type.SALES_ORDER, id: schedule.soId });

            const billingMonths = billing.getBillingMonths(so.getValue({ fieldId: 'terms' }));
            const monthlyRates = billing.readMonthlyRates(so, billingMonths);
            const calc = billing.generateSchedule(so, monthlyRates);

            const index = schedule.period - 1;
            const period = calc.schedule[index];

            if (!period) {
                billing.fail('PERIOD_NOT_FOUND',
                    'Period ' + schedule.period + ' does not exist on the Sales Order any more.');
            }

            // The Sales Order must still agree with the schedule record.
            // If it was edited after the schedule was made, stop instead of billing a wrong amount.
            if (Math.abs(period.billingAmount - schedule.amount) >= 0.005) {
                billing.fail('SCHEDULE_OUT_OF_DATE',
                    'Schedule amount ' + schedule.amount + ' does not match the Sales Order (' +
                    period.billingAmount + '). Regenerate the billing schedule first.');
            }

            // ----- Build the invoice from the Sales Order -----
            const invoice = record.transform({
                fromType: record.Type.SALES_ORDER,
                fromId: schedule.soId,
                toType: record.Type.INVOICE,
                isDynamic: false
            });

            const invoiceLines = invoice.getLineCount({ sublistId: 'item' });

            if (invoiceLines !== calc.lines.length) {
                billing.fail('LINE_MISMATCH',
                    'The invoice has ' + invoiceLines + ' item lines but the contract has ' +
                    calc.lines.length + '.');
            }

            calc.lines.forEach((line, i) => {

                // Same item on the same position, otherwise amounts would land on the wrong unit
                const soItem = String(so.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i }));
                const invItem = String(invoice.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i }));

                if (soItem !== invItem) {
                    billing.fail('LINE_MISMATCH', 'Invoice line ' + (i + 1) + ' is not the contract item.');
                }

                const lineAmount = line.periodAmounts[index];

                invoice.setSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i, value: period.quantity });
                invoice.setSublistValue({ sublistId: 'item', fieldId: 'rate', line: i, value: line.termRate });
                // Amount last, so the schedule share wins over quantity x rate
                invoice.setSublistValue({ sublistId: 'item', fieldId: 'amount', line: i, value: lineAmount });

                log.debug({
                    title: 'Invoice line set',
                    details: { line: i, quantity: period.quantity, rate: line.termRate, amount: lineAmount }
                });
            });

            // ----- Header -----
            invoice.setValue({ fieldId: 'trandate', value: new Date() });
            invoice.setValue({ fieldId: 'duedate', value: period.dueDate });
            invoice.setValue({
                fieldId: 'memo',
                value: 'Lease billing ' + schedule.name + ' (' + schedule.from + ' to ' + schedule.to + ')'
            });

            const invoiceId = invoice.save();

            result.ok = true;
            result.invoiceId = invoiceId;
            result.amount = period.billingAmount;

            log.audit({
                title: 'Invoice created',
                details: { scheduleId, schedule: schedule.name, invoiceId, amount: period.billingAmount }
            });

            // ----- Link the invoice to the schedule (this hides it from the filter) -----
            try {
                record.submitFields({
                    type: BILL_TYPE,
                    id: scheduleId,
                    values: { [INVOICE_FIELD]: invoiceId },
                    options: { enableSourcing: false, ignoreMandatoryFields: true }
                });
            } catch (linkError) {
                // The invoice exists but the schedule still looks unbilled.
                // Say so loudly, otherwise the next click would bill it twice.
                result.warning = true;
                result.message = 'Invoice ' + invoiceId + ' was created but the schedule could not be linked. ' +
                    'Link it manually before generating again.';
                log.error({
                    title: 'CREATED INVOICE BUT LINK FAILED',
                    details: { scheduleId, invoiceId, error: linkError.message || linkError }
                });
            }

            // Invoice number for display (not important if this fails)
            try {
                result.tranId = search.lookupFields({
                    type: search.Type.INVOICE,
                    id: invoiceId,
                    columns: ['tranid']
                }).tranid;
            } catch (e) {
                log.debug({ title: 'Invoice number lookup skipped', details: e.message });
            }

            return result;

        } catch (e) {

            result.ok = false;
            result.message = e.message || e.name || String(e);

            log.error({
                title: 'Invoice failed for schedule ' + scheduleId,
                details: { name: e.name, message: e.message, stack: e.stack }
            });

            return result;
        }
    };

    return {
        INVOICE_FIELD,
        hasEnoughUsage,
        createInvoiceFromSchedule
    };
});