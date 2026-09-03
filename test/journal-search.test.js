'use strict';
// noteMatchesQuery: the Journal search predicate (Admin S5 slice 2). Pins the two
// halves that go wrong silently -- a note matches on its OWN body, or on the work
// order it is linked to (delegated to orderMatchesQuery, so WO number / address /
// city are exercised for real here). An unlinked note has no WO half at all.
// SHIPPED code via the esbuild bridge. 0 pass / 1 fail.
const assert = require('assert');
const { loadEsm } = require('./_load.js');
const { noteMatchesQuery } = loadEsm('src/orders-logic.js');

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e.message }); }
}

// App field names, so the delegation is the real one.
const WO = { id: '77021', woId: '03475941', address: 'Cedar Ln', city: 'Largo', pm: 'MSR', tech: 'Dan' };
const OTHER = { id: '88033', woId: '11112222', address: 'Alder Ave', city: 'Ocala', pm: 'AMH', tech: 'Ray' };

const linked = { id: 'n1', woId: '77021', body: 'ordered the blower' };
const loose = { id: 'n2', body: 'ordered the blower' };

test('an empty or whitespace-only query matches nothing', () => {
  assert.strictEqual(noteMatchesQuery(linked, WO, ''), false);
  assert.strictEqual(noteMatchesQuery(linked, WO, '   '), false);
  assert.strictEqual(noteMatchesQuery(linked, WO, null), false);
  assert.strictEqual(noteMatchesQuery(linked, WO, undefined), false);
});

test('body text matches, case-insensitively', () => {
  assert.strictEqual(noteMatchesQuery(linked, WO, 'blower'), true);
  assert.strictEqual(noteMatchesQuery(linked, WO, 'BLOWER'), true);
  assert.strictEqual(noteMatchesQuery(loose, null, 'BlOwEr'), true);
});

test('a linked note matches on its WO number', () => {
  assert.strictEqual(noteMatchesQuery(linked, WO, '03475941'), true);
  assert.strictEqual(noteMatchesQuery(linked, WO, '3475'), true);
  assert.strictEqual(noteMatchesQuery(linked, WO, '77021'), true);
});

test('a linked note matches on the WO address or city', () => {
  assert.strictEqual(noteMatchesQuery(linked, WO, 'cedar'), true);
  assert.strictEqual(noteMatchesQuery(linked, WO, 'CEDAR LN'), true);
  assert.strictEqual(noteMatchesQuery(linked, WO, 'largo'), true);
});

test('a linked note whose WO and body both miss returns false', () => {
  assert.strictEqual(noteMatchesQuery(linked, WO, 'alder'), false);
  assert.strictEqual(noteMatchesQuery(linked, OTHER, 'cedar'), false);
  assert.strictEqual(noteMatchesQuery(linked, WO, 'compressor'), false);
});

// J1b: `pinned` became a search KEYWORD when the Pinned rail button retired.
// It is a UNION with the two matches above, which is the whole safety argument.
const pinned = { id: 'n3', pinned: true, body: 'roof hatch key is with Dan' };
const notPinned = { id: 'n4', body: 'left the invoice pinned to the door' };

test('the pinned keyword matches a pinned note', () => {
  assert.strictEqual(noteMatchesQuery(pinned, null, 'pinned'), true);
  assert.strictEqual(noteMatchesQuery(pinned, null, '  PINNED '), true);
});

test('the pinned keyword does NOT match an unpinned note', () => {
  assert.strictEqual(noteMatchesQuery(loose, null, 'pinned'), false);
});

test('the keyword is a UNION: an unpinned note whose BODY says pinned still matches', () => {
  assert.strictEqual(noteMatchesQuery(notPinned, null, 'pinned'), true);
});

test('the keyword is exact: a prefix of it is still plain body matching', () => {
  // 'pin' must NOT act as the keyword, so a pinned note whose body lacks it misses.
  assert.strictEqual(noteMatchesQuery(pinned, null, 'pin'), false);
  assert.strictEqual(noteMatchesQuery(notPinned, null, 'pin'), true);
});

test('the keyword takes nothing away: a pinned note still matches its own WO', () => {
  const pinnedLinked = { id: 'n5', woId: '77021', pinned: true, body: 'ordered the blower' };
  assert.strictEqual(noteMatchesQuery(pinnedLinked, WO, 'cedar'), true);
  assert.strictEqual(noteMatchesQuery(pinnedLinked, WO, 'blower'), true);
  assert.strictEqual(noteMatchesQuery(pinnedLinked, WO, 'alder'), false);
});

test('an unlinked note (no order) never matches a WO term', () => {
  assert.strictEqual(noteMatchesQuery(loose, null, 'cedar'), false);
  assert.strictEqual(noteMatchesQuery(loose, null, '03475941'), false);
  assert.strictEqual(noteMatchesQuery(loose, undefined, 'largo'), false);
});

test('a null note is false, and a null order with a missing body term is false', () => {
  assert.strictEqual(noteMatchesQuery(null, WO, 'cedar'), false);
  assert.strictEqual(noteMatchesQuery(undefined, WO, 'blower'), false);
  assert.strictEqual(noteMatchesQuery({ id: 'n3' }, null, 'blower'), false);
});

let fail = 0;
for (const r of results) {
  if (r.ok) console.log('  PASS ' + r.name);
  else { fail++; console.log('  FAIL ' + r.name + ' :: ' + r.err); }
}
console.log((results.length - fail) + '/' + results.length + ' passed');
process.exit(fail ? 1 : 0);
