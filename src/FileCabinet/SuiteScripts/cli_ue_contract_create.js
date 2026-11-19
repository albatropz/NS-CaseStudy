/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 *
 * File:      cli_ue_contract_create.js
 * Name:      CLI Contract Create UE
 * Script ID: customscript_cli_ue_contract_create
 *
 * CREATE only. The Sales Order is the lease contract.
 *  beforeSubmit: convert entered monthly rates into the master item values
 *  afterSubmit : create the Succeeding bills (breakdown of the master values)
 *
 * All billing math lives in cli_lib_billing.js (keep both in the same folder).
 */
define(['N/log', './cli_lib_billing'], (log, lib) => {

    // ==========================================
    // BEFORE SUBMIT
    // ==========================================
    function beforeSubmit(context) {

        if (context.type !== context.UserEventType.CREATE) return;

        const so = context.newRecord;

        // On CREATE the entered item rates are MONTHLY rates (one per unit)
        const monthlyRates = lib.readMonthlyRates(so, 1);

        // Master totals + breakdown. Throws on invalid dates, terms or billing type
        const calc = lib.generateSchedule(so, monthlyRates);

        // Item lines: QTY = total periods, RATE = term rate, AMOUNT = master amount
        lib.applyItemLines(so, calc);

        // Summary body fields (monthly rental, totals, first billing period)
        lib.setSummaryFields(so, calc);

        log.audit({
            title: 'Contract billing validated (CREATE)',
            details: {
                lines: calc.lines.length,
                billingMonths: calc.billingMonths,
                periods: calc.schedule.length,
                totalQty: calc.totals.totalQty,
                totalAmount: calc.totals.totalAmount
            }
        });
    }

    // ==========================================
    // AFTER SUBMIT
    // ==========================================
    function afterSubmit(context) {

        if (context.type !== context.UserEventType.CREATE) return;

        const so = context.newRecord;

        // Saved item rates are TERM based. Divide back to monthly rates
        const billingMonths = lib.getBillingMonths(
            so.getValue({ fieldId: 'terms' })
        );
        const monthlyRates = lib.readMonthlyRates(so, billingMonths);

        // Same library call as beforeSubmit, so the numbers are identical
        const calc = lib.generateSchedule(so, monthlyRates);

        // Safety net: compare the saved item lines with the schedule
        lib.verifySavedLines(so, calc);

        // Succeeding bills
        lib.createBillingRecords(so.id, calc.schedule);

        log.audit({
            title: 'Billing schedule generated (CREATE)',
            details: {
                salesOrderId: so.id,
                periods: calc.schedule.length,
                totalAmount: calc.totals.totalAmount
            }
        });
    }

    return { beforeSubmit, afterSubmit };
});