'use strict';
// phone search: phoneMatches. Stored numbers are formatPhone'd ('(919)-555-0148')
// so a typed '9195550148' only matches after both sides are reduced to digits.
// Also guards the contacts[] sweep and the <3-digit noise floor. SHIPPED code via
// the esbuild bridge. Exit: 0 pass / 1 fail.
const assert = require('assert');
const { loadEsm } = require('./_load.js');
const { phoneMatches } = loadEsm('src/orders-logic.js');

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e.message }); }
}

// Primary phone only, stored in display format.
const WO = { id: 'WO-002', phone: '(919)-555-0148' };
// Secondary contact holds the number; primary is a different one.
const MULTI = { id: 'WO-003', phone: '(919)-555-0100',
  contacts: [{ name: 'A', phone: '(919)-555-0100' }, { name: 'B', phone: '9195550199' }] };
// Stored with the US country code.
const ELEVEN = { id: 'WO-004', phone: '1-919-555-0148' };

test('digits-only query matches a formatted stored number', () => {
  assert.strictEqual(phoneMatches(WO, '9195550148'), true);
});

test('formatted query matches (punctuation stripped both sides)', () => {
  assert.strictEqual(phoneMatches(WO, '(919) 555-0148'), true);
});

test('partial suffix matches', () => {
  assert.strictEqual(phoneMatches(WO, '5550148'), true);
  assert.strictEqual(phoneMatches(WO, '0148'), true);
});

test('matches a secondary contact phone', () => {
  assert.strictEqual(phoneMatches(MULTI, '5550199'), true);
});

test('leading US 1 on the stored number is dropped', () => {
  assert.strictEqual(phoneMatches(ELEVEN, '9195550148'), true);
});

// Review finding: stripping the leading 1 from the stored side only made an
// 11-digit QUERY longer than its own haystack, so a pasted '1919...' never matched.
test('leading US 1 on the query is dropped too (both directions)', () => {
  assert.strictEqual(phoneMatches(WO, '19195550148'), true);
  assert.strictEqual(phoneMatches(ELEVEN, '19195550148'), true);
});

// Review finding: ListPane rows come from toDisplayRow, which omitted phone/contacts,
// so the main WO search could never match by phone. This is that row's shape.
test('display row shape (toDisplayRow) matches by phone', () => {
  const ROW = { wo: 'WO-002', woId: '02615338', phone: '(919)-555-0148', contacts: [] };
  assert.strictEqual(phoneMatches(ROW, '5550148'), true);
});

test('non-matching number -> false', () => {
  assert.strictEqual(phoneMatches(WO, '8005551212'), false);
});

test('queries under 3 digits -> false (noise floor)', () => {
  assert.strictEqual(phoneMatches(WO, '1'), false);
  assert.strictEqual(phoneMatches(WO, '91'), false);
});

test('non-numeric query -> false (address/name search unaffected)', () => {
  assert.strictEqual(phoneMatches(WO, 'horseback'), false);
  assert.strictEqual(phoneMatches(WO, ''), false);
});

test('null / undefined / phoneless row safe', () => {
  assert.strictEqual(phoneMatches(null, '9195550148'), false);
  assert.strictEqual(phoneMatches(undefined, '9195550148'), false);
  assert.strictEqual(phoneMatches({}, '9195550148'), false);
});

console.log('phone-search test');
console.log('=================');
let pass = 0, fail = 0;
for (const r of results) {
  if (r.ok) { pass++; console.log('  OK  ' + r.name); }
  else { fail++; console.log('  XX  ' + r.name + '\n      ' + r.err); }
}
console.log('\nTotal: ' + (pass + fail) + ' | Pass: ' + pass + ' | Fail: ' + fail);
process.exit(fail > 0 ? 1 : 0);
