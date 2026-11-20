/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 *
 * File:      cli_mr_billing_tests.js
 * Name:      CLI Billing Automated Tests MR
 * Script ID: customscript_cli_mr_billing_tests
 *
 * SANDBOX ONLY. Creates real Sales Orders and billing records, checks the
 * results against fixed expected values, then deletes them.
 *
 * 48 cases (4 Payment Terms x 12 scenarios) + 4 negative checks.
 * Expected values are hard-coded (generated independently of cli_lib_billing.js)
 * so the library is not used to grade itself.
 *
 * Setup: fill in CONFIG below, deploy with concurrency 1-3, run once.
 * Output: execution log + a CSV in RESULTS_FOLDER_ID (if set).
 */
define(['N/record', 'N/search', 'N/format', 'N/file', 'N/log', 'N/runtime'],
(record, search, format, file, log, runtime) => {

    // ==========================================
    // CONFIG: EDIT THESE FOR YOUR SANDBOX
    // ==========================================
    const CONFIG = {
        CUSTOMER_ID: 130,          // internal ID of a test customer (required)
        ITEM_ID: 38,              // internal ID of a test lease item whose unit type has
                                 // Month, Quarter, Semi-Annual, Year (required)
        SUBSIDIARY_ID: 6,        // OneWorld only
        LOCATION_ID: null,       // only if Location is mandatory on your Sales Order
        RESULTS_FOLDER_ID: null, // File Cabinet folder ID for the CSV (optional)
        CLEANUP: true,           // delete test SOs and bills afterwards
        MEMO: 'CLI_AUTOTEST'
    };

    const BILL_TYPE = 'customrecord_cli_billing_schedule';

    // Negative checks (not term specific)
    const NEG_CASES = [
        { id: 'NEG-01', kind: 'NEG', scenario: 'End date before start date', code: 'INVALID_DATE_RANGE' },
        { id: 'NEG-02', kind: 'NEG', scenario: 'Net Days type with blank Net Days', code: 'INVALID_NET_DAYS' },
        { id: 'NEG-03', kind: 'NEG', scenario: 'EDIT terms with past-due bill', code: 'PAST_DUE_BILLING_RECORD' },
        { id: 'NEG-04', kind: 'NEG', scenario: 'EDIT terms while removing an item line', code: 'ITEM_LINES_CHANGED' }
    ];

    // Generated expected values
    const POS_CASES = [
{"id": "MO-01", "kind": "POS", "term": "Monthly", "terms": "5", "scenario": "Exact calendar year", "type": "CREATE", "start": "2026-01-01", "end": "2026-12-31", "billingType": "1", "netDays": null, "rates": [10000], "units": ["month", "mo"], "qty": 12.0, "lines": [{"rate": 10000, "amount": 120000.0}], "bills": [{"from": "2026-01-01", "to": "2026-01-31", "due": "2026-01-01", "qty": 1.0, "amount": 10000.0}, {"from": "2026-02-01", "to": "2026-02-28", "due": "2026-02-01", "qty": 1.0, "amount": 10000.0}, {"from": "2026-03-01", "to": "2026-03-31", "due": "2026-03-01", "qty": 1.0, "amount": 10000.0}, {"from": "2026-04-01", "to": "2026-04-30", "due": "2026-04-01", "qty": 1.0, "amount": 10000.0}, {"from": "2026-05-01", "to": "2026-05-31", "due": "2026-05-01", "qty": 1.0, "amount": 10000.0}, {"from": "2026-06-01", "to": "2026-06-30", "due": "2026-06-01", "qty": 1.0, "amount": 10000.0}, {"from": "2026-07-01", "to": "2026-07-31", "due": "2026-07-01", "qty": 1.0, "amount": 10000.0}, {"from": "2026-08-01", "to": "2026-08-31", "due": "2026-08-01", "qty": 1.0, "amount": 10000.0}, {"from": "2026-09-01", "to": "2026-09-30", "due": "2026-09-01", "qty": 1.0, "amount": 10000.0}, {"from": "2026-10-01", "to": "2026-10-31", "due": "2026-10-01", "qty": 1.0, "amount": 10000.0}, {"from": "2026-11-01", "to": "2026-11-30", "due": "2026-11-01", "qty": 1.0, "amount": 10000.0}, {"from": "2026-12-01", "to": "2026-12-31", "due": "2026-12-01", "qty": 1.0, "amount": 10000.0}]},
{"id": "MO-02", "kind": "POS", "term": "Monthly", "terms": "5", "scenario": "End date on anniversary", "type": "CREATE", "start": "2026-01-01", "end": "2027-01-01", "billingType": "1", "netDays": null, "rates": [10000], "units": ["month", "mo"], "qty": 12.0, "lines": [{"rate": 10000, "amount": 120000.0}], "bills": [{"from": "2026-01-01", "to": "2026-01-31", "due": "2026-01-01", "qty": 1.0, "amount": 10000.0}, {"from": "2026-02-01", "to": "2026-02-28", "due": "2026-02-01", "qty": 1.0, "amount": 10000.0}, {"from": "2026-03-01", "to": "2026-03-31", "due": "2026-03-01", "qty": 1.0, "amount": 10000.0}, {"from": "2026-04-01", "to": "2026-04-30", "due": "2026-04-01", "qty": 1.0, "amount": 10000.0}, {"from": "2026-05-01", "to": "2026-05-31", "due": "2026-05-01", "qty": 1.0, "amount": 10000.0}, {"from": "2026-06-01", "to": "2026-06-30", "due": "2026-06-01", "qty": 1.0, "amount": 10000.0}, {"from": "2026-07-01", "to": "2026-07-31", "due": "2026-07-01", "qty": 1.0, "amount": 10000.0}, {"from": "2026-08-01", "to": "2026-08-31", "due": "2026-08-01", "qty": 1.0, "amount": 10000.0}, {"from": "2026-09-01", "to": "2026-09-30", "due": "2026-09-01", "qty": 1.0, "amount": 10000.0}, {"from": "2026-10-01", "to": "2026-10-31", "due": "2026-10-01", "qty": 1.0, "amount": 10000.0}, {"from": "2026-11-01", "to": "2026-11-30", "due": "2026-11-01", "qty": 1.0, "amount": 10000.0}, {"from": "2026-12-01", "to": "2026-12-31", "due": "2026-12-01", "qty": 1.0, "amount": 10000.0}]},
{"id": "MO-03", "kind": "POS", "term": "Monthly", "terms": "5", "scenario": "Mid-month start", "type": "CREATE", "start": "2026-01-19", "end": "2027-01-18", "billingType": "1", "netDays": null, "rates": [10000], "units": ["month", "mo"], "qty": 12.0, "lines": [{"rate": 10000, "amount": 120000.0}], "bills": [{"from": "2026-01-19", "to": "2026-02-18", "due": "2026-01-19", "qty": 1.0, "amount": 10000.0}, {"from": "2026-02-19", "to": "2026-03-18", "due": "2026-02-19", "qty": 1.0, "amount": 10000.0}, {"from": "2026-03-19", "to": "2026-04-18", "due": "2026-03-19", "qty": 1.0, "amount": 10000.0}, {"from": "2026-04-19", "to": "2026-05-18", "due": "2026-04-19", "qty": 1.0, "amount": 10000.0}, {"from": "2026-05-19", "to": "2026-06-18", "due": "2026-05-19", "qty": 1.0, "amount": 10000.0}, {"from": "2026-06-19", "to": "2026-07-18", "due": "2026-06-19", "qty": 1.0, "amount": 10000.0}, {"from": "2026-07-19", "to": "2026-08-18", "due": "2026-07-19", "qty": 1.0, "amount": 10000.0}, {"from": "2026-08-19", "to": "2026-09-18", "due": "2026-08-19", "qty": 1.0, "amount": 10000.0}, {"from": "2026-09-19", "to": "2026-10-18", "due": "2026-09-19", "qty": 1.0, "amount": 10000.0}, {"from": "2026-10-19", "to": "2026-11-18", "due": "2026-10-19", "qty": 1.0, "amount": 10000.0}, {"from": "2026-11-19", "to": "2026-12-18", "due": "2026-11-19", "qty": 1.0, "amount": 10000.0}, {"from": "2026-12-19", "to": "2027-01-18", "due": "2026-12-19", "qty": 1.0, "amount": 10000.0}]},
{"id": "MO-04", "kind": "POS", "term": "Monthly", "terms": "5", "scenario": "Month-end start (clamping)", "type": "CREATE", "start": "2026-01-31", "end": "2027-01-30", "billingType": "1", "netDays": null, "rates": [10000], "units": ["month", "mo"], "qty": 12.0, "lines": [{"rate": 10000, "amount": 120000.0}], "bills": [{"from": "2026-01-31", "to": "2026-02-27", "due": "2026-01-31", "qty": 1.0, "amount": 10000.0}, {"from": "2026-02-28", "to": "2026-03-30", "due": "2026-02-28", "qty": 1.0, "amount": 10000.0}, {"from": "2026-03-31", "to": "2026-04-29", "due": "2026-03-31", "qty": 1.0, "amount": 10000.0}, {"from": "2026-04-30", "to": "2026-05-30", "due": "2026-04-30", "qty": 1.0, "amount": 10000.0}, {"from": "2026-05-31", "to": "2026-06-29", "due": "2026-05-31", "qty": 1.0, "amount": 10000.0}, {"from": "2026-06-30", "to": "2026-07-30", "due": "2026-06-30", "qty": 1.0, "amount": 10000.0}, {"from": "2026-07-31", "to": "2026-08-30", "due": "2026-07-31", "qty": 1.0, "amount": 10000.0}, {"from": "2026-08-31", "to": "2026-09-29", "due": "2026-08-31", "qty": 1.0, "amount": 10000.0}, {"from": "2026-09-30", "to": "2026-10-30", "due": "2026-09-30", "qty": 1.0, "amount": 10000.0}, {"from": "2026-10-31", "to": "2026-11-29", "due": "2026-10-31", "qty": 1.0, "amount": 10000.0}, {"from": "2026-11-30", "to": "2026-12-30", "due": "2026-11-30", "qty": 1.0, "amount": 10000.0}, {"from": "2026-12-31", "to": "2027-01-30", "due": "2026-12-31", "qty": 1.0, "amount": 10000.0}]},
{"id": "MO-05", "kind": "POS", "term": "Monthly", "terms": "5", "scenario": "Partial last month", "type": "CREATE", "start": "2026-01-01", "end": "2027-01-15", "billingType": "1", "netDays": null, "rates": [10000], "units": ["month", "mo"], "qty": 12.48387, "lines": [{"rate": 10000, "amount": 124838.71}], "bills": [{"from": "2026-01-01", "to": "2026-01-31", "due": "2026-01-01", "qty": 1.0, "amount": 10000.0}, {"from": "2026-02-01", "to": "2026-02-28", "due": "2026-02-01", "qty": 1.0, "amount": 10000.0}, {"from": "2026-03-01", "to": "2026-03-31", "due": "2026-03-01", "qty": 1.0, "amount": 10000.0}, {"from": "2026-04-01", "to": "2026-04-30", "due": "2026-04-01", "qty": 1.0, "amount": 10000.0}, {"from": "2026-05-01", "to": "2026-05-31", "due": "2026-05-01", "qty": 1.0, "amount": 10000.0}, {"from": "2026-06-01", "to": "2026-06-30", "due": "2026-06-01", "qty": 1.0, "amount": 10000.0}, {"from": "2026-07-01", "to": "2026-07-31", "due": "2026-07-01", "qty": 1.0, "amount": 10000.0}, {"from": "2026-08-01", "to": "2026-08-31", "due": "2026-08-01", "qty": 1.0, "amount": 10000.0}, {"from": "2026-09-01", "to": "2026-09-30", "due": "2026-09-01", "qty": 1.0, "amount": 10000.0}, {"from": "2026-10-01", "to": "2026-10-31", "due": "2026-10-01", "qty": 1.0, "amount": 10000.0}, {"from": "2026-11-01", "to": "2026-11-30", "due": "2026-11-01", "qty": 1.0, "amount": 10000.0}, {"from": "2026-12-01", "to": "2026-12-31", "due": "2026-12-01", "qty": 1.0, "amount": 10000.0}, {"from": "2027-01-01", "to": "2027-01-15", "due": "2027-01-01", "qty": 0.48387, "amount": 4838.71}]},
{"id": "MO-06", "kind": "POS", "term": "Monthly", "terms": "5", "scenario": "One full month", "type": "CREATE", "start": "2026-01-01", "end": "2026-01-31", "billingType": "1", "netDays": null, "rates": [10000], "units": ["month", "mo"], "qty": 1.0, "lines": [{"rate": 10000, "amount": 10000.0}], "bills": [{"from": "2026-01-01", "to": "2026-01-31", "due": "2026-01-01", "qty": 1.0, "amount": 10000.0}]},
{"id": "MO-07", "kind": "POS", "term": "Monthly", "terms": "5", "scenario": "Partial month only", "type": "CREATE", "start": "2026-01-01", "end": "2026-01-10", "billingType": "1", "netDays": null, "rates": [10000], "units": ["month", "mo"], "qty": 0.32258, "lines": [{"rate": 10000, "amount": 3225.81}], "bills": [{"from": "2026-01-01", "to": "2026-01-10", "due": "2026-01-01", "qty": 0.32258, "amount": 3225.81}]},
{"id": "MO-08", "kind": "POS", "term": "Monthly", "terms": "5", "scenario": "Leap-year Feb partial", "type": "CREATE", "start": "2028-02-01", "end": "2028-02-14", "billingType": "1", "netDays": null, "rates": [10000], "units": ["month", "mo"], "qty": 0.48276, "lines": [{"rate": 10000, "amount": 4827.59}], "bills": [{"from": "2028-02-01", "to": "2028-02-14", "due": "2028-02-01", "qty": 0.48276, "amount": 4827.59}]},
{"id": "MO-09", "kind": "POS", "term": "Monthly", "terms": "5", "scenario": "Two item lines", "type": "CREATE", "start": "2026-01-01", "end": "2026-12-31", "billingType": "1", "netDays": null, "rates": [10000, 5000], "units": ["month", "mo"], "qty": 12.0, "lines": [{"rate": 10000, "amount": 120000.0}, {"rate": 5000, "amount": 60000.0}], "bills": [{"from": "2026-01-01", "to": "2026-01-31", "due": "2026-01-01", "qty": 1.0, "amount": 15000.0}, {"from": "2026-02-01", "to": "2026-02-28", "due": "2026-02-01", "qty": 1.0, "amount": 15000.0}, {"from": "2026-03-01", "to": "2026-03-31", "due": "2026-03-01", "qty": 1.0, "amount": 15000.0}, {"from": "2026-04-01", "to": "2026-04-30", "due": "2026-04-01", "qty": 1.0, "amount": 15000.0}, {"from": "2026-05-01", "to": "2026-05-31", "due": "2026-05-01", "qty": 1.0, "amount": 15000.0}, {"from": "2026-06-01", "to": "2026-06-30", "due": "2026-06-01", "qty": 1.0, "amount": 15000.0}, {"from": "2026-07-01", "to": "2026-07-31", "due": "2026-07-01", "qty": 1.0, "amount": 15000.0}, {"from": "2026-08-01", "to": "2026-08-31", "due": "2026-08-01", "qty": 1.0, "amount": 15000.0}, {"from": "2026-09-01", "to": "2026-09-30", "due": "2026-09-01", "qty": 1.0, "amount": 15000.0}, {"from": "2026-10-01", "to": "2026-10-31", "due": "2026-10-01", "qty": 1.0, "amount": 15000.0}, {"from": "2026-11-01", "to": "2026-11-30", "due": "2026-11-01", "qty": 1.0, "amount": 15000.0}, {"from": "2026-12-01", "to": "2026-12-31", "due": "2026-12-01", "qty": 1.0, "amount": 15000.0}]},
{"id": "MO-10", "kind": "POS", "term": "Monthly", "terms": "5", "scenario": "Arrears", "type": "CREATE", "start": "2026-01-01", "end": "2026-12-31", "billingType": "2", "netDays": null, "rates": [10000], "units": ["month", "mo"], "qty": 12.0, "lines": [{"rate": 10000, "amount": 120000.0}], "bills": [{"from": "2026-01-01", "to": "2026-01-31", "due": "2026-01-31", "qty": 1.0, "amount": 10000.0}, {"from": "2026-02-01", "to": "2026-02-28", "due": "2026-02-28", "qty": 1.0, "amount": 10000.0}, {"from": "2026-03-01", "to": "2026-03-31", "due": "2026-03-31", "qty": 1.0, "amount": 10000.0}, {"from": "2026-04-01", "to": "2026-04-30", "due": "2026-04-30", "qty": 1.0, "amount": 10000.0}, {"from": "2026-05-01", "to": "2026-05-31", "due": "2026-05-31", "qty": 1.0, "amount": 10000.0}, {"from": "2026-06-01", "to": "2026-06-30", "due": "2026-06-30", "qty": 1.0, "amount": 10000.0}, {"from": "2026-07-01", "to": "2026-07-31", "due": "2026-07-31", "qty": 1.0, "amount": 10000.0}, {"from": "2026-08-01", "to": "2026-08-31", "due": "2026-08-31", "qty": 1.0, "amount": 10000.0}, {"from": "2026-09-01", "to": "2026-09-30", "due": "2026-09-30", "qty": 1.0, "amount": 10000.0}, {"from": "2026-10-01", "to": "2026-10-31", "due": "2026-10-31", "qty": 1.0, "amount": 10000.0}, {"from": "2026-11-01", "to": "2026-11-30", "due": "2026-11-30", "qty": 1.0, "amount": 10000.0}, {"from": "2026-12-01", "to": "2026-12-31", "due": "2026-12-31", "qty": 1.0, "amount": 10000.0}]},
{"id": "MO-11", "kind": "POS", "term": "Monthly", "terms": "5", "scenario": "Net Days = 30", "type": "CREATE", "start": "2026-01-01", "end": "2026-12-31", "billingType": "3", "netDays": 30, "rates": [10000], "units": ["month", "mo"], "qty": 12.0, "lines": [{"rate": 10000, "amount": 120000.0}], "bills": [{"from": "2026-01-01", "to": "2026-01-31", "due": "2026-01-31", "qty": 1.0, "amount": 10000.0}, {"from": "2026-02-01", "to": "2026-02-28", "due": "2026-03-03", "qty": 1.0, "amount": 10000.0}, {"from": "2026-03-01", "to": "2026-03-31", "due": "2026-03-31", "qty": 1.0, "amount": 10000.0}, {"from": "2026-04-01", "to": "2026-04-30", "due": "2026-05-01", "qty": 1.0, "amount": 10000.0}, {"from": "2026-05-01", "to": "2026-05-31", "due": "2026-05-31", "qty": 1.0, "amount": 10000.0}, {"from": "2026-06-01", "to": "2026-06-30", "due": "2026-07-01", "qty": 1.0, "amount": 10000.0}, {"from": "2026-07-01", "to": "2026-07-31", "due": "2026-07-31", "qty": 1.0, "amount": 10000.0}, {"from": "2026-08-01", "to": "2026-08-31", "due": "2026-08-31", "qty": 1.0, "amount": 10000.0}, {"from": "2026-09-01", "to": "2026-09-30", "due": "2026-10-01", "qty": 1.0, "amount": 10000.0}, {"from": "2026-10-01", "to": "2026-10-31", "due": "2026-10-31", "qty": 1.0, "amount": 10000.0}, {"from": "2026-11-01", "to": "2026-11-30", "due": "2026-12-01", "qty": 1.0, "amount": 10000.0}, {"from": "2026-12-01", "to": "2026-12-31", "due": "2026-12-31", "qty": 1.0, "amount": 10000.0}]},
{"id": "MO-12", "kind": "POS", "term": "Monthly", "terms": "5", "scenario": "EDIT: change Payment Terms", "type": "EDIT", "start": "2027-01-01", "end": "2027-12-31", "billingType": "1", "netDays": null, "rates": [10000], "units": ["month", "mo"], "qty": 12.0, "lines": [{"rate": 10000, "amount": 120000.0}], "bills": [{"from": "2027-01-01", "to": "2027-01-31", "due": "2027-01-01", "qty": 1.0, "amount": 10000.0}, {"from": "2027-02-01", "to": "2027-02-28", "due": "2027-02-01", "qty": 1.0, "amount": 10000.0}, {"from": "2027-03-01", "to": "2027-03-31", "due": "2027-03-01", "qty": 1.0, "amount": 10000.0}, {"from": "2027-04-01", "to": "2027-04-30", "due": "2027-04-01", "qty": 1.0, "amount": 10000.0}, {"from": "2027-05-01", "to": "2027-05-31", "due": "2027-05-01", "qty": 1.0, "amount": 10000.0}, {"from": "2027-06-01", "to": "2027-06-30", "due": "2027-06-01", "qty": 1.0, "amount": 10000.0}, {"from": "2027-07-01", "to": "2027-07-31", "due": "2027-07-01", "qty": 1.0, "amount": 10000.0}, {"from": "2027-08-01", "to": "2027-08-31", "due": "2027-08-01", "qty": 1.0, "amount": 10000.0}, {"from": "2027-09-01", "to": "2027-09-30", "due": "2027-09-01", "qty": 1.0, "amount": 10000.0}, {"from": "2027-10-01", "to": "2027-10-31", "due": "2027-10-01", "qty": 1.0, "amount": 10000.0}, {"from": "2027-11-01", "to": "2027-11-30", "due": "2027-11-01", "qty": 1.0, "amount": 10000.0}, {"from": "2027-12-01", "to": "2027-12-31", "due": "2027-12-01", "qty": 1.0, "amount": 10000.0}], "oldTerms": "6", "oldBills": 4},
{"id": "QU-01", "kind": "POS", "term": "Quarterly", "terms": "6", "scenario": "Exact calendar year", "type": "CREATE", "start": "2026-01-01", "end": "2026-12-31", "billingType": "1", "netDays": null, "rates": [10000], "units": ["quarter", "qrtr"], "qty": 4.0, "lines": [{"rate": 30000, "amount": 120000.0}], "bills": [{"from": "2026-01-01", "to": "2026-03-31", "due": "2026-01-01", "qty": 1.0, "amount": 30000.0}, {"from": "2026-04-01", "to": "2026-06-30", "due": "2026-04-01", "qty": 1.0, "amount": 30000.0}, {"from": "2026-07-01", "to": "2026-09-30", "due": "2026-07-01", "qty": 1.0, "amount": 30000.0}, {"from": "2026-10-01", "to": "2026-12-31", "due": "2026-10-01", "qty": 1.0, "amount": 30000.0}]},
{"id": "QU-02", "kind": "POS", "term": "Quarterly", "terms": "6", "scenario": "End date on anniversary", "type": "CREATE", "start": "2026-01-01", "end": "2027-01-01", "billingType": "1", "netDays": null, "rates": [10000], "units": ["quarter", "qrtr"], "qty": 4.0, "lines": [{"rate": 30000, "amount": 120000.0}], "bills": [{"from": "2026-01-01", "to": "2026-03-31", "due": "2026-01-01", "qty": 1.0, "amount": 30000.0}, {"from": "2026-04-01", "to": "2026-06-30", "due": "2026-04-01", "qty": 1.0, "amount": 30000.0}, {"from": "2026-07-01", "to": "2026-09-30", "due": "2026-07-01", "qty": 1.0, "amount": 30000.0}, {"from": "2026-10-01", "to": "2026-12-31", "due": "2026-10-01", "qty": 1.0, "amount": 30000.0}]},
{"id": "QU-03", "kind": "POS", "term": "Quarterly", "terms": "6", "scenario": "Mid-month start", "type": "CREATE", "start": "2026-01-19", "end": "2027-01-18", "billingType": "1", "netDays": null, "rates": [10000], "units": ["quarter", "qrtr"], "qty": 4.0, "lines": [{"rate": 30000, "amount": 120000.0}], "bills": [{"from": "2026-01-19", "to": "2026-04-18", "due": "2026-01-19", "qty": 1.0, "amount": 30000.0}, {"from": "2026-04-19", "to": "2026-07-18", "due": "2026-04-19", "qty": 1.0, "amount": 30000.0}, {"from": "2026-07-19", "to": "2026-10-18", "due": "2026-07-19", "qty": 1.0, "amount": 30000.0}, {"from": "2026-10-19", "to": "2027-01-18", "due": "2026-10-19", "qty": 1.0, "amount": 30000.0}]},
{"id": "QU-04", "kind": "POS", "term": "Quarterly", "terms": "6", "scenario": "Month-end start (clamping)", "type": "CREATE", "start": "2026-01-31", "end": "2027-01-30", "billingType": "1", "netDays": null, "rates": [10000], "units": ["quarter", "qrtr"], "qty": 4.0, "lines": [{"rate": 30000, "amount": 120000.0}], "bills": [{"from": "2026-01-31", "to": "2026-04-29", "due": "2026-01-31", "qty": 1.0, "amount": 30000.0}, {"from": "2026-04-30", "to": "2026-07-30", "due": "2026-04-30", "qty": 1.0, "amount": 30000.0}, {"from": "2026-07-31", "to": "2026-10-30", "due": "2026-07-31", "qty": 1.0, "amount": 30000.0}, {"from": "2026-10-31", "to": "2027-01-30", "due": "2026-10-31", "qty": 1.0, "amount": 30000.0}]},
{"id": "QU-05", "kind": "POS", "term": "Quarterly", "terms": "6", "scenario": "Partial last month", "type": "CREATE", "start": "2026-01-01", "end": "2027-01-15", "billingType": "1", "netDays": null, "rates": [10000], "units": ["quarter", "qrtr"], "qty": 4.16129, "lines": [{"rate": 30000, "amount": 124838.71}], "bills": [{"from": "2026-01-01", "to": "2026-03-31", "due": "2026-01-01", "qty": 1.0, "amount": 30000.0}, {"from": "2026-04-01", "to": "2026-06-30", "due": "2026-04-01", "qty": 1.0, "amount": 30000.0}, {"from": "2026-07-01", "to": "2026-09-30", "due": "2026-07-01", "qty": 1.0, "amount": 30000.0}, {"from": "2026-10-01", "to": "2026-12-31", "due": "2026-10-01", "qty": 1.0, "amount": 30000.0}, {"from": "2027-01-01", "to": "2027-01-15", "due": "2027-01-01", "qty": 0.16129, "amount": 4838.71}]},
{"id": "QU-06", "kind": "POS", "term": "Quarterly", "terms": "6", "scenario": "One full month", "type": "CREATE", "start": "2026-01-01", "end": "2026-01-31", "billingType": "1", "netDays": null, "rates": [10000], "units": ["quarter", "qrtr"], "qty": 0.33333, "lines": [{"rate": 30000, "amount": 10000.0}], "bills": [{"from": "2026-01-01", "to": "2026-01-31", "due": "2026-01-01", "qty": 0.33333, "amount": 10000.0}]},
{"id": "QU-07", "kind": "POS", "term": "Quarterly", "terms": "6", "scenario": "Partial month only", "type": "CREATE", "start": "2026-01-01", "end": "2026-01-10", "billingType": "1", "netDays": null, "rates": [10000], "units": ["quarter", "qrtr"], "qty": 0.10753, "lines": [{"rate": 30000, "amount": 3225.81}], "bills": [{"from": "2026-01-01", "to": "2026-01-10", "due": "2026-01-01", "qty": 0.10753, "amount": 3225.81}]},
{"id": "QU-08", "kind": "POS", "term": "Quarterly", "terms": "6", "scenario": "Leap-year Feb partial", "type": "CREATE", "start": "2028-02-01", "end": "2028-02-14", "billingType": "1", "netDays": null, "rates": [10000], "units": ["quarter", "qrtr"], "qty": 0.16092, "lines": [{"rate": 30000, "amount": 4827.59}], "bills": [{"from": "2028-02-01", "to": "2028-02-14", "due": "2028-02-01", "qty": 0.16092, "amount": 4827.59}]},
{"id": "QU-09", "kind": "POS", "term": "Quarterly", "terms": "6", "scenario": "Two item lines", "type": "CREATE", "start": "2026-01-01", "end": "2026-12-31", "billingType": "1", "netDays": null, "rates": [10000, 5000], "units": ["quarter", "qrtr"], "qty": 4.0, "lines": [{"rate": 30000, "amount": 120000.0}, {"rate": 15000, "amount": 60000.0}], "bills": [{"from": "2026-01-01", "to": "2026-03-31", "due": "2026-01-01", "qty": 1.0, "amount": 45000.0}, {"from": "2026-04-01", "to": "2026-06-30", "due": "2026-04-01", "qty": 1.0, "amount": 45000.0}, {"from": "2026-07-01", "to": "2026-09-30", "due": "2026-07-01", "qty": 1.0, "amount": 45000.0}, {"from": "2026-10-01", "to": "2026-12-31", "due": "2026-10-01", "qty": 1.0, "amount": 45000.0}]},
{"id": "QU-10", "kind": "POS", "term": "Quarterly", "terms": "6", "scenario": "Arrears", "type": "CREATE", "start": "2026-01-01", "end": "2026-12-31", "billingType": "2", "netDays": null, "rates": [10000], "units": ["quarter", "qrtr"], "qty": 4.0, "lines": [{"rate": 30000, "amount": 120000.0}], "bills": [{"from": "2026-01-01", "to": "2026-03-31", "due": "2026-03-31", "qty": 1.0, "amount": 30000.0}, {"from": "2026-04-01", "to": "2026-06-30", "due": "2026-06-30", "qty": 1.0, "amount": 30000.0}, {"from": "2026-07-01", "to": "2026-09-30", "due": "2026-09-30", "qty": 1.0, "amount": 30000.0}, {"from": "2026-10-01", "to": "2026-12-31", "due": "2026-12-31", "qty": 1.0, "amount": 30000.0}]},
{"id": "QU-11", "kind": "POS", "term": "Quarterly", "terms": "6", "scenario": "Net Days = 30", "type": "CREATE", "start": "2026-01-01", "end": "2026-12-31", "billingType": "3", "netDays": 30, "rates": [10000], "units": ["quarter", "qrtr"], "qty": 4.0, "lines": [{"rate": 30000, "amount": 120000.0}], "bills": [{"from": "2026-01-01", "to": "2026-03-31", "due": "2026-01-31", "qty": 1.0, "amount": 30000.0}, {"from": "2026-04-01", "to": "2026-06-30", "due": "2026-05-01", "qty": 1.0, "amount": 30000.0}, {"from": "2026-07-01", "to": "2026-09-30", "due": "2026-07-31", "qty": 1.0, "amount": 30000.0}, {"from": "2026-10-01", "to": "2026-12-31", "due": "2026-10-31", "qty": 1.0, "amount": 30000.0}]},
{"id": "QU-12", "kind": "POS", "term": "Quarterly", "terms": "6", "scenario": "EDIT: change Payment Terms", "type": "EDIT", "start": "2027-01-01", "end": "2027-12-31", "billingType": "1", "netDays": null, "rates": [10000], "units": ["quarter", "qrtr"], "qty": 4.0, "lines": [{"rate": 30000, "amount": 120000.0}], "bills": [{"from": "2027-01-01", "to": "2027-03-31", "due": "2027-01-01", "qty": 1.0, "amount": 30000.0}, {"from": "2027-04-01", "to": "2027-06-30", "due": "2027-04-01", "qty": 1.0, "amount": 30000.0}, {"from": "2027-07-01", "to": "2027-09-30", "due": "2027-07-01", "qty": 1.0, "amount": 30000.0}, {"from": "2027-10-01", "to": "2027-12-31", "due": "2027-10-01", "qty": 1.0, "amount": 30000.0}], "oldTerms": "5", "oldBills": 12},
{"id": "SA-01", "kind": "POS", "term": "Semi-Annual", "terms": "4", "scenario": "Exact calendar year", "type": "CREATE", "start": "2026-01-01", "end": "2026-12-31", "billingType": "1", "netDays": null, "rates": [10000], "units": ["semi-annual", "smannl"], "qty": 2.0, "lines": [{"rate": 60000, "amount": 120000.0}], "bills": [{"from": "2026-01-01", "to": "2026-06-30", "due": "2026-01-01", "qty": 1.0, "amount": 60000.0}, {"from": "2026-07-01", "to": "2026-12-31", "due": "2026-07-01", "qty": 1.0, "amount": 60000.0}]},
{"id": "SA-02", "kind": "POS", "term": "Semi-Annual", "terms": "4", "scenario": "End date on anniversary", "type": "CREATE", "start": "2026-01-01", "end": "2027-01-01", "billingType": "1", "netDays": null, "rates": [10000], "units": ["semi-annual", "smannl"], "qty": 2.0, "lines": [{"rate": 60000, "amount": 120000.0}], "bills": [{"from": "2026-01-01", "to": "2026-06-30", "due": "2026-01-01", "qty": 1.0, "amount": 60000.0}, {"from": "2026-07-01", "to": "2026-12-31", "due": "2026-07-01", "qty": 1.0, "amount": 60000.0}]},
{"id": "SA-03", "kind": "POS", "term": "Semi-Annual", "terms": "4", "scenario": "Mid-month start", "type": "CREATE", "start": "2026-01-19", "end": "2027-01-18", "billingType": "1", "netDays": null, "rates": [10000], "units": ["semi-annual", "smannl"], "qty": 2.0, "lines": [{"rate": 60000, "amount": 120000.0}], "bills": [{"from": "2026-01-19", "to": "2026-07-18", "due": "2026-01-19", "qty": 1.0, "amount": 60000.0}, {"from": "2026-07-19", "to": "2027-01-18", "due": "2026-07-19", "qty": 1.0, "amount": 60000.0}]},
{"id": "SA-04", "kind": "POS", "term": "Semi-Annual", "terms": "4", "scenario": "Month-end start (clamping)", "type": "CREATE", "start": "2026-01-31", "end": "2027-01-30", "billingType": "1", "netDays": null, "rates": [10000], "units": ["semi-annual", "smannl"], "qty": 2.0, "lines": [{"rate": 60000, "amount": 120000.0}], "bills": [{"from": "2026-01-31", "to": "2026-07-30", "due": "2026-01-31", "qty": 1.0, "amount": 60000.0}, {"from": "2026-07-31", "to": "2027-01-30", "due": "2026-07-31", "qty": 1.0, "amount": 60000.0}]},
{"id": "SA-05", "kind": "POS", "term": "Semi-Annual", "terms": "4", "scenario": "Partial last month", "type": "CREATE", "start": "2026-01-01", "end": "2027-01-15", "billingType": "1", "netDays": null, "rates": [10000], "units": ["semi-annual", "smannl"], "qty": 2.08065, "lines": [{"rate": 60000, "amount": 124838.71}], "bills": [{"from": "2026-01-01", "to": "2026-06-30", "due": "2026-01-01", "qty": 1.0, "amount": 60000.0}, {"from": "2026-07-01", "to": "2026-12-31", "due": "2026-07-01", "qty": 1.0, "amount": 60000.0}, {"from": "2027-01-01", "to": "2027-01-15", "due": "2027-01-01", "qty": 0.08065, "amount": 4838.71}]},
{"id": "SA-06", "kind": "POS", "term": "Semi-Annual", "terms": "4", "scenario": "One full month", "type": "CREATE", "start": "2026-01-01", "end": "2026-01-31", "billingType": "1", "netDays": null, "rates": [10000], "units": ["semi-annual", "smannl"], "qty": 0.16667, "lines": [{"rate": 60000, "amount": 10000.0}], "bills": [{"from": "2026-01-01", "to": "2026-01-31", "due": "2026-01-01", "qty": 0.16667, "amount": 10000.0}]},
{"id": "SA-07", "kind": "POS", "term": "Semi-Annual", "terms": "4", "scenario": "Partial month only", "type": "CREATE", "start": "2026-01-01", "end": "2026-01-10", "billingType": "1", "netDays": null, "rates": [10000], "units": ["semi-annual", "smannl"], "qty": 0.05376, "lines": [{"rate": 60000, "amount": 3225.81}], "bills": [{"from": "2026-01-01", "to": "2026-01-10", "due": "2026-01-01", "qty": 0.05376, "amount": 3225.81}]},
{"id": "SA-08", "kind": "POS", "term": "Semi-Annual", "terms": "4", "scenario": "Leap-year Feb partial", "type": "CREATE", "start": "2028-02-01", "end": "2028-02-14", "billingType": "1", "netDays": null, "rates": [10000], "units": ["semi-annual", "smannl"], "qty": 0.08046, "lines": [{"rate": 60000, "amount": 4827.59}], "bills": [{"from": "2028-02-01", "to": "2028-02-14", "due": "2028-02-01", "qty": 0.08046, "amount": 4827.59}]},
{"id": "SA-09", "kind": "POS", "term": "Semi-Annual", "terms": "4", "scenario": "Two item lines", "type": "CREATE", "start": "2026-01-01", "end": "2026-12-31", "billingType": "1", "netDays": null, "rates": [10000, 5000], "units": ["semi-annual", "smannl"], "qty": 2.0, "lines": [{"rate": 60000, "amount": 120000.0}, {"rate": 30000, "amount": 60000.0}], "bills": [{"from": "2026-01-01", "to": "2026-06-30", "due": "2026-01-01", "qty": 1.0, "amount": 90000.0}, {"from": "2026-07-01", "to": "2026-12-31", "due": "2026-07-01", "qty": 1.0, "amount": 90000.0}]},
{"id": "SA-10", "kind": "POS", "term": "Semi-Annual", "terms": "4", "scenario": "Arrears", "type": "CREATE", "start": "2026-01-01", "end": "2026-12-31", "billingType": "2", "netDays": null, "rates": [10000], "units": ["semi-annual", "smannl"], "qty": 2.0, "lines": [{"rate": 60000, "amount": 120000.0}], "bills": [{"from": "2026-01-01", "to": "2026-06-30", "due": "2026-06-30", "qty": 1.0, "amount": 60000.0}, {"from": "2026-07-01", "to": "2026-12-31", "due": "2026-12-31", "qty": 1.0, "amount": 60000.0}]},
{"id": "SA-11", "kind": "POS", "term": "Semi-Annual", "terms": "4", "scenario": "Net Days = 30", "type": "CREATE", "start": "2026-01-01", "end": "2026-12-31", "billingType": "3", "netDays": 30, "rates": [10000], "units": ["semi-annual", "smannl"], "qty": 2.0, "lines": [{"rate": 60000, "amount": 120000.0}], "bills": [{"from": "2026-01-01", "to": "2026-06-30", "due": "2026-01-31", "qty": 1.0, "amount": 60000.0}, {"from": "2026-07-01", "to": "2026-12-31", "due": "2026-07-31", "qty": 1.0, "amount": 60000.0}]},
{"id": "SA-12", "kind": "POS", "term": "Semi-Annual", "terms": "4", "scenario": "EDIT: change Payment Terms", "type": "EDIT", "start": "2027-01-01", "end": "2027-12-31", "billingType": "1", "netDays": null, "rates": [10000], "units": ["semi-annual", "smannl"], "qty": 2.0, "lines": [{"rate": 60000, "amount": 120000.0}], "bills": [{"from": "2027-01-01", "to": "2027-06-30", "due": "2027-01-01", "qty": 1.0, "amount": 60000.0}, {"from": "2027-07-01", "to": "2027-12-31", "due": "2027-07-01", "qty": 1.0, "amount": 60000.0}], "oldTerms": "6", "oldBills": 4},
{"id": "AN-01", "kind": "POS", "term": "Annual", "terms": "1", "scenario": "Exact calendar year", "type": "CREATE", "start": "2026-01-01", "end": "2026-12-31", "billingType": "1", "netDays": null, "rates": [10000], "units": ["year", "yr"], "qty": 1.0, "lines": [{"rate": 120000, "amount": 120000.0}], "bills": [{"from": "2026-01-01", "to": "2026-12-31", "due": "2026-01-01", "qty": 1.0, "amount": 120000.0}]},
{"id": "AN-02", "kind": "POS", "term": "Annual", "terms": "1", "scenario": "End date on anniversary", "type": "CREATE", "start": "2026-01-01", "end": "2027-01-01", "billingType": "1", "netDays": null, "rates": [10000], "units": ["year", "yr"], "qty": 1.0, "lines": [{"rate": 120000, "amount": 120000.0}], "bills": [{"from": "2026-01-01", "to": "2026-12-31", "due": "2026-01-01", "qty": 1.0, "amount": 120000.0}]},
{"id": "AN-03", "kind": "POS", "term": "Annual", "terms": "1", "scenario": "Mid-month start", "type": "CREATE", "start": "2026-01-19", "end": "2027-01-18", "billingType": "1", "netDays": null, "rates": [10000], "units": ["year", "yr"], "qty": 1.0, "lines": [{"rate": 120000, "amount": 120000.0}], "bills": [{"from": "2026-01-19", "to": "2027-01-18", "due": "2026-01-19", "qty": 1.0, "amount": 120000.0}]},
{"id": "AN-04", "kind": "POS", "term": "Annual", "terms": "1", "scenario": "Month-end start (clamping)", "type": "CREATE", "start": "2026-01-31", "end": "2027-01-30", "billingType": "1", "netDays": null, "rates": [10000], "units": ["year", "yr"], "qty": 1.0, "lines": [{"rate": 120000, "amount": 120000.0}], "bills": [{"from": "2026-01-31", "to": "2027-01-30", "due": "2026-01-31", "qty": 1.0, "amount": 120000.0}]},
{"id": "AN-05", "kind": "POS", "term": "Annual", "terms": "1", "scenario": "Partial last month", "type": "CREATE", "start": "2026-01-01", "end": "2027-01-15", "billingType": "1", "netDays": null, "rates": [10000], "units": ["year", "yr"], "qty": 1.04032, "lines": [{"rate": 120000, "amount": 124838.71}], "bills": [{"from": "2026-01-01", "to": "2026-12-31", "due": "2026-01-01", "qty": 1.0, "amount": 120000.0}, {"from": "2027-01-01", "to": "2027-01-15", "due": "2027-01-01", "qty": 0.04032, "amount": 4838.71}]},
{"id": "AN-06", "kind": "POS", "term": "Annual", "terms": "1", "scenario": "One full month", "type": "CREATE", "start": "2026-01-01", "end": "2026-01-31", "billingType": "1", "netDays": null, "rates": [10000], "units": ["year", "yr"], "qty": 0.08333, "lines": [{"rate": 120000, "amount": 10000.0}], "bills": [{"from": "2026-01-01", "to": "2026-01-31", "due": "2026-01-01", "qty": 0.08333, "amount": 10000.0}]},
{"id": "AN-07", "kind": "POS", "term": "Annual", "terms": "1", "scenario": "Partial month only", "type": "CREATE", "start": "2026-01-01", "end": "2026-01-10", "billingType": "1", "netDays": null, "rates": [10000], "units": ["year", "yr"], "qty": 0.02688, "lines": [{"rate": 120000, "amount": 3225.81}], "bills": [{"from": "2026-01-01", "to": "2026-01-10", "due": "2026-01-01", "qty": 0.02688, "amount": 3225.81}]},
{"id": "AN-08", "kind": "POS", "term": "Annual", "terms": "1", "scenario": "Leap-year Feb partial", "type": "CREATE", "start": "2028-02-01", "end": "2028-02-14", "billingType": "1", "netDays": null, "rates": [10000], "units": ["year", "yr"], "qty": 0.04023, "lines": [{"rate": 120000, "amount": 4827.59}], "bills": [{"from": "2028-02-01", "to": "2028-02-14", "due": "2028-02-01", "qty": 0.04023, "amount": 4827.59}]},
{"id": "AN-09", "kind": "POS", "term": "Annual", "terms": "1", "scenario": "Two item lines", "type": "CREATE", "start": "2026-01-01", "end": "2026-12-31", "billingType": "1", "netDays": null, "rates": [10000, 5000], "units": ["year", "yr"], "qty": 1.0, "lines": [{"rate": 120000, "amount": 120000.0}, {"rate": 60000, "amount": 60000.0}], "bills": [{"from": "2026-01-01", "to": "2026-12-31", "due": "2026-01-01", "qty": 1.0, "amount": 180000.0}]},
{"id": "AN-10", "kind": "POS", "term": "Annual", "terms": "1", "scenario": "Arrears", "type": "CREATE", "start": "2026-01-01", "end": "2026-12-31", "billingType": "2", "netDays": null, "rates": [10000], "units": ["year", "yr"], "qty": 1.0, "lines": [{"rate": 120000, "amount": 120000.0}], "bills": [{"from": "2026-01-01", "to": "2026-12-31", "due": "2026-12-31", "qty": 1.0, "amount": 120000.0}]},
{"id": "AN-11", "kind": "POS", "term": "Annual", "terms": "1", "scenario": "Net Days = 30", "type": "CREATE", "start": "2026-01-01", "end": "2026-12-31", "billingType": "3", "netDays": 30, "rates": [10000], "units": ["year", "yr"], "qty": 1.0, "lines": [{"rate": 120000, "amount": 120000.0}], "bills": [{"from": "2026-01-01", "to": "2026-12-31", "due": "2026-01-31", "qty": 1.0, "amount": 120000.0}]},
{"id": "AN-12", "kind": "POS", "term": "Annual", "terms": "1", "scenario": "EDIT: change Payment Terms", "type": "EDIT", "start": "2027-01-01", "end": "2027-12-31", "billingType": "1", "netDays": null, "rates": [10000], "units": ["year", "yr"], "qty": 1.0, "lines": [{"rate": 120000, "amount": 120000.0}], "bills": [{"from": "2027-01-01", "to": "2027-12-31", "due": "2027-01-01", "qty": 1.0, "amount": 120000.0}], "oldTerms": "4", "oldBills": 2}
];

    // ==========================================
    // HELPERS
    // ==========================================
    const pad = n => (n < 10 ? '0' : '') + n;
    const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    const toDate = s => { const p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };
    const parseNS = v => ymd(format.parse({ value: v, type: format.Type.DATE }));
    const near = (a, b, tol) => Math.abs(Number(a) - Number(b)) <= tol;

    const makeChecker = () => {
        const checks = [];
        return {
            checks,
            add: (name, expected, actual, ok) => checks.push({ name, expected, actual, ok: !!ok })
        };
    };

    const errText = e => {
        let j = '';
        try { j = JSON.stringify(e); } catch (x) { j = ''; }
        return [e && e.name, e && e.message, j, String(e)].join(' ');
    };

    // ==========================================
    // RECORD HELPERS
    // ==========================================
    function createSO(p) {
        const so = record.create({ type: record.Type.SALES_ORDER, isDynamic: false });
        so.setValue({ fieldId: 'entity', value: CONFIG.CUSTOMER_ID });
        if (CONFIG.SUBSIDIARY_ID) so.setValue({ fieldId: 'subsidiary', value: CONFIG.SUBSIDIARY_ID });
        if (CONFIG.LOCATION_ID) so.setValue({ fieldId: 'location', value: CONFIG.LOCATION_ID });
        so.setValue({ fieldId: 'memo', value: CONFIG.MEMO });
        so.setValue({ fieldId: 'startdate', value: toDate(p.start) });
        so.setValue({ fieldId: 'enddate', value: toDate(p.end) });
        so.setValue({ fieldId: 'terms', value: p.terms });
        so.setValue({ fieldId: 'custbody_cli_billing_type', value: p.billingType });
        if (p.netDays != null) so.setValue({ fieldId: 'custbody_cli_net_days', value: p.netDays });

        p.rates.forEach((rate, i) => {
            so.setSublistValue({ sublistId: 'item', fieldId: 'item', line: i, value: CONFIG.ITEM_ID });
            so.setSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i, value: 1 });
            so.setSublistValue({ sublistId: 'item', fieldId: 'rate', line: i, value: rate });
        });

        return so.save({ ignoreMandatoryFields: false });
    }

    function getBills(soId) {
        const bills = [];
        search.create({
            type: BILL_TYPE,
            filters: [['custrecord_cli_bs_sales_order', 'anyof', soId]],
            columns: [
                search.createColumn({ name: 'custrecord_cli_bs_period', sort: search.Sort.ASC }),
                'custrecord_cli_bs_from', 'custrecord_cli_bs_to', 'custrecord_cli_bs_amount',
                'custrecord_cli_bs_due_date', 'custrecord_cli_quantity'
            ]
        }).run().getRange({ start: 0, end: 200 }).forEach(r => {
            bills.push({
                id: r.id,
                from: parseNS(r.getValue('custrecord_cli_bs_from')),
                to: parseNS(r.getValue('custrecord_cli_bs_to')),
                due: parseNS(r.getValue('custrecord_cli_bs_due_date')),
                amount: Number(r.getValue('custrecord_cli_bs_amount')) || 0,
                qty: Number(r.getValue('custrecord_cli_quantity')) || 0
            });
        });
        return bills;
    }

    function cleanup(soId) {
        if (!CONFIG.CLEANUP || !soId) return;
        try {
            getBills(soId).forEach(b => record.delete({ type: BILL_TYPE, id: b.id }));
        } catch (e) { log.error('cleanup bills failed SO ' + soId, e); }
        try {
            record.delete({ type: record.Type.SALES_ORDER, id: soId });
        } catch (e) { log.error('cleanup SO failed ' + soId, e); }
    }

    // ==========================================
    // POSITIVE CASE (CREATE or EDIT)
    // ==========================================
    function runPositive(c) {
        const ck = makeChecker();
        let soId = null;

        try {
            if (c.type === 'EDIT') {
                soId = createSO({ start: c.start, end: c.end, terms: c.oldTerms,
                    billingType: c.billingType, netDays: c.netDays, rates: c.rates });
                const before = getBills(soId);
                ck.add('Precondition: bills on old terms', c.oldBills, before.length, before.length === c.oldBills);

                const so = record.load({ type: record.Type.SALES_ORDER, id: soId });
                so.setValue({ fieldId: 'terms', value: c.terms });
                so.save({ ignoreMandatoryFields: false });

                const after = getBills(soId);
                const oldIds = before.map(b => b.id);
                ck.add('Old bills deleted', 'none remain', after.filter(b => oldIds.indexOf(b.id) !== -1).length + ' remain',
                    after.every(b => oldIds.indexOf(b.id) === -1));
            } else {
                soId = createSO({ start: c.start, end: c.end, terms: c.terms,
                    billingType: c.billingType, netDays: c.netDays, rates: c.rates });
            }

            // ---- item lines ----
            const so = record.load({ type: record.Type.SALES_ORDER, id: soId });
            const lineCount = so.getLineCount({ sublistId: 'item' });
            ck.add('Line count', c.lines.length, lineCount, lineCount === c.lines.length);

            let lineAmountSum = 0, lineQty = 0;
            for (let i = 0; i < Math.min(lineCount, c.lines.length); i++) {
                const rate = Number(so.getSublistValue({ sublistId: 'item', fieldId: 'rate', line: i }));
                const qty = Number(so.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i }));
                const amt = Number(so.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: i }));
                const unitTxt = String(so.getSublistText({ sublistId: 'item', fieldId: 'units', line: i }) || '').trim().toLowerCase();

                ck.add('L' + (i + 1) + ' rate', c.lines[i].rate, rate, near(rate, c.lines[i].rate, 0.00001));
                ck.add('L' + (i + 1) + ' qty', c.qty, qty, near(qty, c.qty, 0.000005));
                ck.add('L' + (i + 1) + ' amount', c.lines[i].amount, amt, near(amt, c.lines[i].amount, 0.005));
                ck.add('L' + (i + 1) + ' units', c.units.join('/'), unitTxt, c.units.indexOf(unitTxt) !== -1);

                lineAmountSum += amt;
                lineQty = qty;
            }

            // ---- billing records ----
            const bills = getBills(soId);
            ck.add('Bill count', c.bills.length, bills.length, bills.length === c.bills.length);

            let billAmtSum = 0, billQtySum = 0;
            for (let i = 0; i < Math.min(bills.length, c.bills.length); i++) {
                const e = c.bills[i], a = bills[i], n = 'P' + (i + 1);
                ck.add(n + ' from', e.from, a.from, a.from === e.from);
                ck.add(n + ' to', e.to, a.to, a.to === e.to);
                ck.add(n + ' due', e.due, a.due, a.due === e.due);
                ck.add(n + ' amount', e.amount, a.amount, near(a.amount, e.amount, 0.005));
                ck.add(n + ' qty', e.qty, a.qty, near(a.qty, e.qty, 0.000005));
                billAmtSum += a.amount;
                billQtySum += a.qty;
            }
            ck.add('Sum bill amounts = sum line amounts', lineAmountSum.toFixed(2), billAmtSum.toFixed(2),
                near(lineAmountSum, billAmtSum, 0.005));
            ck.add('Sum bill qty = line qty', lineQty, billQtySum.toFixed(5), near(lineQty, billQtySum, 0.00002));

        } catch (e) {
            ck.add('Unexpected error', 'none', errText(e), false);
        } finally {
            cleanup(soId);
        }

        return summarize(c, ck.checks);
    }

    // ==========================================
    // NEGATIVE CASES
    // ==========================================
    function expectError(ck, code, fn) {
        let threw = false, text = '';
        try { fn(); } catch (e) { threw = true; text = errText(e); }
        ck.add('Save blocked', 'error thrown', threw ? 'error thrown' : 'saved without error', threw);
        if (threw) ck.add('Error code ' + code, code, text.indexOf(code) !== -1 ? code : text.slice(0, 200),
            text.indexOf(code) !== -1);
        return threw;
    }

    function runNegative(c) {
        const ck = makeChecker();
        let soId = null;
        const base = { start: '2027-01-01', end: '2027-12-31', terms: '5', billingType: '1', netDays: null, rates: [10000] };

        try {
            if (c.id === 'NEG-01') {
                expectError(ck, c.code, () => {
                    soId = createSO(Object.assign({}, base, { start: '2027-03-01', end: '2027-01-01' }));
                });

            } else if (c.id === 'NEG-02') {
                expectError(ck, c.code, () => {
                    soId = createSO(Object.assign({}, base, { billingType: '3', netDays: null }));
                });

            } else if (c.id === 'NEG-03') {
                // 2024 dates: bills are past due, so a terms change must be refused
                soId = createSO(Object.assign({}, base, { start: '2024-01-01', end: '2024-12-31', terms: '6' }));
                const before = getBills(soId).length;
                expectError(ck, c.code, () => {
                    const so = record.load({ type: record.Type.SALES_ORDER, id: soId });
                    so.setValue({ fieldId: 'terms', value: '5' });
                    so.save();
                });
                const after = getBills(soId).length;
                ck.add('Bills untouched', before, after, before === after);

            } else if (c.id === 'NEG-04') {
                soId = createSO(Object.assign({}, base, { rates: [10000, 5000] }));
                const before = getBills(soId).length;
                expectError(ck, c.code, () => {
                    const so = record.load({ type: record.Type.SALES_ORDER, id: soId });
                    so.setValue({ fieldId: 'terms', value: '6' });
                    so.removeLine({ sublistId: 'item', line: 1 });
                    so.save();
                });
                const after = getBills(soId).length;
                ck.add('Bills untouched', before, after, before === after);
            }
        } catch (e) {
            ck.add('Unexpected error', 'none', errText(e), false);
        } finally {
            cleanup(soId);
        }

        return summarize(c, ck.checks);
    }

    function summarize(c, checks) {
        const failed = checks.filter(x => !x.ok);
        return {
            id: c.id,
            scenario: c.scenario,
            term: c.term || '',
            status: failed.length ? 'FAIL' : 'PASS',
            checks: checks.length,
            failed: failed.map(x => x.name + ' (expected ' + x.expected + ', actual ' + x.actual + ')')
        };
    }

    // ==========================================
    // MAP / REDUCE ENTRY POINTS
    // ==========================================
    function getInputData() {
        if (!CONFIG.CUSTOMER_ID || !CONFIG.ITEM_ID) {
            throw new Error('Set CONFIG.CUSTOMER_ID and CONFIG.ITEM_ID before running.');
        }
        return POS_CASES.concat(NEG_CASES);
    }

    function map(context) {
        const c = JSON.parse(context.value);
        let result;
        try {
            result = c.kind === 'NEG' ? runNegative(c) : runPositive(c);
        } catch (e) {
            result = { id: c.id, scenario: c.scenario, term: c.term || '', status: 'ERROR', checks: 0, failed: [errText(e)] };
        }
        log.audit({ title: c.id + ' ' + result.status, details: result.failed.join(' | ') || 'all checks passed' });
        context.write({ key: c.id, value: JSON.stringify(result) });
    }

    function summarizeStage(context) {
        const rows = [];
        context.output.iterator().each((key, value) => { rows.push(JSON.parse(value)); return true; });
        rows.sort((a, b) => (a.id < b.id ? -1 : 1));

        const pass = rows.filter(r => r.status === 'PASS').length;
        log.audit({ title: 'TEST RUN COMPLETE',
            details: 'Total ' + rows.length + ', Pass ' + pass + ', Fail/Error ' + (rows.length - pass) });

        context.inputSummary.error && log.error('Input error', context.inputSummary.error);
        context.mapSummary.errors.iterator().each((k, e) => { log.error('Map error ' + k, e); return true; });

        const q = s => '"' + String(s).replace(/"/g, '""') + '"';
        const csv = ['Test ID,Payment Term,Scenario,Status,Checks,Failures']
            .concat(rows.map(r => [r.id, r.term, q(r.scenario), r.status, r.checks, q(r.failed.join(' | '))].join(',')))
            .join('\n');

        if (CONFIG.RESULTS_FOLDER_ID) {
            const id = file.create({
                name: 'billing_test_results_' + Date.now() + '.csv',
                fileType: file.Type.CSV,
                contents: csv,
                folder: CONFIG.RESULTS_FOLDER_ID
            }).save();
            log.audit('Results CSV saved', 'File ID ' + id);
        } else {
            log.audit('Results (set RESULTS_FOLDER_ID to save a CSV)', csv.slice(0, 3500));
        }
    }

    return { getInputData, map, summarize: summarizeStage };
});