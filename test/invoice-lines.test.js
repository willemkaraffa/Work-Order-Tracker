'use strict';
// Build A: bidItemsToInvoiceLines. Scraped bidItems store the human description
// in `name` (no desc field); the invoice autofill must surface it. Regression
// guard for the "prices but no descriptions" bug (WO 9767507). SHIPPED code via
// the esbuild bridge. Exit: 0 pass / 1 fail.
const assert = require('assert');
const { loadEsm } = require('./_load.js');
const { bidItemsToInvoiceLines, razorSyncRows, TAX_RATE } = loadEsm('src/orders-logic.js');

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

test('action-verb line -> per-PM labor sentinel + labor category', () => {
  const lines = bidItemsToInvoiceLines(WO9767507, [], 'AMH');
  // lines[2] = "Labor replace the indoor unit condensate drain pan" (verb "replace").
  // Unlisted labor sentinel is always Labor! now (client carried on agreement).
  assert.strictEqual(lines[2].name, 'Labor!');
  assert.strictEqual(lines[2].agreement, 'AMH');
  assert.strictEqual(lines[2].category, 'labor');
});

test('service-call line -> per-PM labor sentinel + ALWAYS taxable (core truth #3)', () => {
  const lines = bidItemsToInvoiceLines(WO9767507, [], 'AMH');
  // lines[0] = "HVAC - Service Call": verbless, but Service Call/Diagnostic/Emergency
  // are forced to labor + taxable even on an AMH WO (whose default is non-taxable).
  assert.strictEqual(lines[0].name, 'Labor!');
  assert.strictEqual(lines[0].category, 'labor');
  assert.strictEqual(lines[0].taxable, true);
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

test('AMH miss: Premier items NEVER taxed except service call (core truths #2/#3)', () => {
  const lines = bidItemsToInvoiceLines(WO9767507, [], 'AMH');
  assert.strictEqual(lines[0].taxable, true);    // "HVAC - Service Call" -> ALWAYS taxed
  assert.strictEqual(lines[1].name, 'Labor!');   // "Clear condensate drain line" (verb)
  assert.strictEqual(lines[1].taxable, false);   // AMH Premier labor -> inclusive, not taxed (agreement default)
  assert.strictEqual(lines[2].name, 'Labor!');   // "Labor replace..." -> unlisted labor sentinel
  assert.strictEqual(lines[2].taxable, false);   // AMH Premier labor -> not taxed
  assert.strictEqual(lines[3].name, 'Materials!');
  assert.strictEqual(lines[3].taxable, false);   // "Material-..." -> material, not taxed
});

test('catalog hit taxable flag still wins over the miss inference', () => {
  const catalog = withFiller({ name: 'Clear condensate drain line', price: 90, taxable: false });
  const lines = bidItemsToInvoiceLines(WO9767507, catalog, 'General');
  assert.strictEqual(lines[1].taxable, false);        // library says non-taxable
});

// ---- Fix 7: RazorSync two-line entry for a MIXED tax-inclusive line ----
// RazorSync taxes PER LINE from the catalog item, so a line that is part taxed labor and
// part untaxed material cannot enter as one row. Material goes under `Materials!` and the
// PRE-TAX labor under `MSR!`; RazorSync re-adds 7.25% to the second row and the pair
// lands on the face price.
const money = (n) => Math.round(Number(n) * 100) / 100;
// share = labor/(material+labor) = 200/600 = 1/3. face 900 -> labor 300, preTaxLabor
// 279.72, tax 20.28, pre 879.72, material row 600.00.
const MIXED = { name: 'Water Heater Replacement', desc: 'Replace 50 gallon water heater',
  qty: 1, unitPrice: 900, category: 'labor', agreement: 'MSR',
  material: 400, labor: 200, pre: 879.72, tax: 20.28, post: 900 };

test('razorSyncRows: MIXED MSR line splits into Materials! then MSR!', () => {
  const rows = razorSyncRows(MIXED, 'MSR');
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].tag, 'Materials!');      // material FIRST, entry order
  assert.strictEqual(rows[1].tag, 'MSR!');
  assert.strictEqual(rows[0].price, 600);
  assert.strictEqual(rows[1].price, 279.72);
  assert.strictEqual(rows[0].desc, MIXED.desc);       // both rows carry the same wording
  assert.strictEqual(rows[1].desc, MIXED.desc);
});

test('razorSyncRows: the two rows sum to PRE-TAX, and to FACE once RazorSync taxes', () => {
  const rows = razorSyncRows(MIXED, 'MSR');
  assert.strictEqual(money(rows[0].price + rows[1].price), MIXED.pre);
  assert.strictEqual(money(rows[0].price + rows[1].price * TAX_RATE), MIXED.post);
});

test('razorSyncRows: qty > 1 splits the FULL face, not the unit', () => {
  const rows = razorSyncRows({ ...MIXED, qty: 2, unitPrice: 450 }, 'MSR');
  assert.strictEqual(money(rows[0].price + rows[1].price * TAX_RATE), 900);
});

test('razorSyncRows: labor-only and material-only lines stay ONE row', () => {
  // The 19 diagnostics/cleanings are labor-only; the 4 refrigerants are material-only.
  const laborOnly = { ...MIXED, name: 'Clean Condenser', material: 0, labor: 150,
    unitPrice: 150, pre: 139.86, tax: 10.14, post: 150 };
  assert.strictEqual(razorSyncRows(laborOnly, 'MSR').length, 1);
  const materialOnly = { ...MIXED, name: 'R410a', category: 'material', material: 62.50,
    labor: 0, unitPrice: 62.50, pre: 62.50, tax: 0, post: 62.50 };
  const solo = razorSyncRows(materialOnly, 'MSR');
  assert.strictEqual(solo.length, 1);
  assert.strictEqual(solo[0].price, 62.50);
});

test('razorSyncRows: a line with NO split stays one row', () => {
  const { material, labor, ...noSplit } = MIXED;   // eslint-disable-line no-unused-vars
  const rows = razorSyncRows(noSplit, 'MSR');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].price, noSplit.pre);
});

test('razorSyncRows: an AMH line NEVER splits (D7, its columns are cost basis)', () => {
  const rows = razorSyncRows({ ...MIXED, agreement: 'AMH' }, 'AMH');
  assert.strictEqual(rows.length, 1);
  // General is not tax-inclusive either.
  assert.strictEqual(razorSyncRows({ ...MIXED, agreement: 'General' }, 'General').length, 1);
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
