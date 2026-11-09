
/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define([], () => {

    const NET_DAYS_ID = '3';

    // ADDED: Payment Terms to Unit mapping
    const UNIT_MAPPING = {
        'monthly': ['Month', 'mo'],
        'quarterly': ['Quarter', 'qrtr'],
        'semi-annual': ['Semi-Annual', 'smannl'],
        'annual': ['Year', 'yr']
    };

    // ==========================================
    // NET DAYS FIELD
    // ==========================================
    function updateNetDaysField(rec) {

        const billingType = rec.getValue({
            fieldId: 'custbody_cli_billing_type'
        });

        const netDaysField = rec.getField({
            fieldId: 'custbody_cli_net_days'
        });

        if (!netDaysField) return;

        const isNetDays =
            String(billingType) === NET_DAYS_ID;

        netDaysField.isMandatory = isNetDays;
        netDaysField.isDisplay = isNetDays;
    }

    // ==========================================
    // COUNT CONTRACT MONTHS
    // ==========================================
    function countMonths(startDate, endDate) {

        if (
            !(startDate instanceof Date) ||
            !(endDate instanceof Date) ||
            isNaN(startDate.getTime()) ||
            isNaN(endDate.getTime()) ||
            endDate < startDate
        ) {
            return 0;
        }

        return (
            (endDate.getFullYear() -
                startDate.getFullYear()) * 12 +
            endDate.getMonth() -
            startDate.getMonth() + 1
        );
    }

    // ==========================================
    // ADDED: FIND UNIT VALUE
    // ==========================================
    function findUnit(rec, termsText) {

        const mapping = UNIT_MAPPING[
            String(termsText || '').trim().toLowerCase()
        ];

        if (!mapping) {
            console.log('Unmapped payment terms:', termsText);
            return null;
        }

        const unitField = rec.getCurrentSublistField({
            sublistId: 'item',
            fieldId: 'units'
        });

        if (!unitField) {
            console.log('Units field unavailable');
            return null;
        }

        let options;

        try {
            options = unitField.getSelectOptions({
                filter: '',
                operator: 'contains'
            });
        } catch (e) {
            console.log('Cannot read unit options:', e);
            return null;
        }

        if (!options || !options.length) {
            console.log('No unit options returned');
            return null;
        }

        const validNames = mapping.map(
            value => value.toLowerCase()
        );

        const selected = options.find(option =>
            validNames.includes(
                String(option.text || '').trim().toLowerCase()
            )
        );

        if (!selected) {
            console.log('Matching unit not found:', {
                termsText,
                options
            });
            return null;
        }

        return selected.value;
    }

    // ==========================================
    // CHANGED: POPULATE QUANTITY AND UNITS
    // ==========================================
    function updateItemLine(rec) {

        const itemId = rec.getCurrentSublistValue({
            sublistId: 'item',
            fieldId: 'item'
        });

        if (!itemId) return;

        const startDate = rec.getValue({
            fieldId: 'startdate'
        });

        const endDate = rec.getValue({
            fieldId: 'enddate'
        });

        const months = countMonths(
            startDate,
            endDate
        );

        // Quantity depends on dates only
        if (months > 0) {

            rec.setCurrentSublistValue({
                sublistId: 'item',
                fieldId: 'quantity',
                value: months,
                ignoreFieldChange: false
            });
        }

        const termsText = rec.getText({
            fieldId: 'terms'
        });

        const unitId = findUnit(rec, termsText);

        if (unitId !== null) {

            rec.setCurrentSublistValue({
                sublistId: 'item',
                fieldId: 'units',
                value: unitId,
                ignoreFieldChange: true
            });

            console.log('Units updated:', {
                terms: termsText,
                unitId: unitId,
                quantity: months
            });
        }
    }

    // ==========================================
    // ADDED: UPDATE EXISTING ITEM LINES
    // ==========================================
    function updateExistingItemLines(rec) {

        const lineCount = rec.getLineCount({
            sublistId: 'item'
        });

        for (let i = 0; i < lineCount; i++) {

            rec.selectLine({
                sublistId: 'item',
                line: i
            });

            updateItemLine(rec);

            rec.commitLine({
                sublistId: 'item'
            });
        }
    }

    // ==========================================
    // PAGE INIT
    // ==========================================
    function pageInit(context) {

        updateNetDaysField(context.currentRecord);
    }

    // ==========================================
    // FIELD CHANGED
    // ==========================================
    function fieldChanged(context) {

        const rec = context.currentRecord;

        if (
            context.fieldId ===
            'custbody_cli_billing_type'
        ) {
            updateNetDaysField(rec);
            return;
        }

        // CHANGED: React to terms and dates
        if (
            !context.sublistId &&
            (
                context.fieldId === 'terms' ||
                context.fieldId === 'startdate' ||
                context.fieldId === 'enddate'
            )
        ) {
            updateExistingItemLines(rec);
        }
    }

    // ==========================================
    // POST SOURCING
    // ==========================================
    function postSourcing(context) {

        if (
            context.sublistId === 'item' &&
            context.fieldId === 'item'
        ) {
            updateItemLine(context.currentRecord);
        }
    }

    return {
        pageInit,
        fieldChanged,
        postSourcing
    };
});
