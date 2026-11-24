/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 *
 * File:      cli_cs_invoice_generation.js
 * Name:      CLI Invoice Generation CS
 * Script ID: customscript_cli_cs_invoice_generation
 *
 * Runs in the browser on the Invoice Generation page (Suitelet).
 * It holds the function behind the Generate Invoice button.
 * The Filter button is a normal submit button, so it does NOT go through this script.
 *
 * N/log in a client script writes to the browser console (F12).
 */
define(['N/currentRecord', 'N/ui/dialog', 'N/log'], (currentRecord, dialog, log) => {

    const SUBLIST_ID = 'custpage_schedules';
    const ACTION_FIELD = 'custpage_action';
    const SELECTED_FIELD = 'custpage_selected_ids';

    // NetSuite requires a pageInit entry point in a client script
    function pageInit(context) {
        log.debug('Invoice Generation page loaded');
    }

    // Collects the ID of every row whose Select checkbox is ticked
    function getTickedIds(rec) {

        const lineCount = rec.getLineCount({ sublistId: SUBLIST_ID });
        const ids = [];

        for (let i = 0; i < lineCount; i++) {

            // In the browser a checkbox value is true or false
            const ticked = rec.getSublistValue({
                sublistId: SUBLIST_ID,
                fieldId: 'custpage_col_select',
                line: i
            }) === true;

            if (!ticked) continue;

            const id = rec.getSublistValue({
                sublistId: SUBLIST_ID,
                fieldId: 'custpage_col_id',
                line: i
            });

            if (id) ids.push(String(id));
        }

        return { lineCount, ids };
    }

    // Sends the ticked ids to the Suitelet and submits the form
    function submitSelection(rec, ids) {

        // Tell the Suitelet WHICH button was clicked (empty means Filter)
        rec.setValue({ fieldId: ACTION_FIELD, value: 'generate' });
        rec.setValue({ fieldId: SELECTED_FIELD, value: ids.join(',') });

        // Skip the "leave this page?" warning, then submit the form
        window.onbeforeunload = null;

        const form = document.getElementById('main_form');

        if (!form) {
            // Visible in the console if this page uses a different form ID
            log.error('generateInvoice: main_form not found');
            return;
        }

        form.submit();
    }

    // Called by the Generate Invoice button (functionName in the Suitelet)
    function generateInvoice() {

        const rec = currentRecord.get();
        const { lineCount, ids } = getTickedIds(rec);

        log.debug('generateInvoice clicked', { lineCount, ticked: ids.length, ids });

        if (!ids.length) {
            dialog.alert({
                title: 'Nothing selected',
                message: 'Select at least one Billing Schedule.'
            });
            return;
        }

        // Creating invoices is not undone by closing the page, so ask first
        dialog.confirm({
            title: 'Generate Invoice',
            message: 'Create ' + ids.length + ' sales invoice(s) from the selected Billing Schedules?'
        }).then(confirmed => {

            if (confirmed) submitSelection(rec, ids);
            else log.debug('generateInvoice cancelled by the user');

        }).catch(e => log.error('generateInvoice dialog failed', e));
    }

    return { pageInit, generateInvoice };
});