'use strict';
// W6 page edit: renamePage re-keys item.page within ONE catalog (mirror of
// renameSubCategory, scoped); deletePage nulls the page on matching items
// (non-destructive). Exercises the SHIPPED pure transforms from
// src/orders-logic.js via the esbuild bridge.
//   node test/rename-page.test.js  (exit 0 pass / 1 fail)
const assert = require('assert');
const { loadEsm } = require('./_load.js');
const { renamePage, deletePage } = loadEsm('src/orders-logic.js');

let fails = 0;
function check(label, fn) {
  try { fn(); console.log('  ok   ' + label); }
  catch (e) { fails++; console.log('  FAIL ' + label + ': ' + e.message); }
}

console.log('rename page (W6)');

check('rewrites page for matching items in the target catalog only', () => {
  const lib = {
    SML: [{ name: 'a', page: 'Old' }, { name: 'b', page: 'Keep' }],
    AMH: [{ name: 'c', page: 'Old' }],
  };
  const out = renamePage(lib, 'SML', 'Old', 'New');
  assert.strictEqual(out.SML[0].page, 'New');
  assert.strictEqual(out.SML[1].page, 'Keep');
  // other catalog with same page name is untouched (scoped to catalog)
  assert.strictEqual(out.AMH[0].page, 'Old');
  assert.strictEqual(out.AMH, lib.AMH); // untouched arr ref
});

check('non-matching item keeps its object ref', () => {
  const keep = { name: 'b', page: 'Keep' };
  const lib = { SML: [{ name: 'a', page: 'Old' }, keep] };
  const out = renamePage(lib, 'SML', 'Old', 'New');
  assert.strictEqual(out.SML[1], keep);
});

check('MERGE: Old->Keep when both exist collapses pages', () => {
  const lib = { SML: [{ name: 'a', page: 'Old' }, { name: 'b', page: 'Keep' }] };
  const out = renamePage(lib, 'SML', 'Old', 'Keep');
  assert.strictEqual(out.SML[0].page, 'Keep');
  assert.strictEqual(out.SML[1].page, 'Keep');
});

check('does not mutate input; null-item entries survive', () => {
  const lib = { SML: [{ name: 'a', page: 'Old' }, null] };
  const out = renamePage(lib, 'SML', 'Old', 'New');
  assert.strictEqual(lib.SML[0].page, 'Old');
  assert.strictEqual(out.SML[1], null);
});

check('no-op guards (missing args / same name / non-array catalog) return input', () => {
  const lib = { SML: [{ name: 'a', page: 'Old' }], Bad: null };
  assert.strictEqual(renamePage(lib, 'SML', 'Old', 'Old'), lib);
  assert.strictEqual(renamePage(lib, 'SML', '', 'New'), lib);
  assert.strictEqual(renamePage(lib, 'Missing', 'Old', 'New'), lib);
  assert.strictEqual(renamePage(lib, 'Bad', 'Old', 'New'), lib);
  assert.strictEqual(renamePage(null, 'SML', 'Old', 'New'), null);
});

console.log('delete page (non-destructive: null the page)');

check('nulls page on matching items, leaves others', () => {
  const keep = { name: 'b', page: 'Keep' };
  const lib = { SML: [{ name: 'a', page: 'Drop' }, keep, { name: 'c', page: null }] };
  const out = deletePage(lib, 'SML', 'Drop');
  assert.strictEqual(out.SML[0].page, null);
  assert.strictEqual(out.SML[0].name, 'a'); // item survives, only page lost
  assert.strictEqual(out.SML[1], keep);     // untouched ref
});

check('scoped to catalog; other catalog with same page untouched', () => {
  const lib = { SML: [{ name: 'a', page: 'Drop' }], AMH: [{ name: 'x', page: 'Drop' }] };
  const out = deletePage(lib, 'SML', 'Drop');
  assert.strictEqual(out.SML[0].page, null);
  assert.strictEqual(out.AMH[0].page, 'Drop');
  assert.strictEqual(out.AMH, lib.AMH);
});

check('does not mutate input', () => {
  const lib = { SML: [{ name: 'a', page: 'Drop' }] };
  const out = deletePage(lib, 'SML', 'Drop');
  assert.strictEqual(lib.SML[0].page, 'Drop');
  assert.strictEqual(out.SML[0].page, null);
});

check('no-op guards (missing args / non-array catalog) return input', () => {
  const lib = { SML: [{ name: 'a', page: 'Drop' }], Bad: null };
  assert.strictEqual(deletePage(lib, 'SML', ''), lib);
  assert.strictEqual(deletePage(lib, 'Missing', 'Drop'), lib);
  assert.strictEqual(deletePage(lib, 'Bad', 'Drop'), lib);
  assert.strictEqual(deletePage(null, 'SML', 'Drop'), null);
});

console.log('');
console.log(fails ? (fails + ' FAILURES') : 'ALL PASS');
process.exit(fails ? 1 : 0);
