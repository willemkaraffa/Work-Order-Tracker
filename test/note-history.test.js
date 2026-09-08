'use strict';
// S4 ruling 4: which work order gets the o.history line for a note write.
// The three wrappers that carry the ruling (scheduleAddNote / scheduleUpdateNote
// / scheduleDeleteNote, src/app.jsx:5541) are useCallback closures INSIDE App, so
// no test can reach them: admin-s4-flags mounts ScheduleModule with spies, which
// proves the module's call shape and nothing about what App does with it, and
// renderer-smoke only asserts the mount does not throw. The decision itself was
// extracted here so it is reachable. SHIPPED code via the esbuild bridge.
// 0 pass / 1 fail.
const assert = require('assert');
const { loadEsm } = require('./_load.js');
const { noteHistoryWoId } = loadEsm('src/orders-logic.js');

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e.message }); }
}

const LINKED = { id: 'n1', body: 'linked', woId: 'WO-1' };
const LOOSE = { id: 'n2', body: 'a jotting' };

// ── update: the patch is the newer intent ────────────────────────────────────

test('linking a WO writes history to the WO BEING LINKED, not the old one', () => {
  assert.strictEqual(noteHistoryWoId(LINKED, { woId: 'WO-2' }), 'WO-2');
  assert.strictEqual(noteHistoryWoId(LOOSE, { woId: 'WO-2' }), 'WO-2');
});

test('a patch that does not touch woId leaves the note\'s own WO as the target', () => {
  assert.strictEqual(noteHistoryWoId(LINKED, { body: 'edited' }), 'WO-1');
  assert.strictEqual(noteHistoryWoId(LINKED, { flags: { task: { due: '2026-09-09' } } }), 'WO-1');
});

test('UNLINKING records against the WO that is LOSING the note', () => {
  // patch.woId null is the unlink, and null must not win the || chain: the whole
  // point is that the departing WO gets the entry.
  assert.strictEqual(noteHistoryWoId(LINKED, { woId: null }), 'WO-1');
  assert.strictEqual(noteHistoryWoId(LINKED, { woId: '' }), 'WO-1');
});

// ── delete: the same question with no patch ──────────────────────────────────

test('delete passes no patch, so the note\'s own WO is the target', () => {
  assert.strictEqual(noteHistoryWoId(LINKED), 'WO-1');
  assert.strictEqual(noteHistoryWoId(LINKED, undefined), 'WO-1');
});

// ── the S1 rule: a jotting owns no trail ─────────────────────────────────────

test('a note with no woId anywhere writes NO history', () => {
  assert.strictEqual(noteHistoryWoId(LOOSE), null);
  assert.strictEqual(noteHistoryWoId(LOOSE, { body: 'edited' }), null);
  assert.strictEqual(noteHistoryWoId(LOOSE, { woId: null }), null);
});

test('a missing note resolves to nothing rather than throwing', () => {
  // scheduleDeleteNote/scheduleUpdateNote look the note up by id and can miss.
  assert.strictEqual(noteHistoryWoId(null), null);
  assert.strictEqual(noteHistoryWoId(undefined, { body: 'x' }), null);
  assert.strictEqual(noteHistoryWoId(null, { woId: 'WO-3' }), 'WO-3');
});

test('the result is FALSY, never a stray undefined the caller has to re-check', () => {
  // Both wrappers gate on `if (woId)`, so the empty answer has to be falsy and
  // it is null, not undefined, so a reader can tell "resolved to nothing" from
  // "never ran".
  assert.strictEqual(noteHistoryWoId({ id: 'x', woId: '' }), null);
  assert.strictEqual(noteHistoryWoId({ id: 'x', woId: null }, {}), null);
});

let fail = 0;
for (const r of results) {
  if (r.ok) console.log('  PASS ' + r.name);
  else { fail++; console.log('  FAIL ' + r.name + ' :: ' + r.err); }
}
console.log((results.length - fail) + '/' + results.length + ' passed');
process.exit(fail ? 1 : 0);
