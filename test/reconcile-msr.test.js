'use strict';
// MSR remittance reconcile (invoice-generation Slice 1): matchMsrRow + reconcileMsrRow.
// Pure logic, fixture-free (portable). Mirrors the real remittance shape proven by
// parse_msr_remittance.py against Vendor_ACH_Payment_Detail_-SSRS1. SHIPPED code via
// the esbuild bridge. Exit: 0 pass / 1 fail.
const assert = require('assert');
const { loadEsm } = require('./_load.js');
const { normWoNum, normAddress, matchMsrRow, reconcileMsrRow, bidReadReasonText } = loadEsm('src/orders-logic.js');

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e.message }); }
}

// Order shape from real wo_data: id minted 'WO-###', woId = 8-digit portal number.
const ORDERS = [
  { id: 'WO-002', woId: '02615338', pm: 'MSR', address: '21 ASH ST', type: 'Plumbing' },
  { id: 'WO-045', woId: '02045937', pm: 'MSR', address: '4102 Lady Slipper Ln', type: 'Plumbing' },
  { id: 'WO-118', woId: '02035902', pm: 'MSR', address: '639 Commander Dr', type: 'Plumbing' },
];
// Parsed remittance row shape (from parse_msr_remittance.py).
const row = (o) => ({ woId: '', amount: 0, invoiceNum: '', propCode: '', addressRaw: '', ...o });

test('normWoNum strips prefix/zeros/non-digits so all forms compare equal', () => {
  assert.strictEqual(normWoNum('02045937'), '2045937');
  assert.strictEqual(normWoNum('WO-2045937'), '2045937');
  assert.strictEqual(normWoNum('WO 02045937'), '2045937');
  assert.strictEqual(normWoNum(''), '');
  // AMH split-WO "-N" child/revisit suffix joins to its base (NOT folded into the
  // digits: "9746663-1" must be "9746663", not "97466631").
  assert.strictEqual(normWoNum('9746663-1'), '9746663');
  assert.strictEqual(normWoNum('WO-9746663-2'), '9746663');
  assert.strictEqual(normWoNum('9746663'), '9746663');
});

test('matchMsrRow: Invoice Notes number matches order.woId (primary key)', () => {
  const m = matchMsrRow(row({ woId: '02045937' }), ORDERS);
  assert.strictEqual(m.matchBy, 'woId');
  assert.strictEqual(m.order.id, 'WO-045');
});

test('matchMsrRow: leading-zero difference still matches', () => {
  const m = matchMsrRow(row({ woId: '2035902' }), ORDERS);   // remittance dropped the zero
  assert.strictEqual(m.order.id, 'WO-118');
});

test('matchMsrRow: address fallback when no WO-id hit, flagged by matchBy', () => {
  const m = matchMsrRow(row({ woId: '', addressRaw: '639 COMMANDER DR' }), ORDERS);
  assert.strictEqual(m.matchBy, 'address');
  assert.strictEqual(m.order.id, 'WO-118');
});

test('matchMsrRow: no WO id, no address match -> none', () => {
  const m = matchMsrRow(row({ woId: '09999999', addressRaw: 'nowhere' }), ORDERS);
  assert.strictEqual(m.matchBy, 'none');
  assert.strictEqual(m.order, null);
});

// A GUID Invoice Note used to parse to the short token "3", which matched the MINTED id
// WO-003 and reconciled a 110 Margaret Dr payment against 315 W Barnes St as a confident
// woId match. The WO-number branch now requires >= 4 digits.
test('matchMsrRow: a short parse-artifact token cannot match a minted sequential id', () => {
  const m = matchMsrRow(row({ woId: '3' }), [{ id: 'WO-003', woId: '', pm: 'MSR', address: '315 W Barnes St' }, ...ORDERS]);
  assert.strictEqual(m.matchBy, 'none');
  assert.strictEqual(m.order, null);
});

test('matchMsrRow: short token + a real address still resolves by address', () => {
  const m = matchMsrRow(row({ woId: '3', addressRaw: '110 Margaret Dr' }), [
    { id: 'WO-003', woId: '', pm: 'MSR', address: '315 W Barnes St' },
    { id: '04017255', woId: '04017255', pm: 'MSR', address: '110 Margaret Dr' },
    ...ORDERS,
  ]);
  assert.strictEqual(m.matchBy, 'address');
  assert.strictEqual(m.order.id, '04017255');
});

