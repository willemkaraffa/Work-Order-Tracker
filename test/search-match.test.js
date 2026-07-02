'use strict';
// search-ux Part 1: orderNumberMatches. WO search must match the REAL portal
// number in `woId`, not just the minted `id` (MSR WO-002 -> woId 02615338).
// Regression guard for "search returns nothing on a pasted number". SHIPPED code
// via the esbuild bridge. Exit: 0 pass / 1 fail.
const assert = require('assert');
const { loadEsm } = require('./_load.js');
const { orderNumberMatches } = loadEsm('src/orders-logic.js');

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e.message }); }
}

// Real sent MSR WO: minted id, real number in woId.
const MSR = { id: 'WO-002', woId: '02615338' };
// AMH WO: numeric id, no woId.
const AMH = { id: '9688774' };
// Display-row shape (toDisplayRow) uses `wo` instead of `id`.
const ROW = { wo: 'WO-002', woId: '02615338' };

test('matches the real portal number in woId', () => {
  assert.strictEqual(orderNumberMatches(MSR, '02615338'), true);
});

test('matches a partial of the portal number (leading zero dropped)', () => {
  assert.strictEqual(orderNumberMatches(MSR, '2615338'), true);
});

test('still matches the minted id', () => {
  assert.strictEqual(orderNumberMatches(MSR, 'wo-002'), true);
});

test('case-insensitive + whitespace-trimmed', () => {
  assert.strictEqual(orderNumberMatches(MSR, '  02615338  '), true);
});

test('display-row shape (wo + woId) matches by woId', () => {
  assert.strictEqual(orderNumberMatches(ROW, '02615338'), true);
});

test('AMH numeric id (no woId) still matches by id', () => {
  assert.strictEqual(orderNumberMatches(AMH, '9688774'), true);
  assert.strictEqual(orderNumberMatches(AMH, '96887'), true);
});

test('non-matching query returns false', () => {
  assert.strictEqual(orderNumberMatches(MSR, '99999999'), false);
});

test('empty query returns true (no filter)', () => {
  assert.strictEqual(orderNumberMatches(MSR, ''), true);
  assert.strictEqual(orderNumberMatches(MSR, '   '), true);
});

test('null / undefined row safe', () => {
  assert.strictEqual(orderNumberMatches(null, '1'), false);
  assert.strictEqual(orderNumberMatches(undefined, '1'), false);
  assert.strictEqual(orderNumberMatches({}, '1'), false);
});

console.log('search-match test');
console.log('=================');
let pass = 0, fail = 0;
for (const r of results) {
  if (r.ok) { pass++; console.log('  OK  ' + r.name); }
  else { fail++; console.log('  XX  ' + r.name + '\n      ' + r.err); }
}
console.log('\nTotal: ' + (pass + fail) + ' | Pass: ' + pass + ' | Fail: ' + fail);
process.exit(fail > 0 ? 1 : 0);
