'use strict';
// Slice 3: reconcileBlockToInvoice turns a reconcile report block into a saveable
// WO invoice whose computeInvoiceTotals grand total reproduces the paid amount.
// MSR = divide-out (face price + taxable kept); AMH = fold vendorTax into unitPrice,
// taxable:false (Core Truth #2). Pure, fixture-free. Exit 0 pass / 1 fail.
const assert = require('assert');
const { loadEsm } = require('./_load.js');
const { matchAmhRow, reconcileAmhRow, matchMsrRow, reconcileMsrRow,
  reconcileBlockToInvoice, computeInvoiceTotals } = loadEsm('src/orders-logic.js');

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e.message }); }
}

const ORDERS = [
  { id: 'WO-1', woId: '9692517', pm: 'AMH', address: '10 Oak St' },
  { id: 'WO-2', woId: '02045937', pm: 'MSR', address: '5 Elm Dr' },
];

test('AMH: folded invoice grand total == paid (per-line vendorTax)', () => {
  const r = { woId: '9692517', invoiceNum: 'W9692517B0042838', amount: 351.03 };
  const block = reconcileAmhRow(r, matchAmhRow(r, ORDERS), [
    { name: 'Replace contactor', unitPrice: 300, vendorTax: 21.75, qty: 1 },
    { name: 'Capacitor', unitPrice: 29.28, vendorTax: 0, qty: 1 },
  ]);
  const inv = reconcileBlockToInvoice(block, 'amh');
  assert.strictEqual(inv.number, 'W9692517B0042838');
  assert.strictEqual(inv.lineItems[0].unitPrice, 321.75);   // 300 + 21.75 folded in
  assert.strictEqual(inv.lineItems[0].taxable, false);
  assert.strictEqual(computeInvoiceTotals(inv, 'AMH').grandTotal, 351.03);
});

test('AMH: service-call line still folds to match paid', () => {
  const r = { woId: '9692517', amount: 100 };
  const block = reconcileAmhRow(r, matchAmhRow(r, ORDERS), [
    { name: 'HVAC - Service Call', unitPrice: 90, vendorTax: 0, qty: 1 },
    { name: 'Replace blower motor', unitPrice: 10, vendorTax: 0, qty: 1 },
  ]);
  const inv = reconcileBlockToInvoice(block, 'amh');
  assert.strictEqual(computeInvoiceTotals(inv, 'AMH').grandTotal, 100);
});

test('MSR: face price + taxable kept; grand == paid (divide-out invariant)', () => {
  const r = { woId: '02045937', invoiceNum: 'PI55012', amount: 1358 };
  const block = reconcileMsrRow(r, matchMsrRow(r, ORDERS), [
    { name: 'Water Heater', desc: '50 gal gas', unitPrice: 1123, qty: 1, taxable: false },
    { name: 'Clean Drain', desc: 'clean main drain', unitPrice: 235, qty: 1, taxable: true },
  ]);
  const inv = reconcileBlockToInvoice(block, 'msr');
  assert.strictEqual(inv.number, 'PI55012');
  assert.strictEqual(inv.lineItems[0].name, 'Water Heater');   // canonical name carried
  assert.strictEqual(inv.lineItems[1].taxable, true);
  assert.strictEqual(computeInvoiceTotals(inv, 'MSR').grandTotal, 1358);
});

test('MSR: suspect flag carries block -> invoice (editor warning icon)', () => {
  const r = { woId: '02045937', invoiceNum: 'PI55012', amount: 260 };
  const block = reconcileMsrRow(r, matchMsrRow(r, ORDERS), [
    { name: 'MSR!', desc: 'shower valve', unitPrice: 260, qty: 1, taxable: true,
      priceFlag: 'red', suspects: [{ name: 'Tub and Shower Valve', price: 220 }] },
  ]);
  assert.strictEqual(block.lines[0].priceFlag, 'red');
  const inv = reconcileBlockToInvoice(block, 'msr');
  assert.strictEqual(inv.lineItems[0].priceFlag, 'red');
  assert.ok(Array.isArray(inv.lineItems[0].suspects));
});

test('empty block -> empty lineItems, no throw', () => {
  const inv = reconcileBlockToInvoice({ invoiceNum: '', lines: [] }, 'amh', '2026-07-09');
  assert.strictEqual(inv.lineItems.length, 0);
  assert.strictEqual(inv.date, '2026-07-09');
});

console.log('reconcile-to-invoice test');
console.log('=========================');
let pass = 0, fail = 0;
for (const r of results) {
  if (r.ok) { pass++; console.log('  OK  ' + r.name); }
  else { fail++; console.log('  XX  ' + r.name + '\n      ' + r.err); }
}
console.log('\nTotal: ' + (pass + fail) + ' | Pass: ' + pass + ' | Fail: ' + fail);
process.exit(fail ? 1 : 0);
