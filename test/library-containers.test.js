'use strict';
// S5: persistent EMPTY containers. Pages/sections normally derive from library
// items; these two settings stores (libraryPages {[cat]:string[]} + librarySections
// {[cat]:{[pageKey]:string[]}}) let a page or section with ZERO items persist.
// Exercises the SHIPPED pure store helpers via the esbuild bridge. Every helper
// must return the input UNCHANGED (same ref) on a blank name or no-op, and never
// mutate its input.
//   node test/library-containers.test.js  (exit 0 pass / 1 fail)
const assert = require('assert');
const { loadEsm } = require('./_load.js');
const { addPage, removePage, renamePageInStore, addSection, removeSection, renameSectionInStore } = loadEsm('src/orders-logic.js');

let fails = 0;
function check(label, fn) {
  try { fn(); console.log('  ok   ' + label); }
  catch (e) { fails++; console.log('  FAIL ' + label + ': ' + e.message); }
}

console.log('libraryPages store (addPage / removePage / renamePageInStore)');

check('addPage appends to an existing catalog array, immutably', () => {
  const store = { Custom: ['A'] };
  const out = addPage(store, 'Custom', 'B');
  assert.deepStrictEqual(out.Custom, ['A', 'B']);
  assert.deepStrictEqual(store.Custom, ['A']); // input untouched
  assert.notStrictEqual(out, store);
});

check('addPage seeds a catalog with no prior array', () => {
  assert.deepStrictEqual(addPage({}, 'Custom', 'A'), { Custom: ['A'] });
});

check('addPage trims the name', () => {
  assert.deepStrictEqual(addPage({}, 'Custom', '  A  '), { Custom: ['A'] });
});

check('addPage dedups (existing name => input unchanged ref)', () => {
  const store = { Custom: ['A'] };
  assert.strictEqual(addPage(store, 'Custom', 'A'), store);
});

check('addPage blank/whitespace name => input unchanged ref', () => {
  const store = { Custom: ['A'] };
  assert.strictEqual(addPage(store, 'Custom', '   '), store);
  assert.strictEqual(addPage(store, 'Custom', ''), store);
});

check('addPage null store => input unchanged', () => {
  assert.strictEqual(addPage(null, 'Custom', 'A'), null);
});

check('removePage drops the name, immutably', () => {
  const store = { Custom: ['A', 'B'] };
  const out = removePage(store, 'Custom', 'A');
  assert.deepStrictEqual(out.Custom, ['B']);
  assert.deepStrictEqual(store.Custom, ['A', 'B']);
});

check('removePage absent name / catalog => input unchanged ref', () => {
  const store = { Custom: ['A'] };
  assert.strictEqual(removePage(store, 'Custom', 'Z'), store);
  assert.strictEqual(removePage(store, 'Nope', 'A'), store);
  assert.strictEqual(removePage(store, 'Custom', ''), store);
});

check('renamePageInStore re-keys the name, immutably', () => {
  const store = { Custom: ['A', 'B'] };
  const out = renamePageInStore(store, 'Custom', 'A', 'Z');
  assert.deepStrictEqual(out.Custom, ['Z', 'B']);
  assert.deepStrictEqual(store.Custom, ['A', 'B']);
});

check('renamePageInStore trims new name', () => {
  assert.deepStrictEqual(renamePageInStore({ Custom: ['A'] }, 'Custom', 'A', ' Z '), { Custom: ['Z'] });
});

check('renamePageInStore no-op guards (blank / same / absent) => input unchanged', () => {
  const store = { Custom: ['A'] };
  assert.strictEqual(renamePageInStore(store, 'Custom', 'A', '   '), store);
  assert.strictEqual(renamePageInStore(store, 'Custom', 'A', 'A'), store);
  assert.strictEqual(renamePageInStore(store, 'Custom', 'Z', 'New'), store);
});

console.log('librarySections store (addSection / removeSection / renameSectionInStore)');

