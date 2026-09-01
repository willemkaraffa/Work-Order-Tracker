'use strict';
// sortInvoiceRows: the Invoices table's column sort. Pins the two things that go
// wrong silently -- blanks must sink to the bottom in BOTH directions, and the
// Sent key must order by the ORIGINAL send date (with the same dateCreated
// fallback the cell displays). SHIPPED code via the esbuild bridge. 0 pass / 1 fail.
const assert = require('assert');
const { loadEsm } = require('./_load.js');
const { sortInvoiceRows, parseBidAmount, invoiceRowTotal } = loadEsm('src/orders-logic.js');

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e.message }); }
}

const at = (y, m, d) => new Date(y, m - 1, d, 12).getTime();
const sent = (y, m, d) => [{ ts: at(y, m, d), action: 'sent to billing queue' }];
const ids = (rows) => rows.map(r => r.id).join(',');

const A = { id: '300', history: sent(2026, 3, 9),  address: 'Cedar Ln', city: 'Tampa', pm: 'MSR', bidAmount: '$1,200.00', invoice: null };
const B = { id: '1000', history: sent(2026, 1, 4), address: 'Alder Ave', city: 'Ocala', pm: 'AMH', bidAmount: '450', invoice: null };
const C = { id: '20', history: sent(2026, 7, 22),  address: 'Birch Rd', city: 'Largo', pm: 'MSR', bidAmount: '', invoice: null };

test('sent: desc = newest first, asc flips', () => {
  assert.strictEqual(ids(sortInvoiceRows([A, B, C], { key: 'sent', dir: 'desc' })), '20,300,1000');
  assert.strictEqual(ids(sortInvoiceRows([A, B, C], { key: 'sent', dir: 'asc' })), '1000,300,20');
});

test('sent: no history falls back to dateCreated, fully blank sinks BOTH ways', () => {
  const D = { id: '77', dateCreated: '2026-02-02' };
  const E = { id: '88' };
  assert.strictEqual(ids(sortInvoiceRows([E, D, A], { key: 'sent', dir: 'desc' })), '300,77,88');
  assert.strictEqual(ids(sortInvoiceRows([E, D, A], { key: 'sent', dir: 'asc' })), '77,300,88');
});

test('wo: numeric, not lexical (1000 > 300 > 20)', () => {
  assert.strictEqual(ids(sortInvoiceRows([A, B, C], { key: 'wo', dir: 'asc' })), '20,300,1000');
});

test('address/client: text compare, blank address sinks both ways', () => {
  assert.strictEqual(ids(sortInvoiceRows([A, B, C], { key: 'address', dir: 'asc' })), '1000,20,300');
  const F = { id: '5', address: '', city: '' };
  assert.strictEqual(ids(sortInvoiceRows([F, A, B], { key: 'address', dir: 'asc' })), '1000,300,5');
  assert.strictEqual(ids(sortInvoiceRows([F, A, B], { key: 'address', dir: 'desc' })), '300,1000,5');
  assert.strictEqual(ids(sortInvoiceRows([A, B], { key: 'client', dir: 'asc' })), '1000,300');
});

test('invoice #: unbilled rows sink below numbered ones', () => {
  const G = { id: '9', invoice: { number: 'INV-2' } };
  const H = { id: '8', invoice: { number: 'INV-1' } };
  assert.strictEqual(ids(sortInvoiceRows([A, G, H], { key: 'invoice', dir: 'asc' })), '8,9,300');
});

test('total: bid parses through commas/$; no-bid rows sort as 0', () => {
  assert.strictEqual(parseBidAmount('$1,200.00'), 1200);
  assert.strictEqual(parseBidAmount(null), 0);
  assert.strictEqual(parseBidAmount('n/a'), 0);
  assert.strictEqual(invoiceRowTotal(C), 0);
  assert.strictEqual(ids(sortInvoiceRows([B, A, C], { key: 'total', dir: 'desc' })), '300,1000,20');
});

test('recorded invoice beats bid for the total, and does not throw on odd shapes', () => {
  const I = { id: '11', bidAmount: '$10.00', invoice: { lineItems: [{ unitPrice: 500, qty: 1, taxable: false }] }, pm: 'MSR' };
  assert.ok(invoiceRowTotal(I) > 400);
  assert.strictEqual(ids(sortInvoiceRows([], { key: 'sent', dir: 'desc' })), '');
  assert.strictEqual(ids(sortInvoiceRows(null, { key: 'sent', dir: 'desc' })), '');
  assert.strictEqual(sortInvoiceRows([A], {}).length, 1);
});

test('does not mutate the caller array', () => {
  const src = [A, B, C];
  sortInvoiceRows(src, { key: 'wo', dir: 'asc' });
  assert.strictEqual(ids(src), '300,1000,20');
});

let fail = 0;
for (const r of results) {
  if (r.ok) console.log('  PASS ' + r.name);
  else { fail++; console.log('  FAIL ' + r.name + ' :: ' + r.err); }
}
console.log((results.length - fail) + '/' + results.length + ' passed');
process.exit(fail ? 1 : 0);
