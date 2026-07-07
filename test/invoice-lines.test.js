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

// Catalog matching is IDF-weighted (Slice 1b) so a candidate needs a corpus to score
// against -- a lone-item catalog gives every token idf 0 and nothing matches. Seed the
// tested item into a realistically sized catalog (item + inert filler), exactly as it
// sits in the 250-item live library. Also: matching is NAME-only now (item desc is the
// scope-tab label for AMH and is deliberately ignored).
const filler = (n) => Array.from({ length: n }, (_, i) => (
  { name: `Zzq${i} Wodget${i}`, desc: '', price: 1000 + i, taxable: false }));
const withFiller = (item) => [item, ...filler(24)];

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

test('action-verb line -> Labor! sentinel + labor category', () => {
  const lines = bidItemsToInvoiceLines(WO9767507, [], 'AMH');
  // lines[2] = "Labor replace the indoor unit condensate drain pan" (verb "replace").
  assert.strictEqual(lines[2].name, 'Labor!');
  assert.strictEqual(lines[2].category, 'labor');
});

test('verbless service line -> Materials! (user rule: no action verb = material)', () => {
  const lines = bidItemsToInvoiceLines(WO9767507, [], 'AMH');
  // lines[0] = "HVAC - Service Call" has no action verb -> Materials! per the rule.
  // (Real service calls are catalog items, so they hit before reaching this fallback.)
  assert.strictEqual(lines[0].name, 'Materials!');
});

test('catalog hit (keyword + confirming price) drives name/price/taxable; desc from bid', () => {
  // Price MUST equal the bid price (90) to CONFIRM identity; keyword picks the candidate.
  const catalog = withFiller({ name: 'Clear condensate drain line', desc: 'Flush AC drain', price: 90, taxable: true });
  const lines = bidItemsToInvoiceLines(WO9767507, catalog, 'MSR');
  const hit = lines[1];
  assert.strictEqual(hit.name, 'Clear condensate drain line');
  assert.strictEqual(hit.unitPrice, 90);
  assert.strictEqual(hit.taxable, true);
  assert.strictEqual(hit.desc, 'Clear condensate drain line');
  assert.strictEqual(hit.agreement, 'MSR');
});

test('keyword match is fuzzy + case-insensitive (on the item NAME)', () => {
  const catalog = withFiller({ name: 'Clear Condensate DRAIN Line', desc: '', price: 90, taxable: false });
  const lines = bidItemsToInvoiceLines(WO9767507, catalog, 'AMH');
  assert.strictEqual(lines[1].name, 'Clear Condensate DRAIN Line');
  assert.strictEqual(lines[1].unitPrice, 90);
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

test('non-AMH labor miss -> taxable true; material miss -> false', () => {
  const lines = bidItemsToInvoiceLines(WO9767507, [], 'General');
  assert.strictEqual(lines[2].name, 'Labor!');        // "Labor replace..." (verb)
  assert.strictEqual(lines[2].taxable, true);         // General labor taxable
  assert.strictEqual(lines[3].name, 'Materials!');
  assert.strictEqual(lines[3].taxable, false);        // material not taxable
});

test('AMH miss stays non-taxable (premier all-inclusive)', () => {
  const lines = bidItemsToInvoiceLines(WO9767507, [], 'AMH');
  assert.strictEqual(lines[0].taxable, false);
  assert.strictEqual(lines[3].taxable, false);
});

test('catalog hit taxable flag still wins over the miss inference', () => {
  const catalog = withFiller({ name: 'Clear condensate drain line', price: 90, taxable: false });
  const lines = bidItemsToInvoiceLines(WO9767507, catalog, 'General');
  assert.strictEqual(lines[1].taxable, false);        // library says non-taxable
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