check('addSection appends under a page key, immutably', () => {
  const store = { Custom: { P1: ['S1'] } };
  const out = addSection(store, 'Custom', 'P1', 'S2');
  assert.deepStrictEqual(out.Custom.P1, ['S1', 'S2']);
  assert.deepStrictEqual(store.Custom.P1, ['S1']);
  assert.notStrictEqual(out, store);
});

check('addSection seeds an empty catalog + page key', () => {
  assert.deepStrictEqual(addSection({}, 'Custom', 'P1', 'S1'), { Custom: { P1: ['S1'] } });
});

check('addSection uses "" for the no-page view key', () => {
  assert.deepStrictEqual(addSection({}, 'Custom', '', 'S1'), { Custom: { '': ['S1'] } });
  assert.deepStrictEqual(addSection({}, 'Custom', null, 'S1'), { Custom: { '': ['S1'] } });
});

check('addSection trims + dedups (existing => input unchanged ref)', () => {
  const store = { Custom: { P1: ['S1'] } };
  assert.deepStrictEqual(addSection({}, 'C', 'P', '  S  '), { C: { P: ['S'] } });
  assert.strictEqual(addSection(store, 'Custom', 'P1', 'S1'), store);
});

check('addSection blank name / null store => input unchanged', () => {
  const store = { Custom: { P1: ['S1'] } };
  assert.strictEqual(addSection(store, 'Custom', 'P1', '   '), store);
  assert.strictEqual(addSection(null, 'Custom', 'P1', 'S1'), null);
});

check('addSection preserves sibling page keys', () => {
  const store = { Custom: { P1: ['S1'], P2: ['X'] } };
  const out = addSection(store, 'Custom', 'P1', 'S2');
  assert.strictEqual(out.Custom.P2, store.Custom.P2); // untouched sibling ref preserved
});

check('removeSection drops the name, immutably', () => {
  const store = { Custom: { P1: ['S1', 'S2'] } };
  const out = removeSection(store, 'Custom', 'P1', 'S1');
  assert.deepStrictEqual(out.Custom.P1, ['S2']);
  assert.deepStrictEqual(store.Custom.P1, ['S1', 'S2']);
});

check('removeSection absent name / page / catalog => input unchanged ref', () => {
  const store = { Custom: { P1: ['S1'] } };
  assert.strictEqual(removeSection(store, 'Custom', 'P1', 'Z'), store);
  assert.strictEqual(removeSection(store, 'Custom', 'P9', 'S1'), store);
  assert.strictEqual(removeSection(store, 'Nope', 'P1', 'S1'), store);
  assert.strictEqual(removeSection(store, 'Custom', 'P1', ''), store);
});

check('renameSectionInStore re-keys the name, immutably', () => {
  const store = { Custom: { P1: ['S1', 'S2'] } };
  const out = renameSectionInStore(store, 'Custom', 'P1', 'S1', 'Z');
  assert.deepStrictEqual(out.Custom.P1, ['Z', 'S2']);
  assert.deepStrictEqual(store.Custom.P1, ['S1', 'S2']);
});

check('renameSectionInStore operates on the "" no-page key', () => {
  assert.deepStrictEqual(renameSectionInStore({ C: { '': ['A'] } }, 'C', '', 'A', 'B'), { C: { '': ['B'] } });
});

check('renameSectionInStore no-op guards (blank / same / absent) => input unchanged', () => {
  const store = { Custom: { P1: ['S1'] } };
  assert.strictEqual(renameSectionInStore(store, 'Custom', 'P1', 'S1', '   '), store);
  assert.strictEqual(renameSectionInStore(store, 'Custom', 'P1', 'S1', 'S1'), store);
  assert.strictEqual(renameSectionInStore(store, 'Custom', 'P1', 'Z', 'New'), store);
  assert.strictEqual(renameSectionInStore(null, 'Custom', 'P1', 'S1', 'New'), null);
});

console.log('');
console.log(fails ? (fails + ' FAILURES') : 'ALL PASS');
process.exit(fails ? 1 : 0);
