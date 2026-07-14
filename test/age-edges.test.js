'use strict';
// Edge-input coverage for the age helpers: null/undefined/invalid-date must
// never throw (they feed straight off order records that can be sparse or
// hand-edited). SHIPPED code via the esbuild bridge. Exit 0 pass / 1 fail.
const assert = require('assert');
const { loadEsm } = require('./_load.js');
const { daysSince, ageDaysFor, ageLevelForDays } = loadEsm('src/orders-logic.js');

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e.message }); }
}

test('daysSince: null/undefined/invalid string do not throw', () => {
  assert.strictEqual(daysSince(null), 0);
  assert.strictEqual(daysSince(undefined), 0);
  assert.strictEqual(daysSince('not-a-date'), 0);
});

test('ageLevelForDays: null/undefined do not throw', () => {
  assert.strictEqual(ageLevelForDays(null), 0);
  assert.strictEqual(ageLevelForDays(undefined), 0);
});

test('ageDaysFor: missing dateCreated / bad tab shape does not throw', () => {
  assert.strictEqual(ageDaysFor({}), 0);
  assert.strictEqual(ageDaysFor({ tab: 'active', dateCreated: null }), 0);
  assert.strictEqual(ageDaysFor({ tab: 'active', dateCreated: 'not-a-date' }), 0);
});

test('ageDaysFor: complete tab with no history/dateCreated does not throw', () => {
  assert.strictEqual(ageDaysFor({ tab: 'complete' }), 0);
  assert.strictEqual(ageDaysFor({ tab: 'complete', history: [], dateCreated: 'not-a-date' }), 0);
});

test('ageDaysFor: sent tab returns null (no age) without throwing', () => {
  assert.strictEqual(ageDaysFor({ tab: 'sent' }), null);
});

// Null order must yield null, NOT 0. Asserted strictly: `assert.ok(!x)` would pass
// for both and could not tell a regression from correct behavior.
// This is the real bug this file was written for: ageDaysFor(null) threw
// "Cannot read properties of null (reading 'tab')".
test('ageDaysFor: null/undefined order returns null (not 0)', () => {
  assert.strictEqual(ageDaysFor(null), null);
  assert.strictEqual(ageDaysFor(undefined), null);
});

// No tab='paid' test here on purpose. migrateOrders rewrites the deprecated
// tab='paid' to 'sent', so a paid record never reaches ageDaysFor. Asserting on a
// hand-built {tab:'paid'} object would be a passing test of an unreachable state --
// false green. The migration is what guarantees the behavior; change11.test.js owns it.

// ageLevelForDays always returns a number 0-3, never null. Downstream tinting does
// arithmetic on it, so a null here would break the WO list.
test('ageLevelForDays: always returns a number, never null', () => {
  assert.strictEqual(ageLevelForDays(null), 0);
  assert.strictEqual(ageLevelForDays(undefined), 0);
  assert.strictEqual(ageLevelForDays(0), 0);
  assert.strictEqual(ageLevelForDays(40), 3);
});

console.log('age-edges test');
console.log('==============');
let pass = 0, fail = 0;
for (const r of results) {
  if (r.ok) { pass++; console.log('  OK  ' + r.name); }
  else { fail++; console.log('  XX  ' + r.name + '\n      ' + r.err); }
}
console.log('\nTotal: ' + (pass + fail) + ' | Pass: ' + pass + ' | Fail: ' + fail);
process.exit(fail ? 1 : 0);