test('normAddress collapses token order + punctuation', () => {
  assert.strictEqual(normAddress('639 Commander Dr'), normAddress('DR, COMMANDER 639'));
});

test('reconcileMsrRow: sum(items) == paid -> match, no flags', () => {
  const r = row({ woId: '02045937', amount: 85, invoiceNum: 'PI000221373' });
  const m = matchMsrRow(r, ORDERS);
  const rep = reconcileMsrRow(r, m, [{ desc: 'Service Call', unitPrice: 85, qty: 1 }]);
  assert.strictEqual(rep.status, 'match');
  assert.strictEqual(rep.computed, 85);
  assert.strictEqual(rep.paid, 85);
  assert.strictEqual(rep.delta, 0);
  assert.strictEqual(rep.flags.length, 0);
  assert.strictEqual(rep.orderId, 'WO-045');
  assert.strictEqual(rep.invoiceNum, 'PI000221373');
});

test('reconcileMsrRow: multi-item sum with qty', () => {
  const r = row({ woId: '02615338', amount: 786.25 });
  const m = matchMsrRow(r, ORDERS);
  const rep = reconcileMsrRow(r, m, [
    { desc: '50 Gallon Water Heater', unitPrice: 700, qty: 1 },
    { desc: 'Fittings', unitPrice: 28.75, qty: 3 },   // 86.25
  ]);
  assert.strictEqual(rep.computed, 786.25);
  assert.strictEqual(rep.status, 'match');
});

test('reconcileMsrRow: computed != paid -> off, flagged', () => {
  const r = row({ woId: '02615338', amount: 300 });
  const m = matchMsrRow(r, ORDERS);
  const rep = reconcileMsrRow(r, m, [{ desc: 'Partial', unitPrice: 235, qty: 1 }]);
  assert.strictEqual(rep.status, 'off');
  assert.strictEqual(rep.delta, -65);
  assert.ok(/off/i.test(rep.flags[0]));
});

test('reconcileMsrRow: matched WO but no items -> no-items (service-call-only)', () => {
  const r = row({ woId: '02615338', amount: 85 });
  const m = matchMsrRow(r, ORDERS);
  const rep = reconcileMsrRow(r, m, []);
  assert.strictEqual(rep.status, 'no-items');
  assert.ok(/service-call-only/i.test(rep.flags[0]));
});

test('reconcileMsrRow: no order -> unmatched, address from remittance', () => {
  const r = row({ woId: '09999999', amount: 120, addressRaw: '10 Elsewhere Rd' });
  const m = matchMsrRow(r, ORDERS);
  const rep = reconcileMsrRow(r, m, []);
  assert.strictEqual(rep.status, 'unmatched');
  assert.strictEqual(rep.address, '10 Elsewhere Rd');
  assert.strictEqual(rep.orderId, null);
});

test('reconcileMsrRow: address-matched adds a verify flag even when totals match', () => {
  const r = row({ woId: '', amount: 85, addressRaw: '639 COMMANDER DR' });
  const m = matchMsrRow(r, ORDERS);
  const rep = reconcileMsrRow(r, m, [{ desc: 'Service Call', unitPrice: 85, qty: 1 }]);
  assert.strictEqual(rep.status, 'match');
  assert.ok(rep.flags.some(f => /ADDRESS/i.test(f)));
});

test('MSR taxable line -> per-line divide-out breakdown (pre/tax/post)', () => {
  const r = row({ woId: '02615338', amount: 85 });
  const rep = reconcileMsrRow(r, matchMsrRow(r, ORDERS), [{ desc: 'Diagnostic Fee', unitPrice: 85, qty: 1, taxable: true }]);
  assert.strictEqual(rep.lines[0].pre, 79.25);
  assert.strictEqual(rep.lines[0].tax, 5.75);
  assert.strictEqual(rep.lines[0].post, 85);
  assert.strictEqual(rep.preTax, 79.25);
  assert.strictEqual(rep.tax, 5.75);
  assert.strictEqual(rep.postTax, 85);
  assert.strictEqual(rep.status, 'match');
});

