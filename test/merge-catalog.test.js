'use strict';
// W3 catalog merge-as-page: mergeCatalogAsPage moves every lib[src] item into
// lib[dest] with item.page = src (pre-paged items nest as `src / page`), then drops
// the src key. Policy guards (builtins / master / missing-dest) reject. Exercises
// the SHIPPED pure transform from src/orders-logic.js via the esbuild bridge.
//   node test/merge-catalog.test.js  (exit 0 pass / 1 fail)
const assert = require('assert');
const { loadEsm } = require('./_load.js');
const { mergeCatalogAsPage } = loadEsm('src/orders-logic.js');

let fails = 0;
function check(label, fn) {
  try { fn(); console.log('  ok   ' + label); }
  catch (e) { fails++; console.log('  FAIL ' + label + ': ' + e.message); }
}

console.log('merge catalog as page (W3)');

check('nests src items under dest as page = src; drops src key', () => {
  const lib = {
    SML: [{ name: 'd1' }],
    HVAC: [{ name: 'h1' }, { name: 'h2' }],
    AMH: [{ name: 'a' }],
  };
  const out = mergeCatalogAsPage(lib, 'HVAC', 'SML');
  assert.strictEqual('HVAC' in out, false);        // src dropped
  assert.deepStrictEqual(Object.keys(out), ['SML', 'AMH']);
  assert.strictEqual(out.SML.length, 3);           // 1 dest + 2 moved
  assert.strictEqual(out.SML[0].name, 'd1');       // dest items stay first
  assert.strictEqual(out.SML[1].name, 'h1');
  assert.strictEqual(out.SML[1].page, 'HVAC');     // stamped page = src
  assert.strictEqual(out.SML[2].page, 'HVAC');
});

check('pre-paged item nests: page becomes `src / existingPage`', () => {
  const lib = { SML: [], HVAC: [{ name: 'h', page: 'Repairs' }] };
  const out = mergeCatalogAsPage(lib, 'HVAC', 'SML');
  assert.strictEqual(out.SML[0].page, 'HVAC / Repairs');
});

check('immutable: input lib + arrays untouched', () => {
  const lib = { SML: [{ name: 'd1' }], HVAC: [{ name: 'h1' }] };
  const out = mergeCatalogAsPage(lib, 'HVAC', 'SML');
  assert.strictEqual('HVAC' in lib, true);
  assert.strictEqual(lib.SML.length, 1);
  assert.strictEqual(lib.HVAC[0].page, undefined); // original not stamped
  assert.notStrictEqual(out.SML, lib.SML);
});

check('null-item entries in src survive the move', () => {
  const lib = { SML: [], HVAC: [null, { name: 'h' }] };
  const out = mergeCatalogAsPage(lib, 'HVAC', 'SML');
  assert.strictEqual(out.SML[0], null);
  assert.strictEqual(out.SML[1].page, 'HVAC');
});

console.log('guards reject (return lib unchanged)');

check('missing dest rejects', () => {
  const lib = { HVAC: [{ name: 'h' }] };
  assert.strictEqual(mergeCatalogAsPage(lib, 'HVAC', 'Nope'), lib);
});

check('missing src rejects', () => {
  const lib = { SML: [] };
  assert.strictEqual(mergeCatalogAsPage(lib, 'Nope', 'SML'), lib);
});

check('src === dest rejects', () => {
  const lib = { SML: [] };
  assert.strictEqual(mergeCatalogAsPage(lib, 'SML', 'SML'), lib);
});

check('src in builtins (pinned) rejects', () => {
  const lib = { SML: [], AMH: [{ name: 'a' }] };
  assert.strictEqual(mergeCatalogAsPage(lib, 'AMH', 'SML', { builtins: ['AMH', 'MSR'] }), lib);
});

check('src === master rejects', () => {
  const lib = { SML: [], HVAC: [{ name: 'h' }] };
  assert.strictEqual(mergeCatalogAsPage(lib, 'HVAC', 'SML', { master: 'HVAC' }), lib);
});

check('non-object guard returns input', () => {
  assert.strictEqual(mergeCatalogAsPage(null, 'a', 'b'), null);
});

console.log('');
console.log(fails ? (fails + ' FAILURES') : 'ALL PASS');
process.exit(fails ? 1 : 0);
