'use strict';
// Item 1: upsertRemittanceHistory / removeRemittanceById reducers (persisted remittance
// list). SHIPPED code via the esbuild bridge. Exit 0 pass / 1 fail.
const assert = require('assert');
const { loadEsm } = require('./_load.js');
const { upsertRemittanceHistory, removeRemittanceById } = loadEsm('src/orders-logic.js');

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e.message }); }
}

const snap = (o) => Object.assign({ source: 'msr', fileName: 'r.pdf', invoiceDate: '2026-07-31', id: 'msr-1' }, o);

test('insert prepends newest-first', () => {
  const a = snap({ id: 'msr-1', fileName: 'a.pdf' });
  const b = snap({ id: 'msr-2', fileName: 'b.pdf' });
  const out = upsertRemittanceHistory(upsertRemittanceHistory([], a), b);
  assert.deepStrictEqual(out.map(s => s.id), ['msr-2', 'msr-1']);
});

test('re-insert same source+fileName+invoiceDate replaces (length stable)', () => {
  const first = snap({ id: 'msr-1' });
  const reparse = snap({ id: 'msr-2' });   // same key, different id/timestamp
  const list = upsertRemittanceHistory([], first);
  const out = upsertRemittanceHistory(list, reparse);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].id, 'msr-2');
});

test('different day = separate row', () => {
  const d1 = snap({ id: 'msr-1', invoiceDate: '2026-07-30' });
  const d2 = snap({ id: 'msr-2', invoiceDate: '2026-07-31' });
  const out = upsertRemittanceHistory(upsertRemittanceHistory([], d1), d2);
  assert.strictEqual(out.length, 2);
});

test('remove by id drops the row', () => {
  const list = [snap({ id: 'msr-2' }), snap({ id: 'msr-1' })];
  const out = removeRemittanceById(list, 'msr-1');
  assert.deepStrictEqual(out.map(s => s.id), ['msr-2']);
});

test('remove unknown id is a no-op', () => {
  const list = [snap({ id: 'msr-1' })];
  assert.deepStrictEqual(removeRemittanceById(list, 'nope').map(s => s.id), ['msr-1']);
});

console.log('remittance-history test');
console.log('=======================');
let pass = 0, fail = 0;
for (const r of results) {
  if (r.ok) { pass++; console.log('  OK  ' + r.name); }
  else { fail++; console.log('  XX  ' + r.name + '\n      ' + r.err); }
}
console.log('\nTotal: ' + (pass + fail) + ' | Pass: ' + pass + ' | Fail: ' + fail);
process.exit(fail ? 1 : 0);
