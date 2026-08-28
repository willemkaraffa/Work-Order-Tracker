'use strict';
// chooseBidCoFiles (Bug A) + resolveBidSheetName (Bug B): pure main-process helpers,
// tested by direct require (no electron/fs). Exit 0 pass / 1 fail.
const assert = require('assert');
const { chooseBidCoFiles, additiveBidCoFiles, selectBidItems, resolveBidSheetName, dedupeLineItems, parseOtherCell, extractCount } = require('../bid-select.js');

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e.message }); }
}

const names = (arr) => arr.map(f => f.name);

// ---- chooseBidCoFiles (Bug A) ----
test('newest file wins; CO supersedes bids', () => {
  const out = chooseBidCoFiles([
    { name: '478 Bid 07-07.xlsx', mtime: 100 },
    { name: '478 Bid 09-07.xlsx', mtime: 200 },
    { name: '478 CO 09-20.xlsx', mtime: 300 },
  ]);
  assert.deepStrictEqual(names(out), ['478 CO 09-20.xlsx']);
});

test('single bid -> itself', () => {
  const out = chooseBidCoFiles([{ name: 'Bid.xlsx', mtime: 100 }]);
  assert.deepStrictEqual(names(out), ['Bid.xlsx']);
});

test('only COs -> newest CO', () => {
  const out = chooseBidCoFiles([
    { name: 'CO one.xlsx', mtime: 100 },
    { name: 'CO two.xlsx', mtime: 200 },
  ]);
  assert.deepStrictEqual(names(out), ['CO two.xlsx']);
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

test('equal-mtime tie: CO beats bid', () => {
  const out = chooseBidCoFiles([
    { name: 'X Bid.xlsx', mtime: 100 },
    { name: 'X CO.xlsx', mtime: 100 },
  ]);
  assert.deepStrictEqual(names(out), ['X CO.xlsx']);
});

// ---- additiveBidCoFiles (legacy partial-CO fallback) ----
test('additive: newest bid + every CO', () => {
  const out = additiveBidCoFiles([
    { name: '478 Bid 07-07.xlsx', mtime: 100 },
    { name: '478 Bid 09-07.xlsx', mtime: 200 },
    { name: '478 CO 09-20.xlsx', mtime: 300 },
  ]);
  assert.deepStrictEqual(names(out).sort(), ['478 Bid 09-07.xlsx', '478 CO 09-20.xlsx']);
});

test('additive: only COs -> both COs', () => {
  const out = additiveBidCoFiles([
    { name: 'CO one', mtime: 100 },
    { name: 'CO two', mtime: 200 },
  ]);
  assert.deepStrictEqual(names(out).sort(), ['CO one', 'CO two']);
});

test('additive: empty -> empty', () => {
  assert.deepStrictEqual(additiveBidCoFiles([]), []);
});

// ---- selectBidItems (paid amount is source of truth) ----
const sumOf = (arr) => Math.round(arr.reduce((s, x) => s + x.unitPrice * (x.qty > 0 ? x.qty : 1), 0) * 100) / 100;

test('selectBidItems: full-CO restatement, paid matches CO -> CO alone (1343) + statedTotal', () => {
  const cands = [
    { name: 'Bid.xlsx', mtime: 100, rows: [{ desc: 'A', unitPrice: 1000, qty: 1 }, { desc: 'B', unitPrice: 595, qty: 1 }] },
    { name: 'CO.xlsx', mtime: 200, statedTotal: 1343, rows: [{ desc: 'A', unitPrice: 1000, qty: 1 }, { desc: 'C', unitPrice: 343, qty: 1 }] },
  ];
  const out = selectBidItems(cands, 1343);
  assert.strictEqual(sumOf(out.items), 1343);
  assert.strictEqual(out.statedTotal, 1343);
  assert.ok(out.items.some(i => i.desc === 'C'));
  assert.ok(!out.items.some(i => i.desc === 'B'));
});

test('selectBidItems: partial-CO delta, additive union wins (1200, 2 lines) -> statedTotal null', () => {
  const cands = [
    { name: 'Bid.xlsx', mtime: 100, rows: [{ desc: 'Base', unitPrice: 1000, qty: 1 }] },
    { name: 'CO.xlsx', mtime: 200, statedTotal: 200, rows: [{ desc: 'Extra', unitPrice: 200, qty: 1 }] },
  ];
  const out = selectBidItems(cands, 1200);
  assert.strictEqual(sumOf(out.items), 1200);
  assert.strictEqual(out.items.length, 2);
  assert.strictEqual(out.statedTotal, null);
});

test('selectBidItems: paid absent/0 -> primary (CO alone, 1343) + statedTotal', () => {
  const cands = [
    { name: 'Bid.xlsx', mtime: 100, rows: [{ desc: 'A', unitPrice: 1000, qty: 1 }, { desc: 'B', unitPrice: 595, qty: 1 }] },
    { name: 'CO.xlsx', mtime: 200, statedTotal: 1343, rows: [{ desc: 'A', unitPrice: 1000, qty: 1 }, { desc: 'C', unitPrice: 343, qty: 1 }] },
  ];
  const out = selectBidItems(cands, 0);
  assert.strictEqual(sumOf(out.items), 1343);
  assert.strictEqual(out.statedTotal, 1343);
});

test('selectBidItems: neither total matches -> primary wins (paid 1400 -> 1343)', () => {
  const cands = [
    { name: 'Bid.xlsx', mtime: 100, rows: [{ desc: 'A', unitPrice: 1000, qty: 1 }, { desc: 'B', unitPrice: 595, qty: 1 }] },
    { name: 'CO.xlsx', mtime: 200, rows: [{ desc: 'A', unitPrice: 1000, qty: 1 }, { desc: 'C', unitPrice: 343, qty: 1 }] },
  ];
  assert.strictEqual(sumOf(selectBidItems(cands, 1400).items), 1343);
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

// ---- parseOtherCell (Bug 1: OTHER free-text, drop struck-negative + warranty) ----
const otherSum = (arr) => Math.round(arr.reduce((a, x) => a + x.unitPrice, 0) * 100) / 100;

test('Advantis: warranty line dropped, kept items sum to rollup 317.50', () => {
  const cell = '$85 Service Call\n$150 Clean Condenser Coil\n$124.58 Capacitor replacement - Warranty\n$62.5 Material - 1.25lbs R410A\n$20 Replaced return air filter';
  const out = parseOtherCell(cell);
  assert.strictEqual(out.length, 4);
  assert.strictEqual(otherSum(out), 317.5);
  assert.ok(!out.some(i => /warranty/i.test(i.desc)));
});

test('Dell Meadows: negative struck lines dropped, kept sum to 230.66', () => {
  const cell = '$85 Service Call\n-$800 for no compressor install\n-$300 no R32 charge\n-$124.58 no capacitor replacement\n$125.66 condenser contactor replacement\n$20 filter replacement';
  const out = parseOtherCell(cell);
  assert.strictEqual(out.length, 3);
  assert.strictEqual(otherSum(out), 230.66);
});

test('Nightshade: all-positive lines kept, sum to 1595', () => {
  const cell = '$85 Service Call\n$400 Labor to install new 50 gallon electric water heater\n$700 Material - new 50 gallon electric water heater\n$75 Labor to install new 2gallon expansion tank\n$35 Material - new 2 gallon expansion tank\n$150 Labor to replace kitchen faucet with new chrome gooseneck on granite countertop\n$150 Material - new chrome gooseneck kitchen faucet';
  const out = parseOtherCell(cell);
  assert.strictEqual(out.length, 7);
  assert.strictEqual(otherSum(out), 1595);
});

test('negative "-$800" is dropped, never read as +800', () => {
  assert.strictEqual(parseOtherCell('-$800 for no compressor install').length, 0);
});

test('multiple "$amount desc" on one line both parse', () => {
  const out = parseOtherCell('$20 Labor/$20Material to replace filters');
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].unitPrice, 20);
  assert.strictEqual(out[1].unitPrice, 20);
});

test('blank cell -> []', () => {
  assert.deepStrictEqual(parseOtherCell(''), []);
  assert.deepStrictEqual(parseOtherCell('\n  \n'), []);
});

// ---- extractCount (Fix 6: compressed repeat work, section 9 wording table) ----
test('every section 9 wording shape yields the count and a stripped desc', () => {
  assert.deepStrictEqual(extractCount('(2x) Clean Condenser'), { desc: 'Clean Condenser', count: 2 });
  assert.deepStrictEqual(extractCount('2x Condenser Cleaning'), { desc: 'Condenser Cleaning', count: 2 });
  assert.deepStrictEqual(extractCount('(2) Condenser Cleaning'), { desc: 'Condenser Cleaning', count: 2 });
  assert.deepStrictEqual(extractCount('Condenser Cleaning (2 units)'), { desc: 'Condenser Cleaning', count: 2 });
});

test('trailing unit wordings all read as a count', () => {
  for (const tail of ['(2 unit)', '(2 units)', '(2 ea)', '(2 each)', '(2 pc)', '(2 pcs)', '(2x)']) {
    assert.deepStrictEqual(extractCount('Condenser Cleaning ' + tail), { desc: 'Condenser Cleaning', count: 2 }, tail);
  }
});

test('a BARE leading number is a SIZE, not a count (would divide a line total)', () => {
  for (const d of ['2 Ton Condenser', '3 - 3.5 Ton Package Unit', '50 Gallon Water Heater - Gas', 'R-410A', 'R22']) {
    assert.deepStrictEqual(extractCount(d), { desc: d, count: 1 }, d);
  }
});

test('count capped 1..99 so a year/model number cannot become a count', () => {
  assert.deepStrictEqual(extractCount('(2019) Model Unit'), { desc: '(2019) Model Unit', count: 1 });
  assert.deepStrictEqual(extractCount('410x Something'), { desc: '410x Something', count: 1 });
});

test('empty/absent desc -> count 1', () => {
  assert.deepStrictEqual(extractCount(''), { desc: '', count: 1 });
  assert.deepStrictEqual(extractCount(null), { desc: '', count: 1 });
});

// ---- parseOtherCell quantity (Fix 6: total-preserving split) ----
test('"$300 (2x) Clean Condenser" -> qty 2 @ 150, total preserved', () => {
  const out = parseOtherCell('$300 (2x) Clean Condenser');
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].desc, 'Clean Condenser');
  assert.strictEqual(out[0].qty, 2);
  assert.strictEqual(out[0].unitPrice, 150);
  assert.strictEqual(out[0].qty * out[0].unitPrice, 300);
});

