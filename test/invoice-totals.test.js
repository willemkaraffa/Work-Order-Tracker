'use strict';
// computeInvoiceTotals: the money core. Locks the per-catalog tax policy
// (constants.CATALOG_TAX) via the SHIPPED code through the esbuild bridge.
//   General / AMH taxable line -> tax ADDED on top (pre-tax price).
//   MSR taxable line          -> tax DIVIDED back out (price is inclusive; grand = face).
//   Non-taxable line          -> used as-is.
//   AMH service call ($90)    -> taxable + pre-tax (the caveat: AMH is not uniformly non-taxable).
// Exit: 0 pass / 1 fail.
const assert = require('assert');
const { loadEsm } = require('./_load.js');
const { computeInvoiceTotals, bidItemsToInvoiceLines } = loadEsm('src/orders-logic.js');

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e.message }); }
}
const inv = (lines) => ({ lineItems: lines });

test('General taxable labor: tax added on top', () => {
  const t = computeInvoiceTotals(inv([{ unitPrice: 100, qty: 1, taxable: true, agreement: 'General' }]), 'General');
  assert.strictEqual(t.taxableSubtotal, 100);
  assert.strictEqual(t.tax, 7.25);
  assert.strictEqual(t.grandTotal, 107.25);
});

test('AMH service call ($90) taxable is PRE-TAX (added, not divided)', () => {
  const t = computeInvoiceTotals(inv([{ unitPrice: 90, qty: 1, taxable: true, agreement: 'AMH' }]), 'AMH');
  assert.strictEqual(t.taxableSubtotal, 90);      // NOT divided out
  assert.strictEqual(t.tax, 6.53);
  assert.strictEqual(t.grandTotal, 96.53);
});

test('AMH premier non-taxable line: used as-is', () => {
  const t = computeInvoiceTotals(inv([{ unitPrice: 4608.32, qty: 1, taxable: false, agreement: 'AMH' }]), 'AMH');
  assert.strictEqual(t.grandTotal, 4608.32);
  assert.strictEqual(t.tax, 0);
});

test('MSR taxable line: tax divided back out, grand = face', () => {
  const t = computeInvoiceTotals(inv([{ unitPrice: 85, qty: 1, taxable: true, agreement: 'MSR' }]), 'MSR');
  assert.strictEqual(t.taxableSubtotal, 79.25);   // 85 / 1.0725
  assert.strictEqual(t.tax, 5.75);
  assert.strictEqual(t.grandTotal, 85);           // face preserved
});

test('MSR non-taxable line: used as-is', () => {
  const t = computeInvoiceTotals(inv([{ unitPrice: 145, qty: 1, taxable: false, agreement: 'MSR' }]), 'MSR');
  assert.strictEqual(t.grandTotal, 145);
});

test('per-line agreement wins over defaultAgreement (bug #2: General line on MSR WO adds tax)', () => {
  // MSR WO (defaultAgreement MSR) but the line is a General item -> must ADD tax, not divide out.
  const t = computeInvoiceTotals(inv([{ unitPrice: 100, qty: 1, taxable: true, agreement: 'General' }]), 'MSR');
  assert.strictEqual(t.grandTotal, 107.25);
});

test('blank line agreement falls back to the WO catalog (MSR -> divide out)', () => {
  const t = computeInvoiceTotals(inv([{ unitPrice: 85, qty: 1, taxable: true, agreement: '' }]), 'MSR');
  assert.strictEqual(t.grandTotal, 85);
});

test('mixed lines: cent rounding on subtotals, not per line', () => {
  const t = computeInvoiceTotals(inv([
    { unitPrice: 85, qty: 1, taxable: true,  agreement: 'MSR' },   // -> 79.25 pre-tax
    { unitPrice: 145, qty: 1, taxable: false, agreement: 'MSR' },  // -> 145 non-tax
  ]), 'MSR');
  assert.strictEqual(t.taxableSubtotal, 79.25);
  assert.strictEqual(t.nonTaxableSubtotal, 145);
  assert.strictEqual(t.grandTotal, 230);          // 85 + 145
});

test('empty / invalid invoice -> zero totals', () => {
  const t = computeInvoiceTotals({ lineItems: [] }, 'General');
  assert.strictEqual(t.grandTotal, 0);
  const t2 = computeInvoiceTotals(null, 'General');
  assert.strictEqual(t2.grandTotal, 0);
});

test('miss-path labor default is per-catalog: General + MSR taxed, AMH not; per-PM name', () => {
  // General taxes generic labor (added on top). MSR taxes custom labor too (divide-out, so
  // total-invariant -- only the reported tax split changes). AMH is Premier-inclusive -> never
  // taxed. Unmatched labor is named by the WO agreement: General -> Labor!, AMH -> AMH!, MSR -> MSR!.
  // (A service-call/diagnostic/emergency wording would override to taxable -- tested elsewhere.)
  const bid = [{ name: 'Replace a broken part', qty: 1, price: 100 }];  // action verb -> labor sentinel
  assert.strictEqual(bidItemsToInvoiceLines(bid, [], 'General')[0].name, 'Labor!');
  assert.strictEqual(bidItemsToInvoiceLines(bid, [], 'General')[0].taxable, true);
  assert.strictEqual(bidItemsToInvoiceLines(bid, [], 'AMH')[0].name, 'AMH!');
  assert.strictEqual(bidItemsToInvoiceLines(bid, [], 'AMH')[0].taxable, false);
  assert.strictEqual(bidItemsToInvoiceLines(bid, [], 'MSR')[0].name, 'MSR!');
  assert.strictEqual(bidItemsToInvoiceLines(bid, [], 'MSR')[0].taxable, true);
});

console.log('invoice-totals test');
console.log('===================');
let pass = 0, fail = 0;
for (const r of results) {
  if (r.ok) { pass++; console.log('  OK  ' + r.name); }
  else { fail++; console.log('  XX  ' + r.name + '\n      ' + r.err); }
}
console.log('\nTotal: ' + (pass + fail) + ' | Pass: ' + pass + ' | Fail: ' + fail);
process.exit(fail ? 1 : 0);
