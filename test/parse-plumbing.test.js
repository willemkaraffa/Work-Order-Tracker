'use strict';
// S2: MSR Plumbing seed. plumbingSeedItems() builds the 53 hand-transcribed rows
// (roadmap-handoffs/service-library-categories.md). Asserts on the SHIPPED code in
// library_io.js (a CJS module, required directly -- same as parse-amh.test.js).
// page:'Plumbing', manual:true, desc:''. taxable is DERIVED from the row's split, not
// hardcoded: an MSR price is tax-inclusive and the tax rides on the LABOR portion only
// (roadmap-handoffs/msr-tax-accuracy.md D1), so a row is tax-bearing exactly when it has
// a real labor portion. 7 rows use the 'Included' material sentinel (material bundled
// into labor, NOT 0); the numeric rows satisfy material+labor==price.
// Exit 0 pass / 1 fail / 2 skip (module unavailable).
const assert = require('assert');

let libIO;
try { libIO = require('../library_io.js'); }
catch (e) { console.log('SKIP parse-plumbing: ' + e.message); process.exit(2); }

let fails = 0;
function check(label, fn) {
  try { fn(); console.log('  ok   ' + label); }
  catch (e) { fails++; console.log('  FAIL ' + label + ': ' + e.message); }
}

console.log('plumbingSeedItems');
const items = libIO.plumbingSeedItems();
const SENTINEL = libIO.MATERIAL_INCLUDED;

check('exactly 53 items', () => {
  assert.strictEqual(items.length, 53);
});
check('every item: page=Plumbing, taxable derived from the split, manual=true, desc=""', () => {
  for (const it of items) {
    assert.strictEqual(it.page, 'Plumbing', it.name + ' page');
    // DERIVED, never a constant: labor 'Included' means labor is bundled into material
    // -> no labor portion -> untaxed; otherwise the row is tax-bearing iff labor > 0. A
    // hardcoded expectation is what let the old inverted rule stand (159 of 173 stored
    // MSR items reporting zero tax on a tax-inclusive price).
    const expected = it.labor === SENTINEL ? false : it.labor > 0;
    assert.strictEqual(it.taxable, expected, it.name + ' taxable');
    assert.strictEqual(it.manual, true, it.name + ' manual');
    assert.strictEqual(it.desc, '', it.name + ' desc');
  }
});
check('exactly 7 items use the "Included" material sentinel', () => {
  const inc = items.filter(it => it.material === SENTINEL);
  assert.strictEqual(inc.length, 7);
  assert.strictEqual(SENTINEL, 'Included');
});
check('numeric rows: material + labor === price (cents tolerance)', () => {
  for (const it of items) {
    if (it.material === SENTINEL) continue;
    const sum = Math.round((it.material + it.labor) * 100);
    const price = Math.round(it.price * 100);
    assert.strictEqual(sum, price, it.name + ': ' + it.material + '+' + it.labor + ' != ' + it.price);
  }
});
check('spot-check: 40 Gallon Water Heater: Gas', () => {
  const it = items.find(i => i.name === '40 Gallon Water Heater: Gas');
  assert.ok(it, '40 Gallon Water Heater: Gas missing');
  assert.strictEqual(it.price, 1503.82);
  assert.strictEqual(it.material, 828.82);
  assert.strictEqual(it.labor, 675);
  assert.strictEqual(it.subCategory, 'Water Heater Replacement');
});

console.log('');
console.log(fails ? (fails + ' FAILURES') : 'ALL PASS');
process.exit(fails ? 1 : 0);
