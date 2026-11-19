/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 *
 * File:      cli_ue_billing_update.js
 * Name:      CLI Billing Update UE
 * Script ID: customscript_cli_ue_billing_update
 *
 * EDIT only. Runs when Payment Terms change.
 *  beforeSubmit: validate, then rewrite item lines and summary fields
 *  afterSubmit : replace the Succeeding bills with a new schedule
 *
 * All billing math lives in cli_lib_billing.js (keep both in the same folder).
 */
define([
    'N/record',
    'N/search',
    'N/format',
    'N/log',
    './cli_lib_billing'
], (record, search, format, log, lib) => {

    // ==========================================
    // GET EXISTING BILLING RECORDS
    // ==========================================
    function getExistingBillingRecords(salesOrderId) {
        const bills = [];

        search.create({
            type: lib.BILL_TYPE,
            filters: [['custrecord_cli_bs_sales_order', 'anyof', salesOrderId]],
            columns: [
                'internalid',
                'custrecord_cli_bs_due_date',
                'custrecord_cli_bs_status'
            ]
        }).run().each(result => {
            bills.push({
                id: result.id,
                dueDate: result.getValue({ name: 'custrecord_cli_bs_due_date' }),
                status: result.getValue({ name: 'custrecord_cli_bs_status' })
            });
            return true;
        });

        log.debug({
            title: 'Existing billing records',
            details: { salesOrderId, count: bills.length }
        });

        return bills;
    }

    // ==========================================
    // VALIDATE EXISTING BILLING RECORDS
    // Blocks regeneration when any period is past due or has a status
    // ==========================================
    function validateExistingBills(bills) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (const bill of bills) {

            if (!bill.dueDate) {
                lib.fail('MISSING_BILL_DUE_DATE', 'Existing billing record has no due date.');
            }

            let dueDate;
            try {
                dueDate = format.parse({ value: bill.dueDate, type: format.Type.DATE });
            } catch (e) {
                lib.fail('INVALID_BILL_DUE_DATE', 'Cannot parse existing billing due date.');
            }

            if (!(dueDate instanceof Date) || Number.isNaN(dueDate.getTime())) {
                lib.fail('INVALID_BILL_DUE_DATE', 'Existing billing record has an invalid due date.');
            }

            dueDate.setHours(0, 0, 0, 0);

            if (dueDate < today) {
                lib.fail(
                    'PAST_DUE_BILLING_RECORD',
                    'At least one billing period is past due. Regeneration stopped.'
                );
            }

            // Safety: block processed or unverified statuses
            if (bill.status !== '' && bill.status != null) {
                lib.fail(
                    'BILL_STATUS_REVIEW_REQUIRED',
                    'Billing record ' + bill.id +
                    ' has a status. Review status mapping before regeneration.'
                );
            }
        }
    }

    // ==========================================
    // DELETE EXISTING BILLING RECORDS
    // ==========================================
    function deleteExistingBillingRecords(bills) {
        bills.forEach(bill => {
            record.delete({ type: lib.BILL_TYPE, id: bill.id });
            log.debug({ title: 'Billing record deleted', details: { id: bill.id } });
        });
    }

    // ==========================================
    // BEFORE SUBMIT (EDIT ONLY)
    // ==========================================
    function beforeSubmit(context) {

        if (context.type !== context.UserEventType.EDIT) return;

        const oldSO = context.oldRecord;
        const newSO = context.newRecord;

        const oldTerms = oldSO.getValue({ fieldId: 'terms' });
        const newTerms = newSO.getValue({ fieldId: 'terms' });

        // Only run when Payment Terms change
        if (String(oldTerms) === String(newTerms)) return;

        const oldBillingMonths = lib.getBillingMonths(oldTerms);

        const oldCount = oldSO.getLineCount({ sublistId: 'item' });
        const newCount = newSO.getLineCount({ sublistId: 'item' });

        if (oldCount !== newCount || newCount === 0) {
            lib.fail(
                'ITEM_LINES_CHANGED',
                'Change Payment Terms separately from adding or removing item lines.'
            );
        }

        // Item lines must keep the same order, because rates map by line index
        for (let i = 0; i < newCount; i++) {
            const oldItem = String(oldSO.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i }));
            const newItem = String(newSO.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i }));

            if (oldItem !== newItem) {
                lib.fail(
                    'ITEM_LINES_CHANGED',
                    'Do not reorder or replace item lines while changing Payment Terms.'
                );
            }
        }

        // Validate BEFORE the Sales Order is saved
        validateExistingBills(getExistingBillingRecords(oldSO.id));

        // Recover monthly rates using the OLD terms (saved rate is term based)
        const monthlyRates = lib.readMonthlyRates(oldSO, oldBillingMonths);

        // Rebuild with the NEW terms. Same library as CREATE
        const calc = lib.generateSchedule(newSO, monthlyRates);

        lib.applyItemLines(newSO, calc);
        lib.setSummaryFields(newSO, calc);

        log.audit({
            title: 'Sales Order Payment Terms updated (EDIT)',
            details: {
                salesOrderId: oldSO.id,
                oldTerms,
                newTerms,
                lines: calc.lines.length,
                totalQty: calc.totals.totalQty,
                totalAmount: calc.totals.totalAmount
            }
        });
    }

    // ==========================================
    // AFTER SUBMIT (EDIT ONLY)
    // ==========================================
    function afterSubmit(context) {

        if (context.type !== context.UserEventType.EDIT) return;

        const oldTerms = context.oldRecord.getValue({ fieldId: 'terms' });
        const newTerms = context.newRecord.getValue({ fieldId: 'terms' });

        if (String(oldTerms) === String(newTerms)) return;

        const so = context.newRecord;

        // Saved rates are term based. Convert back to monthly rates
        const newBillingMonths = lib.getBillingMonths(newTerms);
        const monthlyRates = lib.readMonthlyRates(so, newBillingMonths);

        // Build first, so any error happens BEFORE old records are deleted
        const calc = lib.generateSchedule(so, monthlyRates);

        lib.verifySavedLines(so, calc);

        const existingBills = getExistingBillingRecords(so.id);
        validateExistingBills(existingBills);

        // Replace the old unprocessed schedule
        deleteExistingBillingRecords(existingBills);
        lib.createBillingRecords(so.id, calc.schedule);

        log.audit({
            title: 'Billing schedule regenerated (EDIT)',
            details: {
                salesOrderId: so.id,
                oldTerms,
                newTerms,
                oldPeriods: existingBills.length,
                newPeriods: calc.schedule.length,
                totalAmount: calc.totals.totalAmount
            }
        });
    }

    return { beforeSubmit, afterSubmit };
});
