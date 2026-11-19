/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 *
 * File:      cli_cs_contract_create.js
 * Name:      CLI Contract Create CS
 * Script ID: customscript_cli_cs_contract_create
 *
 * Runs in the browser while the Sales Order (lease contract) is being filled in.
 *  - Shows or hides Net Days based on Billing Type
 *  - Sets item Units and a preview Quantity from the Payment Terms and dates
 *
 * The saved values always come from the user event scripts
 * (cli_ue_contract_create.js / cli_ue_billing_update.js).
 * The quantity preview here uses the SAME contract-month rule as
 * cli_lib_billing.js so the number does not jump after saving.
 *
 * N/log in a client script writes to the browser console (F12).
 */
define(['N/log'], (log) => {

    const NET_DAYS_ID = '3';

    const UNIT_MAPPING = {
        'monthly': ['Month', 'mo'],
        'quarterly': ['Quarter', 'qrtr'],
        'semi-annual': ['Semi-Annual', 'smannl'],
        'annual': ['Year', 'yr']
    };

    // Number of months per billing period
    const TERM_MONTHS = {
        'monthly': 1,
        'quarterly': 3,
        'semi-annual': 6,
        'annual': 12
    };

    const DAY_MS = 24 * 60 * 60 * 1000;

    // Guards against our own updates re-triggering field events
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
    // NORMALIZE DATE
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
    // ADD CONTRACT MONTHS
    // Same day-of-month N months later, clamped to month end
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
    // INCLUSIVE DAY COUNT (start and end both counted)
    // ==========================================
    function countDays(start, end) {

        return Math.round(
            (end.getTime() - start.getTime()) /
            DAY_MS
        ) + 1;
    }

    // ==========================================
    // EFFECTIVE END DATE (matches the server rule)
    // If the end date falls exactly on a contract anniversary
    // (e.g. 1/1/2026 to 1/1/2027), the last covered day is the day before.
    // ==========================================
    function getEffectiveEndDate(start, end) {

        const months =
            (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
            end.getUTCMonth() - start.getUTCMonth();

        if (
            months > 0 &&
            addMonths(start, months).getTime() === end.getTime()
        ) {
            return new Date(end.getTime() - DAY_MS);
        }

        return end;
    }

    // ==========================================
    // CHANGED: CALCULATE PREVIEW QUANTITY
    // Same contract-month rule as cli_lib_billing.js:
    //  - a full contract month counts as 1
    //  - a partial month counts as coveredDays / that month's own days
    //  - quantity = total months / months per billing period (5 decimals)
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

        // Terms not selected yet (or unsupported): nothing to calculate
        if (!periodMonths) {
            log.debug('calculateQuantity: terms not ready', termsText);
            return null;
        }

        const effectiveEnd = getEffectiveEndDate(start, end);

        let totalMonths = 0;

        for (
            let m = 0;
            m < 1200 && addMonths(start, m) <= effectiveEnd;
            m++
        ) {

            const monthStart = addMonths(start, m);

            // Last day of this contract month (day before the next anniversary)
            const monthEnd = new Date(
                addMonths(start, m + 1).getTime() - DAY_MS
            );

            const coveredEnd =
                monthEnd < effectiveEnd
                    ? monthEnd
                    : effectiveEnd;

            totalMonths +=
                countDays(monthStart, coveredEnd) /
                countDays(monthStart, monthEnd);
        }

        // NetSuite keeps 5 decimals on item quantity
        const quantity = Math.round(
            (totalMonths / periodMonths + Number.EPSILON) * 1e5
        ) / 1e5;

        log.debug('calculateQuantity', {
            terms: termsText,
            effectiveEnd: effectiveEnd.toISOString(),
            totalMonths,
            quantity
        });

        return quantity;
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
            log.error('findUnit: cannot read unit options', e);
            return null;
        }

        // Options not loaded yet (e.g. item just picked)
        if (!options || !options.length) {
            log.error('findUnit: no unit options loaded', { termsText });
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

        // Shows what NetSuite really offers so UNIT_MAPPING can be fixed
        if (!selected) {
            log.error('findUnit: no matching unit', {
                termsText,
                wanted: validNames,
                available: options.map(o => o.text)
            });
            return null;
        }

        return selected.value;
    }

    // ==========================================
    // UPDATE QUANTITY AND UNITS ON THE CURRENT LINE
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

        log.debug('Item line updated', {
            terms: termsText,
            quantity: quantity,
            unitId: unitId
        });
    }

    // ==========================================
    // UPDATE EXISTING ITEM LINES
    // Runs when Terms, Start Date or End Date change
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

            log.error('Error updating item lines', e);

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
    // Runs when an item is picked. Terms may not be set yet,
    // so validateLine below repeats the update before the line is added.
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

    // ==========================================
    // ADDED: VALIDATE LINE
    // Runs right before a line is committed (Add / OK).
    // By then Terms, dates and the unit list are ready, so the result
    // does not depend on the order the form was filled in.
    // ==========================================
    function validateLine(context) {

        // Ignore the commits made by our own loop in updateExistingItemLines
        if (isUpdating) return true;

        if (context.sublistId !== 'item') return true;

        isUpdating = true;

        try {

            updateItemLine(context.currentRecord);

            log.debug('validateLine: units and quantity refreshed', {
                terms: context.currentRecord.getText({
                    fieldId: 'terms'
                }),
                units: context.currentRecord.getCurrentSublistText({
                    sublistId: 'item',
                    fieldId: 'units'
                })
            });

        } catch (e) {

            // The preview must never block the user from adding a line
            log.error('validateLine failed', e);

        } finally {

            isUpdating = false;
        }

        return true;
    }

    return {
        pageInit,
        fieldChanged,
        postSourcing,
        validateLine
    };
});