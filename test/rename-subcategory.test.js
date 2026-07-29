'use strict';
// #4 rename-reassign: renaming a section label must cascade subCategory across
// every catalog's items. Exercises the SHIPPED pure transform renameSubCategory
// from src/orders-logic.js via the esbuild bridge.
//   node test/rename-subcategory.test.js  (exit 0 pass / 1 fail)
const assert = require('assert');
const { loadEsm } = require('./_load.js');
const { renameSubCategory } = loadEsm('src/orders-logic.js');

let fails = 0;
function check(label, fn) {
  try { fn(); console.log('  ok   ' + label); }
  catch (e) { fails++; console.log('  FAIL ' + label + ': ' + e.message); }
}

console.log('rename sub-category cascade');

check('rewrites subCategory across multiple catalogs', () => {
  const lib = {
    General: [{ name: 'g', subCategory: 'Old' }],
    AMH: [{ name: 'a', subCategory: 'Old' }, { name: 'a2', subCategory: 'Keep' }],
    MSR: [{ name: 'm', subCategory: 'Old' }],
  };
  const out = renameSubCategory(lib, 'Old', 'New');
  assert.strictEqual(out.General[0].subCategory, 'New');
  assert.strictEqual(out.AMH[0].subCategory, 'New');
  assert.strictEqual(out.MSR[0].subCategory, 'New');
});

check('items not carrying oldName untouched (same object ref)', () => {
  const keep = { name: 'a2', subCategory: 'Keep' };
  const lib = { AMH: [{ name: 'a', subCategory: 'Old' }, keep] };
  const out = renameSubCategory(lib, 'Old', 'New');
  assert.strictEqual(out.AMH[1], keep);
});

check('MERGE: A->B when B exists puts A items under B', () => {
  const lib = {
    General: [
      { name: 'x', subCategory: 'A' },
      { name: 'y', subCategory: 'B' },
    ],
  };
  const out = renameSubCategory(lib, 'A', 'B');
  assert.strictEqual(out.General[0].subCategory, 'B');
  assert.strictEqual(out.General[1].subCategory, 'B');
});

check('non-array / empty catalog values do not throw', () => {
  const lib = { General: [{ name: 'g', subCategory: 'Old' }], _meta: 5, Empty: null };
  const out = renameSubCategory(lib, 'Old', 'New');
  assert.strictEqual(out.General[0].subCategory, 'New');
  assert.strictEqual(out._meta, 5);
  assert.strictEqual(out.Empty, null);
});

check('no-op guards (missing args / same name) return input', () => {
  const lib = { AMH: [{ name: 'a', subCategory: 'Old' }] };
  assert.strictEqual(renameSubCategory(lib, 'Old', 'Old'), lib);
  assert.strictEqual(renameSubCategory(lib, '', 'New'), lib);
  assert.strictEqual(renameSubCategory(null, 'Old', 'New'), null);
});

check('does not mutate input; null-item entries survive', () => {
  const lib = { AMH: [{ name: 'a', subCategory: 'Old' }, null] };
  const out = renameSubCategory(lib, 'Old', 'New');
  assert.strictEqual(lib.AMH[0].subCategory, 'Old');
  assert.strictEqual(out.AMH[1], null);
});

console.log('');
console.log(fails ? (fails + ' FAILURES') : 'ALL PASS');
process.exit(fails ? 1 : 0);
