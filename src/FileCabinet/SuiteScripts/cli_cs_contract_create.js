/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define([], () => {

    // Replace with the actual Internal ID
    // of the Net Days option in your custom list.
    const NET_DAYS_ID = '3';

    //  Dynamically configure Net Days
    function updateNetDaysField(rec) {

        const billingType = rec.getValue({
            fieldId: 'custbody_cli_billing_type'
        });

        const netDaysField = rec.getField({
            fieldId: 'custbody_cli_net_days'
        });

        if (!netDaysField) {
            return;
        }

        const isNetDays =
            String(billingType) === NET_DAYS_ID;

        // Make mandatory only for Net Days billing
        netDaysField.isMandatory = isNetDays;

        // Optional: Hide when not applicable
        netDaysField.isDisplay = isNetDays;
    }

    // Run when Sales Order form opens
    function pageInit(context) {
        updateNetDaysField(context.currentRecord);
    }

    //  Run when Billing Type changes
    function fieldChanged(context) {

        if (
            context.fieldId !==
            'custbody_cli_billing_type'
        ) {
            return;
        }

        updateNetDaysField(context.currentRecord);
    }

    return {
        pageInit,
        fieldChanged
    };
});