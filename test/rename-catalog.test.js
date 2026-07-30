'use strict';
// Item 2: renaming a CUSTOM catalog renames the service_library KEY (order-
// preserving) and cascades to saved invoice line agreements without moving totals
// (custom catalogs resolve to DEFAULT_CATALOG_TAX). Exercises the SHIPPED pure
// transforms renameCatalog / renameLineAgreement + computeInvoiceTotals via the
// esbuild bridge.
//   node test/rename-catalog.test.js  (exit 0 pass / 1 fail)
const assert = require('assert');
const { loadEsm } = require('./_load.js');
const { renameCatalog, renameLineAgreement, computeInvoiceTotals } = loadEsm('src/orders-logic.js');

let fails = 0;
function check(label, fn) {
  try { fn(); console.log('  ok   ' + label); }
  catch (e) { fails++; console.log('  FAIL ' + label + ': ' + e.message); }
}

console.log('rename catalog (Item 2)');

check('renames a custom key, preserves other keys + order', () => {
  const lib = { General: [1], AMH: [2], Custom: [3], MSR: [4] };
  const out = renameCatalog(lib, 'Custom', 'Renamed');
  assert.deepStrictEqual(Object.keys(out), ['General', 'AMH', 'Renamed', 'MSR']);
  assert.strictEqual(out.Renamed, lib.Custom); // arr ref preserved (in-place rename)
  assert.strictEqual(out.General, lib.General);
});

check('no-op when newName collides with an existing key', () => {
  const lib = { General: [1], Custom: [2] };
  assert.strictEqual(renameCatalog(lib, 'Custom', 'General'), lib);
});

check('no-op when oldName absent', () => {
  const lib = { General: [1] };
  assert.strictEqual(renameCatalog(lib, 'Nope', 'New'), lib);
});

check('non-object guard returns input', () => {
  assert.strictEqual(renameCatalog(null, 'a', 'b'), null);
});

console.log('rename line agreement cascade');

check('rewrites agreement on matching saved-invoice lines across orders', () => {
  const orders = [
    { id: 1, invoice: { lineItems: [{ agreement: 'Custom', price: 10 }, { agreement: 'AMH', price: 5 }] } },
    { id: 2, invoice: { lineItems: [{ agreement: 'Custom', price: 20 }] } },
  ];
  const out = renameLineAgreement(orders, 'Custom', 'Renamed');
  assert.strictEqual(out[0].invoice.lineItems[0].agreement, 'Renamed');
  assert.strictEqual(out[0].invoice.lineItems[1].agreement, 'AMH');
  assert.strictEqual(out[1].invoice.lineItems[0].agreement, 'Renamed');
});

check('leaves non-matching orders untouched (same object ref)', () => {
  const noMatch = { id: 3, invoice: { lineItems: [{ agreement: 'AMH', price: 5 }] } };
  const out = renameLineAgreement([noMatch], 'Custom', 'Renamed');
  assert.strictEqual(out[0], noMatch);
});

check('orders without invoice/lineItems pass through', () => {
  const a = { id: 4 };
  const b = { id: 5, invoice: {} };
  const c = null;
  const out = renameLineAgreement([a, b, c], 'Custom', 'Renamed');
  assert.strictEqual(out[0], a);
  assert.strictEqual(out[1], b);
  assert.strictEqual(out[2], c);
});

check('no-op guards (non-array / same name) return input', () => {
  assert.strictEqual(renameLineAgreement(null, 'a', 'b'), null);
  const orders = [{ id: 1, invoice: { lineItems: [{ agreement: 'Custom' }] } }];
  assert.strictEqual(renameLineAgreement(orders, 'Custom', 'Custom'), orders);
});

check('TOTALS STABLE across a custom-catalog rename (default tax both sides)', () => {
  const order = { id: 1, invoice: { lineItems: [
    { agreement: 'Custom', name: 'x', unitPrice: 100, qty: 1, taxable: true },
    { agreement: 'Custom', name: 'y', unitPrice: 50, qty: 2, taxable: false },
  ] } };
  const before = computeInvoiceTotals({ lineItems: order.invoice.lineItems }, 'Custom');
  const out = renameLineAgreement([order], 'Custom', 'Renamed');
  const after = computeInvoiceTotals({ lineItems: out[0].invoice.lineItems }, 'Renamed');
  // Monetary fields only: rows[] echo the (changed) agreement string, so a full
  // deepStrictEqual would differ; the tax math is what must stay stable.
  assert.strictEqual(after.grandTotal, before.grandTotal);
  assert.strictEqual(after.taxableSubtotal, before.taxableSubtotal);
  assert.strictEqual(after.nonTaxableSubtotal, before.nonTaxableSubtotal);
  assert.strictEqual(after.tax, before.tax);
});

console.log('');
console.log(fails ? (fails + ' FAILURES') : 'ALL PASS');
process.exit(fails ? 1 : 0);
