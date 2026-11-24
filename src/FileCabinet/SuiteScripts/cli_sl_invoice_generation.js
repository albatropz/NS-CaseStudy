/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 *
 * File:          cli_sl_invoice_generation.js
 * Name:          CLI Invoice Generation SL
 * Script ID:     customscript_cli_sl_invoice_generation
 * Deployment ID: customdeploy_cli_sl_invoice_generation
 * UI title:      Invoice Generation
 *
 * 1. Filter fields: Subsidiary, Customer, Start Date, End Date
 *    (Subsidiary, Start Date and End Date are mandatory).
 * 2. Filter button: lists the Billing Schedules that have NO invoice yet.
 * 3. Sublist with a Select checkbox on every row.
 * 4. Generate Invoice button: creates one Sales Invoice per selected schedule
 *    (all the invoice logic is in cli_lib_invoice.js) and links it back to the
 *    schedule, so the schedule disappears from the list.
 *
 * Needs in the same folder: cli_lib_invoice.js, cli_lib_billing.js and
 * cli_cs_invoice_generation.js (the browser script behind the Generate Invoice button).
 */
define([
    'N/ui/serverWidget',
    'N/ui/message',
    'N/search',
    'N/url',
    'N/format',
    'N/log',
    './cli_lib_invoice'
], (serverWidget, message, search, url, format, log, invoiceLib) => {

    // ==========================================
    // SETTINGS (change here only)
    // ==========================================
    const BILL_TYPE = 'customrecord_cli_billing_schedule';
    const SO_FIELD = 'custrecord_cli_bs_sales_order';

    // Field on the schedule that links to its invoice (defined in cli_lib_invoice.js).
    // Schedules where this is filled in are hidden from the list.
    const INVOICE_FIELD = invoiceLib.INVOICE_FIELD;

    // The Start Date and End Date filter is applied to this schedule field.
    // Change it to custrecord_cli_bs_from if the range should use Covered Period From.
    const DATE_FILTER_FIELD = 'custrecord_cli_bs_due_date';

    // Most rows shown on one page (runPaged allows up to 1000)
    const MAX_ROWS = 1000;

    // Most invoices created by one click. A Suitelet has 1000 usage units and one
    // invoice costs about 45, so this stays well inside the limit.
    const MAX_PER_RUN = 15;

    const FIELD = {
        SUBSIDIARY: 'custpage_subsidiary',
        CUSTOMER: 'custpage_customer',
        START: 'custpage_start_date',
        END: 'custpage_end_date',
        ACTION: 'custpage_action',            // hidden: '' = Filter, 'generate' = Generate Invoice
        SELECTED: 'custpage_selected_ids'     // hidden: ids of the ticked rows, filled by the browser script
    };

    const SUBLIST_ID = 'custpage_schedules';

    // ==========================================
    // SMALL HELPERS
    // ==========================================
    const escapeHtml = value => String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    // Date values arrive as text in the user's own date format
    const readFilters = params => ({
        subsidiary: params[FIELD.SUBSIDIARY] || '',
        customer: params[FIELD.CUSTOMER] || '',
        startDate: params[FIELD.START] || '',
        endDate: params[FIELD.END] || ''
    });

    // "12,15,15,abc" -> ['12', '15']  (digits only, no repeats)
    const parseSelectedIds = text => {
        const ids = String(text || '')
            .split(',')
            .map(part => part.trim())
            .filter(part => /^[0-9]+$/.test(part));
        return Array.from(new Set(ids));
    };

    // ==========================================
    // VALIDATE FILTERS
    // Returns an error text, or '' when everything is fine
    // ==========================================
    const validateFilters = filters => {

        if (!filters.subsidiary) return 'Subsidiary is required.';
        if (!filters.startDate) return 'Start Date is required.';
        if (!filters.endDate) return 'End Date is required.';

        let start;
        let end;

        try {
            start = format.parse({ value: filters.startDate, type: format.Type.DATE });
            end = format.parse({ value: filters.endDate, type: format.Type.DATE });
        } catch (e) {
            log.error({ title: 'Date parse failed', details: e });
            return 'Start Date or End Date is not a valid date.';
        }

        if (end < start) return 'End Date must be on or after Start Date.';

        return '';
    };

    // ==========================================
    // SEARCH BILLING SCHEDULES
    // Only schedules WITHOUT an invoice (INVOICE_FIELD is empty).
    // Subsidiary and customer come from the linked Sales Order.
    // ==========================================
    const searchSchedules = filters => {

        const filterExpression = [
            // No invoice yet: this is what makes a billed schedule disappear
            [INVOICE_FIELD, search.Operator.ANYOF, '@NONE@'],
            'AND',
            [DATE_FILTER_FIELD, search.Operator.ONORAFTER, filters.startDate],
            'AND',
            [DATE_FILTER_FIELD, search.Operator.ONORBEFORE, filters.endDate],
            'AND',
            // Header line only, so a Sales Order with many item lines is not repeated
            [SO_FIELD + '.mainline', search.Operator.IS, 'T'],
            'AND',
            [SO_FIELD + '.subsidiary', search.Operator.ANYOF, filters.subsidiary]
        ];

        if (filters.customer) {
            filterExpression.push(
                'AND',
                [SO_FIELD + '.entity', search.Operator.ANYOF, filters.customer]
            );
        }

        log.debug({ title: 'Schedule search filters', details: filterExpression });

        const scheduleSearch = search.create({
            type: BILL_TYPE,
            filters: filterExpression,
            columns: [
                search.createColumn({ name: DATE_FILTER_FIELD, sort: search.Sort.ASC }),
                'name',
                SO_FIELD,
                'custrecord_cli_bs_period',
                'custrecord_cli_bs_from',
                'custrecord_cli_bs_to',
                'custrecord_cli_bs_amount',
                'custrecord_cli_quantity',
                search.createColumn({ name: 'entity', join: SO_FIELD }),
                search.createColumn({ name: 'subsidiary', join: SO_FIELD })
            ]
        });

        
        //10
        const paged = scheduleSearch.runPaged({ pageSize: MAX_ROWS });
        const total = paged.count;
        const rows = [];
        const seen = {};   // guards against the same schedule appearing twice

        if (total > 0) {
            paged.fetch({ index: 0 }).data.forEach(result => {

                if (seen[result.id]) return;
                seen[result.id] = true;

                rows.push({
                    id: result.id,
                    name: result.getValue('name'),
                    soId: result.getValue(SO_FIELD),
                    soText: result.getText(SO_FIELD),
                    customer: result.getText({ name: 'entity', join: SO_FIELD }),
                    subsidiary: result.getText({ name: 'subsidiary', join: SO_FIELD }),
                    period: result.getValue('custrecord_cli_bs_period'),
                    from: result.getValue('custrecord_cli_bs_from'),
                    to: result.getValue('custrecord_cli_bs_to'),
                    dueDate: result.getValue(DATE_FILTER_FIELD),
                    amount: Number(result.getValue('custrecord_cli_bs_amount')) || 0,
                    quantity: result.getValue('custrecord_cli_quantity')
                });
            });
        }

        log.audit({
            title: 'Billing schedules found',
            details: { total, shown: rows.length, filters }
        });

        return { rows, total };
    };

    // ==========================================
    // GENERATE INVOICES
    // One invoice per selected schedule. A failure on one schedule never stops the others.
    // ==========================================
    const generateInvoices = ids => {

        const results = [];

        log.audit({ title: 'Generate Invoice clicked', details: { selected: ids.length, ids } });

        ids.forEach((id, position) => {

            if (position >= MAX_PER_RUN) {
                results.push({
                    scheduleId: id, name: 'Schedule ' + id, ok: false, skipped: true,
                    message: 'Not processed: limit of ' + MAX_PER_RUN + ' invoices per click. Click Generate Invoice again.'
                });
                return;
            }

            if (!invoiceLib.hasEnoughUsage()) {
                results.push({
                    scheduleId: id, name: 'Schedule ' + id, ok: false, skipped: true,
                    message: 'Not processed: script usage limit reached. Click Generate Invoice again.'
                });
                return;
            }

            results.push(invoiceLib.createInvoiceFromSchedule(id));
        });

        log.audit({
            title: 'Generate Invoice finished',
            details: {
                created: results.filter(r => r.ok).length,
                failed: results.filter(r => !r.ok && !r.skipped).length,
                skipped: results.filter(r => r.skipped).length
            }
        });

        return results;
    };

    // ==========================================
    // RESULTS TABLE (HTML) shown after Generate Invoice
    // ==========================================
    const renderResults = results => {

        const cell = 'padding:4px 10px;border-bottom:1px solid #ddd;';

        const rows = results.map(r => {

            let status;
            if (r.ok && r.warning) status = '<span style="color:#b36b00">Created, check link</span>';
            else if (r.ok) status = '<span style="color:#2e7d32">Created</span>';
            else if (r.skipped) status = '<span style="color:#b36b00">Skipped</span>';
            else status = '<span style="color:#c62828">Failed</span>';

            const invoiceCell = r.invoiceId
                ? '<a href="' + url.resolveRecord({ recordType: 'invoice', recordId: r.invoiceId }) +
                  '" target="_blank">' + escapeHtml(r.tranId || ('Invoice ' + r.invoiceId)) + '</a>'
                : '';

            return '<tr>' +
                '<td style="' + cell + '">' + escapeHtml(r.name) + '</td>' +
                '<td style="' + cell + '">' + status + '</td>' +
                '<td style="' + cell + '">' + invoiceCell + '</td>' +
                '<td style="' + cell + '">' + escapeHtml(r.message || '') + '</td>' +
                '</tr>';
        }).join('');

        return '<table style="border-collapse:collapse;font-size:13px;margin:4px 0">' +
            '<tr style="background:#eee;text-align:left">' +
            '<th style="padding:4px 10px">Billing Schedule</th>' +
            '<th style="padding:4px 10px">Result</th>' +
            '<th style="padding:4px 10px">Invoice</th>' +
            '<th style="padding:4px 10px">Note</th></tr>' + rows + '</table>';
    };

    // ==========================================
    // BUILD THE FORM
    // ==========================================
    const buildForm = (filters, result, errorText, runResults) => {

        const form = serverWidget.createForm({ title: 'Invoice Generation' });

        // Browser script that runs the Generate Invoice button
        form.clientScriptModulePath = './cli_cs_invoice_generation.js';

        // ----- Step 1: filter fields -----
        form.addFieldGroup({ id: 'custpage_grp_filters', label: 'Filters' });

        const subsidiaryField = form.addField({
            id: FIELD.SUBSIDIARY,
            type: serverWidget.FieldType.SELECT,
            label: 'Subsidiary',
            source: 'subsidiary',
            container: 'custpage_grp_filters'
        });
        subsidiaryField.isMandatory = true;

        form.addField({
            id: FIELD.CUSTOMER,
            type: serverWidget.FieldType.SELECT,
            label: 'Customer',
            source: 'customer',
            container: 'custpage_grp_filters'
        });

        const startField = form.addField({
            id: FIELD.START,
            type: serverWidget.FieldType.DATE,
            label: 'Start Date',
            container: 'custpage_grp_filters'
        });
        startField.isMandatory = true;

        const endField = form.addField({
            id: FIELD.END,
            type: serverWidget.FieldType.DATE,
            label: 'End Date',
            container: 'custpage_grp_filters'
        });
        endField.isMandatory = true;

        // Hidden fields used by the Generate Invoice button.
        // They stay empty on a Filter click, so Filter behaves exactly as before.
        const actionField = form.addField({
            id: FIELD.ACTION,
            type: serverWidget.FieldType.TEXT,
            label: 'Action'
        });
        actionField.updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });

        const selectedField = form.addField({
            id: FIELD.SELECTED,
            type: serverWidget.FieldType.TEXTAREA,
            label: 'Selected schedules'
        });
        selectedField.updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });

        // Keep the filters on screen after the page reloads
        if (filters) {
            if (filters.subsidiary) form.getField({ id: FIELD.SUBSIDIARY }).defaultValue = filters.subsidiary;
            if (filters.customer) form.getField({ id: FIELD.CUSTOMER }).defaultValue = filters.customer;
            if (filters.startDate) form.getField({ id: FIELD.START }).defaultValue = filters.startDate;
            if (filters.endDate) form.getField({ id: FIELD.END }).defaultValue = filters.endDate;
        }

        // ----- Step 2: buttons -----
        // Filter is the one submit button a form may have
        form.addSubmitButton({ label: 'Filter' });

        // Generate Invoice is a custom button. generateInvoice() in the browser script
        // collects the ticked rows, then submits the form with action = 'generate'.
        form.addButton({
            id: 'custpage_btn_generate',
            label: 'Generate Invoice',
            functionName: 'generateInvoice'
        });

        // ----- Messages -----
        if (errorText) {
            form.addPageInitMessage({
                type: message.Type.ERROR,
                title: 'Check the filters',
                message: errorText
            });
        } else if (runResults) {
            const created = runResults.filter(r => r.ok).length;
            const notCreated = runResults.length - created;
            const needsCheck = runResults.some(r => r.warning);

            // Warning when something failed OR an invoice was made but could not be linked
            form.addPageInitMessage({
                type: (notCreated || needsCheck) ? message.Type.WARNING : message.Type.CONFIRMATION,
                title: 'Invoice Generation finished',
                message: created + ' invoice(s) created' +
                         (notCreated ? ', ' + notCreated + ' not created' : '') +
                         (needsCheck ? ', at least one could not be linked to its schedule' : '') +
                         ((notCreated || needsCheck) ? '. See the table below.' : '.')
            });
        } else if (result && result.total === 0) {
            form.addPageInitMessage({
                type: message.Type.INFORMATION,
                title: 'No Billing Schedules found',
                message: 'Nothing matches the filters you selected (schedules that already have an invoice are not shown).'
            });
        } else if (result && result.total > MAX_ROWS) {
            form.addPageInitMessage({
                type: message.Type.WARNING,
                title: 'Too many results',
                message: 'Showing the first ' + MAX_ROWS + ' of ' + result.total +
                         ' Billing Schedules. Narrow the dates or select a Customer.'
            });
        }

        // ----- Result of the last Generate Invoice click -----
        if (runResults && runResults.length) {
            form.addFieldGroup({ id: 'custpage_grp_results', label: 'Last Generate Invoice run' });
            const resultsField = form.addField({
                id: 'custpage_results',
                type: serverWidget.FieldType.INLINEHTML,
                label: 'Results',
                container: 'custpage_grp_results'
            });
            resultsField.defaultValue = renderResults(runResults);
        }

        // ----- Step 3: sublist of Billing Schedules -----
        const rows = result ? result.rows : [];
        const totalAmount = rows.reduce((sum, r) => sum + r.amount, 0);

        const sublist = form.addSublist({
            id: SUBLIST_ID,
            type: serverWidget.SublistType.LIST,
            label: result
                ? 'Billing Schedules (' + rows.length + ') | Total ' + totalAmount.toFixed(2)
                : 'Billing Schedules'
        });

        const addColumn = (id, label, type) =>
            sublist.addField({ id, label, type: type || serverWidget.FieldType.TEXT });

        sublist.addMarkAllButtons();
        addColumn('custpage_col_select', 'Select', serverWidget.FieldType.CHECKBOX);
        // Visible on purpose: the browser script reads it to know which rows were ticked
        addColumn('custpage_col_id', 'ID', serverWidget.FieldType.INTEGER);
        addColumn('custpage_col_schedule', 'Billing Schedule');
        addColumn('custpage_col_so', 'Sales Order');
        addColumn('custpage_col_customer', 'Customer');
        addColumn('custpage_col_subsidiary', 'Subsidiary');
        addColumn('custpage_col_period', 'Period', serverWidget.FieldType.INTEGER);
        addColumn('custpage_col_from', 'Covered Period From', serverWidget.FieldType.DATE);
        addColumn('custpage_col_to', 'Covered Period To', serverWidget.FieldType.DATE);
        addColumn('custpage_col_due', 'Due Date', serverWidget.FieldType.DATE);
        addColumn('custpage_col_amount', 'Billing Amount', serverWidget.FieldType.CURRENCY);
        addColumn('custpage_col_qty', 'Quantity', serverWidget.FieldType.FLOAT);

        // Number and date columns reject a space or a badly formatted value
        // (INVALID_FLD_VALUE), so empty values are skipped and the cell stays blank.
        // One bad value is logged and skipped, it never blanks the whole page.
        const setValue = (id, line, value) => {

            if (value === null || value === undefined || value === '') return;

            try {
                sublist.setSublistValue({ id, line, value: String(value) });
            } catch (e) {
                log.error({
                    title: 'Sublist value skipped',
                    details: { column: id, line, value, error: e.message }
                });
            }
        };

        // Older schedule records hold a long unrounded quantity (e.g. 0.28033792592593).
        // Show it with the 5 decimals NetSuite keeps on the item line.
        const formatQuantity = value => {
            const number = Number(value);
            return value === '' || value === null || Number.isNaN(number)
                ? ''
                : number.toFixed(5);
        };

        rows.forEach((row, line) => {

            const scheduleUrl = url.resolveRecord({
                recordType: BILL_TYPE,
                recordId: row.id
            });
            const soUrl = url.resolveRecord({
                recordType: 'salesorder',
                recordId: row.soId
            });

            setValue('custpage_col_select', line, 'F');   // unticked
            setValue('custpage_col_id', line, row.id);
            setValue('custpage_col_schedule', line,
                '<a href="' + scheduleUrl + '" target="_blank">' + escapeHtml(row.name) + '</a>');
            setValue('custpage_col_so', line,
                '<a href="' + soUrl + '" target="_blank">' + escapeHtml(row.soText) + '</a>');
            setValue('custpage_col_customer', line, row.customer);
            setValue('custpage_col_subsidiary', line, row.subsidiary);
            setValue('custpage_col_period', line, row.period);
            setValue('custpage_col_from', line, row.from);
            setValue('custpage_col_to', line, row.to);
            setValue('custpage_col_due', line, row.dueDate);
            setValue('custpage_col_amount', line, row.amount.toFixed(2));
            setValue('custpage_col_qty', line, formatQuantity(row.quantity));
        });

        return form;
    };

    // ==========================================
    // ENTRY POINT
    // GET : empty form.
    // POST: Filter button (action empty) or Generate Invoice button (action 'generate').
    // Both rebuild the page with a fresh search, so invoiced schedules vanish at once.
    // ==========================================
    function onRequest(context) {

        const request = context.request;

        log.debug({ title: 'Invoice Generation request', details: { method: request.method } });

        // First visit: show the filters only
        if (request.method !== 'POST') {
            context.response.writePage(buildForm(null, null, '', null));
            return;
        }

        const params = request.parameters;
        const action = params[FIELD.ACTION] || '';

        log.debug({ title: 'Button clicked', details: { action: action || 'filter' } });

        const filters = readFilters(params);
        const filterError = validateFilters(filters);
        let errorText = filterError;
        let runResults = null;
        let result = null;

        // Invoices first, so the search below no longer returns them
        if (!errorText && action === 'generate') {

            const ids = parseSelectedIds(params[FIELD.SELECTED]);

            if (!ids.length) {
                errorText = 'Select at least one Billing Schedule.';
            } else {
                runResults = generateInvoices(ids);
            }
        }

        // Always refresh the list when the filters are valid, even after a message
        if (!filterError) {
            try {
                result = searchSchedules(filters);
            } catch (e) {
                // Show the problem on the page instead of a blank error screen
                log.error({ title: 'Billing schedule search failed', details: e });
                errorText = 'The search failed: ' + (e.message || e.name);
            }
        } else {
            log.error({ title: 'Invalid filters', details: { errorText, filters } });
        }

        context.response.writePage(buildForm(filters, result, errorText, runResults));
    }

    return { onRequest };
});