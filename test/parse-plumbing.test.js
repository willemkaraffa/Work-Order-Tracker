'use strict';
// S2: MSR Plumbing seed. plumbingSeedItems() builds the 53 hand-transcribed rows
// (roadmap-handoffs/service-library-categories.md). Asserts on the SHIPPED code in
// library_io.js (a CJS module, required directly -- same as parse-amh.test.js).
// page:'Plumbing', taxable:false, manual:true, desc:''. 7 rows use the 'Included'
// material sentinel; the numeric rows satisfy material+labor==price.
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
check('every item: page=Plumbing, taxable=false, manual=true, desc=""', () => {
  for (const it of items) {
    assert.strictEqual(it.page, 'Plumbing', it.name + ' page');
    assert.strictEqual(it.taxable, false, it.name + ' taxable');
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
