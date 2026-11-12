
/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define([], () => {

    const NET_DAYS_ID = '3';

    const UNIT_MAPPING = {
        'monthly': ['Month', 'mo'],
        'quarterly': ['Quarter', 'qrtr'],
        'semi-annual': ['Semi-Annual', 'smannl'],
        'annual': ['Year', 'yr']
    };

    // ADDED: Number of months per billing period
    const TERM_MONTHS = {
        'monthly': 1,
        'quarterly': 3,
        'semi-annual': 6,
        'annual': 12
    };

    let isUpdating = false;

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
    // ADDED: NORMALIZE DATE
    // ==========================================
    function normalizeDate(value) {

        if (!(value instanceof Date)) {
            return null;
        }

        if (isNaN(value.getTime())) {
            return null;
        }

        return new Date(Date.UTC(
            value.getFullYear(),
            value.getMonth(),
            value.getDate()
        ));
    }

    // ==========================================
    // ADDED: ADD CONTRACT MONTHS
    // ==========================================
    function addMonths(date, months) {

        const year = date.getUTCFullYear();
        const month = date.getUTCMonth() + months;
        const day = date.getUTCDate();

        const target = new Date(
            Date.UTC(year, month, 1)
        );

        const lastDay = new Date(
            Date.UTC(
                target.getUTCFullYear(),
                target.getUTCMonth() + 1,
                0
            )
        ).getUTCDate();

        target.setUTCDate(
            Math.min(day, lastDay)
        );

        return target;
    }

    // ==========================================
    // ADDED: COUNT DAYS
    // ==========================================
    function daysBetween(start, end) {

        const DAY_MS = 24 * 60 * 60 * 1000;

        return Math.round(
            (end.getTime() - start.getTime()) /
            DAY_MS
        );
    }

    // ==========================================
    // CHANGED: CALCULATE BILLING QUANTITY
    // ==========================================
    function calculateQuantity(
        startDate,
        endDate,
        termsText
    ) {

        const start = normalizeDate(startDate);
        const end = normalizeDate(endDate);

        if (!start || !end || end < start) {
            return 0;
        }

        const term = String(
            termsText || ''
        ).trim().toLowerCase();

        const periodMonths = TERM_MONTHS[term];

        if (!periodMonths) {
            console.log(
                'Unsupported payment term:',
                termsText
            );
            return null;
        }

        // Inclusive contract end date
        const endExclusive = new Date(
            end.getTime() + 86400000
        );

        let quantity = 0;
        let periodIndex = 0;

        while (periodIndex < 1200) {

            const periodStart = addMonths(
                start,
                periodIndex * periodMonths
            );

            if (periodStart >= endExclusive) {
                break;
            }

            const periodEnd = addMonths(
                start,
                (periodIndex + 1) * periodMonths
            );

            const actualEnd =
                endExclusive < periodEnd
                    ? endExclusive
                    : periodEnd;

            const consumedDays = daysBetween(
                periodStart,
                actualEnd
            );

            const fullPeriodDays = daysBetween(
                periodStart,
                periodEnd
            );

            if (fullPeriodDays <= 0) {
                break;
            }

            quantity +=
                consumedDays / fullPeriodDays;

            periodIndex++;
        }

        // Round for NetSuite quantity display
        return Number(quantity.toFixed(6));
    }

    // ==========================================
    // FIND UNIT VALUE
    // ==========================================
    function findUnit(rec, termsText) {

        const mapping = UNIT_MAPPING[
            String(termsText || '')
                .trim()
                .toLowerCase()
        ];

        if (!mapping) return null;

        const unitField =
            rec.getCurrentSublistField({
                sublistId: 'item',
                fieldId: 'units'
            });

        if (!unitField) return null;

        let options;

        try {
            options = unitField.getSelectOptions({
                filter: '',
                operator: 'contains'
            });
        } catch (e) {
            console.log(
                'Cannot read unit options:',
                e
            );
            return null;
        }

        if (!options || !options.length) {
            return null;
        }

        const validNames = mapping.map(
            value => value.toLowerCase()
        );

        const selected = options.find(
            option => validNames.includes(
                String(option.text || '')
                    .trim()
                    .toLowerCase()
            )
        );

        return selected
            ? selected.value
            : null;
    }

    // ==========================================
    // CHANGED: UPDATE QUANTITY AND UNITS
    // ==========================================
    function updateItemLine(rec) {

        const itemId =
            rec.getCurrentSublistValue({
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

        const termsText = rec.getText({
            fieldId: 'terms'
        });

        const quantity = calculateQuantity(
            startDate,
            endDate,
            termsText
        );

        if (quantity === null) return;

        const unitId = findUnit(
            rec,
            termsText
        );

        // Update units first
        if (unitId !== null) {

            rec.setCurrentSublistValue({
                sublistId: 'item',
                fieldId: 'units',
                value: unitId,
                ignoreFieldChange: true
            });
        }

        // Then update quantity
        if (quantity > 0) {

            rec.setCurrentSublistValue({
                sublistId: 'item',
                fieldId: 'quantity',
                value: quantity,
                ignoreFieldChange: false
            });
        }

        console.log(
            'Billing quantity updated:',
            {
                terms: termsText,
                quantity: quantity,
                unitId: unitId
            }
        );
    }

    // ==========================================
    // UPDATE EXISTING ITEM LINES
    // ==========================================
    function updateExistingItemLines(rec) {

        if (isUpdating) return;

        isUpdating = true;

        try {

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

        } catch (e) {

            console.error(
                'Error updating item lines:',
                e
            );

        } finally {

            isUpdating = false;
        }
    }

    // ==========================================
    // PAGE INIT
    // ==========================================
    function pageInit(context) {

        updateNetDaysField(
            context.currentRecord
        );
    }

    // ==========================================
    // FIELD CHANGED
    // ==========================================
    function fieldChanged(context) {

        if (isUpdating) return;

        const rec = context.currentRecord;

        if (
            context.fieldId ===
            'custbody_cli_billing_type'
        ) {

            updateNetDaysField(rec);
            return;
        }

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

        if (isUpdating) return;

        if (
            context.sublistId === 'item' &&
            context.fieldId === 'item'
        ) {

            updateItemLine(
                context.currentRecord
            );
        }
    }

    return {
        pageInit,
        fieldChanged,
        postSourcing
    };
});