test('indivisible amount: qty stays 1 at the FULL amount, desc still stripped', () => {
  const out = parseOtherCell('$301.55 (2x) Clean Condenser');
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].desc, 'Clean Condenser');
  assert.strictEqual(out[0].qty, 1);
  assert.strictEqual(out[0].unitPrice, 301.55);
});

test('no count marker -> qty 1, desc untouched', () => {
  const out = parseOtherCell('$150 Clean Condenser Coil');
  assert.strictEqual(out[0].qty, 1);
  assert.strictEqual(out[0].desc, 'Clean Condenser Coil');
  assert.strictEqual(out[0].unitPrice, 150);
});

// ---- dedupeLineItems: count-aware + provenance-aware (Fix 6) ----
test('collapse keeps the LARGER qty (restated line must not lose its count)', () => {
  const out = dedupeLineItems([
    { desc: 'Clean Condenser', unitPrice: 150, qty: 1, src: 'table' },
    { desc: 'Clean Condenser Coil', unitPrice: 150, qty: 2, src: 'other' },
  ]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].qty, 2);
  assert.strictEqual(out[0].desc, 'Clean Condenser Coil');
});

test('SAME-section rows do not collapse (two real $150 OTHER lines keep $300)', () => {
  const out = dedupeLineItems([
    { desc: 'Clean Condenser', unitPrice: 150, qty: 1, src: 'other' },
    { desc: 'Clean Condenser', unitPrice: 150, qty: 1, src: 'other' },
  ]);
  assert.strictEqual(out.length, 2);
});

