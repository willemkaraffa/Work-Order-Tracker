'use strict';
// S1a: Service Library model migration. Exercises the SHIPPED pure transform
// migrateLibraryModel from src/orders-logic.js via the esbuild bridge.
//   node test/migrate-library.test.js  (exit 0 pass / 1 fail)
const assert = require('assert');
const { loadEsm } = require('./_load.js');
const { migrateLibraryModel, LIB_MODEL_VERSION } = loadEsm('src/orders-logic.js');

let fails = 0;
function check(label, fn) {
  try { fn(); console.log('  ok   ' + label); }
  catch (e) { fails++; console.log('  FAIL ' + label + ': ' + e.message); }
}

console.log('migrate library model');

assert.strictEqual(LIB_MODEL_VERSION, 1, 'LIB_MODEL_VERSION should be 1');

const lib = {
  General: [{ name: 'g', price: 10, taxable: false, subCategory: 'Water Heaters' }],
  AMH: [
    { name: 'a', price: 5, taxable: false, desc: 'Plum Minor' },
    { name: 'sc', price: 75, taxable: true, desc: 'HVAC' },
  ],
  MSR: [{ name: 'm', price: 100, taxable: true }],
};
const before = JSON.parse(JSON.stringify(lib));
const { lib: out, flipped } = migrateLibraryModel(lib);

check('AMH desc -> page, desc cleared', () => {
  assert.strictEqual(out.AMH[0].page, 'Plum Minor');
  assert.strictEqual(out.AMH[0].desc, '');
  assert.strictEqual(out.AMH[1].page, 'HVAC');
});
check('MSR stamped page=HVAC', () => {
  assert.strictEqual(out.MSR[0].page, 'HVAC');
});
check('General untouched (no page added)', () => {
  assert.deepStrictEqual(out.General[0], before.General[0]);
  assert.strictEqual('page' in out.General[0], false);
});
check('exact flipped count = 3', () => {
  assert.strictEqual(flipped, 3);
});
check('tax + name + price never mutated', () => {
  assert.strictEqual(out.AMH[0].taxable, false);
  assert.strictEqual(out.AMH[0].name, 'a');
  assert.strictEqual(out.AMH[0].price, 5);
  assert.strictEqual(out.AMH[1].taxable, true);
  assert.strictEqual(out.MSR[0].taxable, true);
  assert.strictEqual(out.MSR[0].price, 100);
});
check('L1 keys unchanged', () => {
  assert.deepStrictEqual(Object.keys(out).sort(), ['AMH', 'General', 'MSR']);
});
check('idempotent: second run flips 0', () => {
  const again = migrateLibraryModel(out);
  assert.strictEqual(again.flipped, 0);
  assert.strictEqual(again.lib.AMH[0].page, 'Plum Minor');
  assert.strictEqual(again.lib.MSR[0].page, 'HVAC');
});
check('input object not deeply reused for flipped rows', () => {
  // migrated AMH row is a new object (spread), original desc still present in `before`
  assert.strictEqual(before.AMH[0].desc, 'Plum Minor');
});

console.log('');
console.log(fails ? (fails + ' FAILURES') : 'ALL PASS');
process.exit(fails ? 1 : 0);