test('MSR non-taxable line -> tax 0, pre == post', () => {
  const r = row({ woId: '02615338', amount: 145 });
  const rep = reconcileMsrRow(r, matchMsrRow(r, ORDERS), [{ desc: 'R410a', unitPrice: 145, qty: 1, taxable: false }]);
  assert.strictEqual(rep.lines[0].tax, 0);
  assert.strictEqual(rep.lines[0].pre, 145);
  assert.strictEqual(rep.postTax, 145);
});

test('reconcileMsrRow: Advantis warranty-free items reconcile to paid 317.50', () => {
  const r = row({ woId: '02615338', amount: 317.5 });
  const items = [
    { desc: 'Service Call', unitPrice: 85, qty: 1 },
    { desc: 'Clean Condenser Coil', unitPrice: 150, qty: 1 },
    { desc: 'Material - 1.25lbs R410A', unitPrice: 62.5, qty: 1 },
    { desc: 'Replaced return air filter', unitPrice: 20, qty: 1 },
  ];
  const rep = reconcileMsrRow(r, matchMsrRow(r, ORDERS), items);
  assert.strictEqual(rep.computed, 317.5);
  assert.strictEqual(rep.status, 'match');
});

test('reconcileMsrRow: items 1595 vs paid 1343 -> off (selection handled upstream)', () => {
  const r = row({ woId: '02615338', amount: 1343 });
  const items = [
    { desc: 'Service Call', unitPrice: 85, qty: 1 },
    { desc: 'Labor install WH', unitPrice: 400, qty: 1 },
    { desc: 'Material WH', unitPrice: 700, qty: 1 },
    { desc: 'Labor expansion tank', unitPrice: 75, qty: 1 },
    { desc: 'Material expansion tank', unitPrice: 35, qty: 1 },
    { desc: 'Labor faucet', unitPrice: 150, qty: 1 },
    { desc: 'Material faucet', unitPrice: 150, qty: 1 },
  ];
  const rep = reconcileMsrRow(r, matchMsrRow(r, ORDERS), items);
  assert.strictEqual(rep.computed, 1595);
  assert.strictEqual(rep.status, 'off');
});

test('reconcileMsrRow: statedTotal advisory flag when capture sum != bid total (status unchanged)', () => {
  const r = row({ woId: '02045937', amount: 85, invoiceNum: 'PI000221373' });
  const m = matchMsrRow(r, ORDERS);
  const rep = reconcileMsrRow(r, m, [{ desc: 'Service Call', unitPrice: 85, qty: 1 }], 100);
  assert.strictEqual(rep.status, 'match');
  assert.ok(rep.flags.some(f => /verify line capture/.test(f)));
});

test('reconcileMsrRow: statedTotal == computed -> no advisory flag', () => {
  const r = row({ woId: '02045937', amount: 85, invoiceNum: 'PI000221373' });
  const m = matchMsrRow(r, ORDERS);
  const rep = reconcileMsrRow(r, m, [{ desc: 'Service Call', unitPrice: 85, qty: 1 }], 85);
  assert.strictEqual(rep.status, 'match');
  assert.ok(!rep.flags.some(f => /verify line capture/.test(f)));
});

// ---- SAY WHY an empty read is empty (remittance path used to swallow it) ----

test('bidReadReasonText: each main.js reason has wording; unknown -> null', () => {
  assert.ok(/no folder yet/i.test(bidReadReasonText('no-wo-folder')));
  assert.ok(/No bid or CO sheet/i.test(bidReadReasonText('no-bid-sheet')));
  assert.ok(/zero line items/i.test(bidReadReasonText('sheets-had-no-rows')));
  assert.ok(/desktop app/i.test(bidReadReasonText('no-desktop')));
  assert.ok(/Could not read the bid sheet: EBUSY\./.test(bidReadReasonText('read-failed:EBUSY')));
  assert.strictEqual(bidReadReasonText(null), null);
  assert.strictEqual(bidReadReasonText('something-else'), null);
});