test('cross-section rows still collapse (main table restated in OTHER)', () => {
  const out = dedupeLineItems([
    { desc: 'Clean Condenser', unitPrice: 150, qty: 1, src: 'table' },
    { desc: 'Clean condenser coil', unitPrice: 150, qty: 1, src: 'other' },
  ]);
  assert.strictEqual(out.length, 1);
});

test('a merged row remembers both sections: a 3rd same-section row stays separate', () => {
  const out = dedupeLineItems([
    { desc: 'Clean Condenser', unitPrice: 150, qty: 1, src: 'table' },
    { desc: 'Clean condenser coil', unitPrice: 150, qty: 1, src: 'other' },
    { desc: 'Clean condenser coil', unitPrice: 150, qty: 1, src: 'other' },
  ]);
  assert.strictEqual(out.length, 2);
});

test('untagged legacy rows collapse exactly as before', () => {
  const out = dedupeLineItems([
    { desc: 'Clean Condenser', unitPrice: 150, qty: 1 },
    { desc: 'Clean condenser coil', unitPrice: 150, qty: 1 },
  ]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].desc, 'Clean condenser coil');
  assert.strictEqual(out[0].qty, 1);
});

test('no src emitted on returned rows (provenance is internal plumbing)', () => {
  const out = dedupeLineItems([{ desc: 'Clean Condenser', unitPrice: 150, qty: 1, src: 'table' }]);
  assert.deepStrictEqual(Object.keys(out[0]).sort(), ['desc', 'qty', 'unitPrice']);
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
