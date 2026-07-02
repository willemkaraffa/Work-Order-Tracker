'use strict';
// Build A: bidItemsToInvoiceLines. Scraped bidItems store the human description
// in `name` (no desc field); the invoice autofill must surface it. Regression
// guard for the "prices but no descriptions" bug (WO 9767507). SHIPPED code via
// the esbuild bridge. Exit: 0 pass / 1 fail.
const assert = require('assert');
const { loadEsm } = require('./_load.js');
const { bidItemsToInvoiceLines } = loadEsm('src/orders-logic.js');

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e.message }); }
}

// WO 9767507 real bidItems (from wo-data.json) — the reported example.
const WO9767507 = [
  { name: 'HVAC - Service Call', qty: 1, price: 90 },
  { name: 'Clear condensate drain line', qty: 1, price: 90 },
  { name: 'Labor replace the indoor unit condensate drain pan', qty: 1, price: 375 },
  { name: 'Material- external and internal drain pans', qty: 1, price: 150 },
];

test('every line gets a non-empty description from bidItem.name', () => {
  const lines = bidItemsToInvoiceLines(WO9767507, [], 'AMH');
  assert.strictEqual(lines.length, 4);
  for (const l of lines) assert.ok(l.desc && l.desc.length > 0, 'empty desc: ' + JSON.stringify(l));
});

test('descriptions match the source bidItem names exactly', () => {
  const lines = bidItemsToInvoiceLines(WO9767507, [], 'AMH');
  assert.strictEqual(lines[1].desc, 'Clear condensate drain line');
  assert.strictEqual(lines[3].desc, 'Material- external and internal drain pans');
});

test('price carried from bidItem.price on a catalog miss', () => {
  const lines = bidItemsToInvoiceLines(WO9767507, [], 'AMH');
  assert.strictEqual(lines[2].unitPrice, 375);
});

test('material-keyword line -> Materials! sentinel + material category', () => {
  const lines = bidItemsToInvoiceLines(WO9767507, [], 'AMH');
  assert.strictEqual(lines[3].name, 'Materials!');
  assert.strictEqual(lines[3].category, 'material');
});

test('non-material line -> Labor! sentinel + labor category', () => {
  const lines = bidItemsToInvoiceLines(WO9767507, [], 'AMH');
  assert.strictEqual(lines[0].name, 'Labor!');
  assert.strictEqual(lines[0].category, 'labor');
});

test('catalog hit drives name/price/taxable; desc still from bid; agreement set', () => {
  const catalog = [{ name: 'Clear condensate drain line', desc: 'Flush AC drain', price: 120, taxable: true }];
  const lines = bidItemsToInvoiceLines(WO9767507, catalog, 'MSR');
  const hit = lines[1];
  assert.strictEqual(hit.name, 'Clear condensate drain line');
  assert.strictEqual(hit.unitPrice, 120);
  assert.strictEqual(hit.taxable, true);
  assert.strictEqual(hit.desc, 'Clear condensate drain line');
  assert.strictEqual(hit.agreement, 'MSR');
});

test('catalog match is case-insensitive and matches item desc too', () => {
  const catalog = [{ name: 'SVC', desc: 'clear condensate DRAIN line', price: 55, taxable: false }];
  const lines = bidItemsToInvoiceLines(WO9767507, catalog, 'AMH');
  assert.strictEqual(lines[1].name, 'SVC');
  assert.strictEqual(lines[1].unitPrice, 55);
});

test('empty / non-array bidItems -> []', () => {
  assert.deepStrictEqual(bidItemsToInvoiceLines([], [], 'AMH'), []);
  assert.deepStrictEqual(bidItemsToInvoiceLines(null, [], 'AMH'), []);
  assert.deepStrictEqual(bidItemsToInvoiceLines(undefined, null, 'AMH'), []);
});

test('qty defaults to 1 when missing or invalid', () => {
  const lines = bidItemsToInvoiceLines(
    [{ name: 'X', price: 5 }, { name: 'Y', qty: 0, price: 5 }, { name: 'Z', qty: 3, price: 5 }], [], 'AMH');
  assert.strictEqual(lines[0].qty, 1);
  assert.strictEqual(lines[1].qty, 1);
  assert.strictEqual(lines[2].qty, 3);
});

test('string price parses to number', () => {
  const lines = bidItemsToInvoiceLines([{ name: 'X', qty: 1, price: '250.50' }], [], 'AMH');
  assert.strictEqual(lines[0].unitPrice, 250.5);
});

console.log('invoice-lines test');
console.log('==================');
let pass = 0, fail = 0;
for (const r of results) {
  if (r.ok) { pass++; console.log('  OK  ' + r.name); }
  else { fail++; console.log('  XX  ' + r.name + '\n      ' + r.err); }
}
console.log('\nTotal: ' + (pass + fail) + ' | Pass: ' + pass + ' | Fail: ' + fail);
process.exit(fail > 0 ? 1 : 0);
