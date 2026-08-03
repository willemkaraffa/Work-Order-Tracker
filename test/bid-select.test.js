'use strict';
// chooseBidCoFiles (Bug A) + resolveBidSheetName (Bug B): pure main-process helpers,
// tested by direct require (no electron/fs). Exit 0 pass / 1 fail.
const assert = require('assert');
const { chooseBidCoFiles, resolveBidSheetName, dedupeLineItems } = require('../bid-select.js');

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e.message }); }
}

const names = (arr) => arr.map(f => f.name);

// ---- chooseBidCoFiles (Bug A) ----
test('two bids + one CO -> newest bid + CO', () => {
  const out = chooseBidCoFiles([
    { name: '478 Bid 07-07.xlsx', mtime: 100 },
    { name: '478 Bid 09-07.xlsx', mtime: 200 },
    { name: '478 CO 09-20.xlsx', mtime: 300 },
  ]);
  assert.deepStrictEqual(names(out).sort(), ['478 Bid 09-07.xlsx', '478 CO 09-20.xlsx'].sort());
});

test('single bid -> itself', () => {
  const out = chooseBidCoFiles([{ name: 'Bid.xlsx', mtime: 100 }]);
  assert.deepStrictEqual(names(out), ['Bid.xlsx']);
});

test('only COs -> all COs, no bid', () => {
  const out = chooseBidCoFiles([
    { name: 'CO one.xlsx', mtime: 100 },
    { name: 'CO two.xlsx', mtime: 200 },
  ]);
  assert.deepStrictEqual(names(out).sort(), ['CO one.xlsx', 'CO two.xlsx'].sort());
});

test('multiple bids, no CO -> newest only', () => {
  const out = chooseBidCoFiles([
    { name: 'Bid A.xlsx', mtime: 300 },
    { name: 'Bid B.xlsx', mtime: 100 },
    { name: 'Bid C.xlsx', mtime: 200 },
  ]);
  assert.deepStrictEqual(names(out), ['Bid A.xlsx']);
});

test('empty -> empty', () => {
  assert.deepStrictEqual(chooseBidCoFiles([]), []);
});

test('equal-mtime tie is deterministic (first-seen bid wins)', () => {
  const out = chooseBidCoFiles([
    { name: 'Bid first.xlsx', mtime: 100 },
    { name: 'Bid second.xlsx', mtime: 100 },
  ]);
  assert.deepStrictEqual(names(out), ['Bid first.xlsx']);
});

// ---- resolveBidSheetName (Bug B) ----
const BID_CELLS = { HVAC: { sheet: 'Vendor HVAC Bid Sheet' }, Plumbing: { sheet: 'Plumbing - Rough & Finish' } };

test('HVAC-only workbook -> HVAC sheet', () => {
  assert.strictEqual(resolveBidSheetName(['Cover', 'Vendor HVAC Bid Sheet'], BID_CELLS), 'Vendor HVAC Bid Sheet');
});

test('Plumbing-only workbook -> Plumbing sheet', () => {
  assert.strictEqual(resolveBidSheetName(['Plumbing - Rough & Finish'], BID_CELLS), 'Plumbing - Rough & Finish');
});

test('both sheets present -> null (type fallback)', () => {
  assert.strictEqual(resolveBidSheetName(['Vendor HVAC Bid Sheet', 'Plumbing - Rough & Finish'], BID_CELLS), null);
});

test('neither sheet present -> null (type fallback)', () => {
  assert.strictEqual(resolveBidSheetName(['Sheet1', 'Notes'], BID_CELLS), null);
});

// ---- dedupeLineItems (Bug A: main-table vs OTHER overlap) ----
const descs = (arr) => arr.map(i => i.desc).sort();

