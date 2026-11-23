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
 * Steps 1 to 3 only (no invoice creation yet):
 *  1. A UI with 4 filter fields: Subsidiary, Customer, Start Date, End Date.
 *     Subsidiary, Start Date and End Date are mandatory.
 *  2. A Filter button. When clicked, the page reloads with the same filters
 *     and lists the matching Billing Schedules.
 *  3. A sublist at the bottom that shows the Billing Schedules found.
 *
 * The Subsidiary and Customer come from the Sales Order on each schedule
 * (customrecord_cli_billing_schedule has no subsidiary or customer field).
 */
define([
    'N/ui/serverWidget',
    'N/ui/message',
    'N/search',
    'N/url',
    'N/format',
    'N/log'
], (serverWidget, message, search, url, format, log) => {

    // ==========================================
    // SETTINGS (change here only)
    // ==========================================
    const BILL_TYPE = 'customrecord_cli_billing_schedule';
    const SO_FIELD = 'custrecord_cli_bs_sales_order';

    // The Start Date and End Date filter is applied to this schedule field.
    // Change it to custrecord_cli_bs_from if the range should use Covered Period From.
    const DATE_FILTER_FIELD = 'custrecord_cli_bs_due_date';

    // Most rows shown on one page (runPaged allows up to 1000)
    const MAX_ROWS = 1000;

    const FIELD = {
        SUBSIDIARY: 'custpage_subsidiary',
        CUSTOMER: 'custpage_customer',
        START: 'custpage_start_date',
        END: 'custpage_end_date'
    };

    const SUBLIST_ID = 'custpage_schedules';

    // ==========================================
    // READ FILTERS FROM THE REQUEST
    // Date values arrive as text in the user's own date format
    // ==========================================
    const readFilters = params => ({
        subsidiary: params[FIELD.SUBSIDIARY] || '',
        customer: params[FIELD.CUSTOMER] || '',
        startDate: params[FIELD.START] || '',
        endDate: params[FIELD.END] || ''
    });

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
    // Filters: date range on DATE_FILTER_FIELD, subsidiary and customer of the
    // linked Sales Order (customer is optional).
    // ==========================================
    const searchSchedules = filters => {

        const filterExpression = [
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
                'custrecord_cli_bs_status',
                search.createColumn({ name: 'entity', join: SO_FIELD }),
                search.createColumn({ name: 'subsidiary', join: SO_FIELD })
            ]
        });

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
                    quantity: result.getValue('custrecord_cli_quantity'),
                    status: result.getText('custrecord_cli_bs_status') ||
                            result.getValue('custrecord_cli_bs_status')
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
    // BUILD THE FORM
    // ==========================================
    const buildForm = (filters, result, errorText) => {

        const form = serverWidget.createForm({ title: 'Invoice Generation' });

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

        // Keep the filters on screen after the page reloads
        if (filters) {
            if (filters.subsidiary) form.getField({ id: FIELD.SUBSIDIARY }).defaultValue = filters.subsidiary;
            if (filters.customer) form.getField({ id: FIELD.CUSTOMER }).defaultValue = filters.customer;
            if (filters.startDate) form.getField({ id: FIELD.START }).defaultValue = filters.startDate;
            if (filters.endDate) form.getField({ id: FIELD.END }).defaultValue = filters.endDate;
        }

        // ----- Step 2: Filter button (submits the form back to this Suitelet) -----
        form.addSubmitButton({ label: 'Filter' });

        // ----- Messages -----
        if (errorText) {
            form.addPageInitMessage({
                type: message.Type.ERROR,
                title: 'Check the filters',
                message: errorText
            });
        } else if (result && result.total === 0) {
            form.addPageInitMessage({
                type: message.Type.INFORMATION,
                title: 'No Billing Schedules found',
                message: 'Nothing matches the filters you selected.'
            });
        } else if (result && result.total > MAX_ROWS) {
            form.addPageInitMessage({
                type: message.Type.WARNING,
                title: 'Too many results',
                message: 'Showing the first ' + MAX_ROWS + ' of ' + result.total +
                         ' Billing Schedules. Narrow the dates or select a Customer.'
            });
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
        addColumn('custpage_col_status', 'Billing Status');

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

            setValue('custpage_col_schedule', line,
                '<a href="' + scheduleUrl + '" target="_blank">' + row.name + '</a>');
            setValue('custpage_col_so', line,
                '<a href="' + soUrl + '" target="_blank">' + row.soText + '</a>');
            setValue('custpage_col_customer', line, row.customer);
            setValue('custpage_col_subsidiary', line, row.subsidiary);
            setValue('custpage_col_period', line, row.period);
            setValue('custpage_col_from', line, row.from);
            setValue('custpage_col_to', line, row.to);
            setValue('custpage_col_due', line, row.dueDate);
            setValue('custpage_col_amount', line, row.amount.toFixed(2));
            setValue('custpage_col_qty', line, formatQuantity(row.quantity));
            setValue('custpage_col_status', line, row.status);
        });

        return form;
    };

    // ==========================================
    // ENTRY POINT
    // GET : empty form.  POST (Filter button): same form, filled in and searched.
    // ==========================================
    function onRequest(context) {

        const request = context.request;

        log.debug({ title: 'Invoice Generation request', details: { method: request.method } });

        // First visit: show the filters only
        if (request.method !== 'POST') {
            context.response.writePage(buildForm(null, null, ''));
            return;
        }

        const filters = readFilters(request.parameters);
        let errorText = validateFilters(filters);
        let result = null;

        if (errorText) {
            log.error({ title: 'Invalid filters', details: { errorText, filters } });
        } else {
            try {
                result = searchSchedules(filters);
            } catch (e) {
                // Show the problem on the page instead of a blank error screen
                log.error({ title: 'Billing schedule search failed', details: e });
                errorText = 'The search failed: ' + (e.message || e.name);
            }
        }

        context.response.writePage(buildForm(filters, result, errorText));
    }

    return { onRequest };
});