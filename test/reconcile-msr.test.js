'use strict';
// MSR remittance reconcile (invoice-generation Slice 1): matchMsrRow + reconcileMsrRow.
// Pure logic, fixture-free (portable). Mirrors the real remittance shape proven by
// parse_msr_remittance.py against Vendor_ACH_Payment_Detail_-SSRS1. SHIPPED code via
// the esbuild bridge. Exit: 0 pass / 1 fail.
const assert = require('assert');
const { loadEsm } = require('./_load.js');
const { normWoNum, normAddress, matchMsrRow, reconcileMsrRow } = loadEsm('src/orders-logic.js');

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

console.log('reconcile-msr test');
console.log('==================');
let pass = 0, fail = 0;
for (const r of results) {
  if (r.ok) { pass++; console.log('  OK  ' + r.name); }
  else { fail++; console.log('  XX  ' + r.name + '\n      ' + r.err); }
}
console.log('\nTotal: ' + (pass + fail) + ' | Pass: ' + pass + ' | Fail: ' + fail);
process.exit(fail ? 1 : 0);