// Airedale WO 03429915: main table + OTHER free-text list the SAME work with wording
// ("Clean Condenser" vs "Clean condenser coil") and rounding drift. Union of 6 rows has
// 2 overlapping pairs (Clean Condenser, Capacitor) -> collapses to 4 lines. R410a
// (table-only) and Service Call (OTHER-only) survive. (Plan's "5 lines" is a miscount;
// its own retained-item list -- Clean Condenser + Capacitor once, R410a + Service Call
// retained -- is 4, matching the mechanism.)
test('Airedale union collapses overlap, keeps table-only + OTHER-only (4 lines)', () => {
  const table = [
    { desc: 'Clean Condenser', unitPrice: 150, qty: 1 },
    { desc: 'R410a', unitPrice: 62.5, qty: 1 },
    { desc: 'Capacitor Replacement', unitPrice: 124.58, qty: 1 },
  ];
  const other = [
    { desc: 'Service Call', unitPrice: 85, qty: 1 },
    { desc: 'Clean condenser coil', unitPrice: 150, qty: 1 },
    { desc: 'Capacitor', unitPrice: 124.58, qty: 1 },
  ];
  const out = dedupeLineItems([...table, ...other]);
  assert.strictEqual(out.length, 4, 'expected 4 deduped lines, got ' + out.length);
  // richer desc kept for the two collapsed pairs.
  assert.deepStrictEqual(descs(out),
    ['Capacitor Replacement', 'Clean condenser coil', 'R410a', 'Service Call'].sort());
});

test('table-only item survives (R410a)', () => {
  const out = dedupeLineItems([{ desc: 'R410a', unitPrice: 62.5, qty: 1 }]);
  assert.deepStrictEqual(out, [{ desc: 'R410a', unitPrice: 62.5, qty: 1 }]);
});

test('OTHER-only item survives (Service Call)', () => {
  const out = dedupeLineItems([{ desc: 'Service Call', unitPrice: 85, qty: 1 }]);
  assert.deepStrictEqual(out, [{ desc: 'Service Call', unitPrice: 85, qty: 1 }]);
});

test('rounding collision same wording collapses (124.584 vs 124.58)', () => {
  const out = dedupeLineItems([
    { desc: 'Capacitor', unitPrice: 124.584, qty: 1 },
    { desc: 'Capacitor', unitPrice: 124.58, qty: 1 },
  ]);
  assert.strictEqual(out.length, 1);
});

test('wording collision collapses, richer desc kept (Clean Condenser vs Clean condenser coil)', () => {
  const out = dedupeLineItems([
    { desc: 'Clean Condenser', unitPrice: 150, qty: 1 },
    { desc: 'Clean condenser coil', unitPrice: 150, qty: 1 },
  ]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].desc, 'Clean condenser coil');
});

test('over-merge guard: different work at same price stays 2 lines', () => {
  const out = dedupeLineItems([
    { desc: 'Replace Capacitor', unitPrice: 150, qty: 1 },
    { desc: 'Clean Condenser Coil', unitPrice: 150, qty: 1 },
  ]);
  assert.strictEqual(out.length, 2);
});

test('price near-miss keeps both (Capacitor@124.58 vs Capacitor@150)', () => {
  const out = dedupeLineItems([
    { desc: 'Capacitor', unitPrice: 124.58, qty: 1 },
    { desc: 'Capacitor', unitPrice: 150, qty: 1 },
  ]);
  assert.strictEqual(out.length, 2);
});

test('two canonical Service Call @85 collapse to one (diagnostic + OTHER restate)', () => {
  const out = dedupeLineItems([
    { desc: 'Service Call', unitPrice: 85, qty: 1 },
    { desc: 'Service Call', unitPrice: 85, qty: 1 },
  ]);
  assert.strictEqual(out.length, 1);
});

test('lone canonical Service Call survives (diagnostic-only, OTHER blank)', () => {
  const out = dedupeLineItems([{ desc: 'Service Call', unitPrice: 85, qty: 1 }]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].unitPrice, 85);
});

test('empty input -> []', () => {
  assert.deepStrictEqual(dedupeLineItems([]), []);
});

console.log('bid-select test');
console.log('===============');
let pass = 0, fail = 0;
for (const r of results) {
  if (r.ok) { pass++; console.log('  OK  ' + r.name); }
  else { fail++; console.log('  XX  ' + r.name + '\n      ' + r.err); }
}
console.log('\nTotal: ' + (pass + fail) + ' | Pass: ' + pass + ' | Fail: ' + fail);
process.exit(fail ? 1 : 0);