test('reconcileMsrRow: no-items carries the reason flag (no-wo-folder)', () => {
  const r = row({ woId: '02615338', amount: 85 });
  const rep = reconcileMsrRow(r, matchMsrRow(r, ORDERS), [], null, 'no-wo-folder');
  assert.strictEqual(rep.status, 'no-items');
  assert.strictEqual(rep.flags.length, 2);
  assert.ok(/no folder yet/i.test(rep.flags[1]));
});

test('reconcileMsrRow: a FAILED read reports the error, not silence', () => {
  const r = row({ woId: '02615338', amount: 85 });
  const rep = reconcileMsrRow(r, matchMsrRow(r, ORDERS), [], null, 'read-failed:EPERM');
  assert.ok(rep.flags.some(f => /Could not read the bid sheet: EPERM/.test(f)));
});

test('reconcileMsrRow: unknown/absent reason -> only the base no-items flag (no drift)', () => {
  const r = row({ woId: '02615338', amount: 85 });
  const rep = reconcileMsrRow(r, matchMsrRow(r, ORDERS), [], null);
  assert.strictEqual(rep.flags.length, 1);
  assert.ok(/service-call-only/i.test(rep.flags[0]));
});

// ---- Acceptance item 3: "no WO gains line items whose total contradicts a paid
// remittance amount". The bill gate in remittances.jsx is
// `b.orderId && b.status === 'match' && b.lines.length`, so the property to hold is:
// a block whose lines do NOT sum to paid must never report status 'match'.

const billable = (b) => !!(b.orderId && b.status === 'match' && b.lines.length);

test('acceptance 3: lines under the paid amount -> off, NOT billable', () => {
  const r = row({ woId: '02045937', amount: 1343 });
  const rep = reconcileMsrRow(r, matchMsrRow(r, ORDERS), [{ desc: 'Water Heater', unitPrice: 1200, qty: 1 }]);
  assert.strictEqual(rep.status, 'off');
  assert.strictEqual(billable(rep), false);
});

test('acceptance 3: lines over the paid amount -> off, NOT billable', () => {
  const r = row({ woId: '02045937', amount: 1200 });
  const rep = reconcileMsrRow(r, matchMsrRow(r, ORDERS), [{ desc: 'Water Heater', unitPrice: 1343, qty: 1 }]);
  assert.strictEqual(rep.status, 'off');
  assert.strictEqual(billable(rep), false);
});

test('acceptance 3: one cent of drift is enough to withhold the bill', () => {
  const r = row({ woId: '02045937', amount: 1343 });
  const rep = reconcileMsrRow(r, matchMsrRow(r, ORDERS), [{ desc: 'Water Heater', unitPrice: 1343.01, qty: 1 }]);
  assert.strictEqual(rep.status, 'off');
  assert.strictEqual(billable(rep), false);
});

test('acceptance 3: qty-extended lines summing to paid -> match, billable', () => {
  const r = row({ woId: '02045937', amount: 600 });
  const rep = reconcileMsrRow(r, matchMsrRow(r, ORDERS), [
    { desc: 'Clean Condenser', unitPrice: 150, qty: 2 },
    { desc: 'Service Call', unitPrice: 300, qty: 1 },
  ]);
  assert.strictEqual(rep.status, 'match');
  assert.strictEqual(rep.computed, 600);
  assert.strictEqual(billable(rep), true);
});

test('acceptance 3: an UNMATCHED paid row is never billable even with lines', () => {
  const r = row({ woId: '09999999', amount: 500, addressRaw: '10 Elsewhere Rd' });
  const rep = reconcileMsrRow(r, matchMsrRow(r, ORDERS), [{ desc: 'Repair', unitPrice: 500, qty: 1 }]);
  assert.strictEqual(rep.status, 'unmatched');
  assert.strictEqual(rep.orderId, null);
  assert.strictEqual(billable(rep), false);
});

console.log('reconcile-msr test');
console.log('==================');
let pass = 0, fail = 0;
for (const r of results) {
  if (r.ok) { pass++; console.log('  OK  ' + r.name); }
  else { fail++; console.log('  XX  ' + r.name + '\n      ' + r.err); }
}
console.log('\nTotal: ' + (pass + fail) + ' | Pass: ' + pass + ' | Fail: ' + fail);
process.exit(fail ? 1 : 0);
