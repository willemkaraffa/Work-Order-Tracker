'use strict';
// search-ux Part 4: findOtherViewMatches / locationOfOrder / orderMatchesQuery.
// A search surfaces WOs that live in a different tab/module. SHIPPED code via the
// esbuild bridge. Exit: 0 pass / 1 fail.
const assert = require('assert');
const { loadEsm } = require('./_load.js');
const { findOtherViewMatches, locationOfOrder, orderMatchesQuery, TAB_LABELS } = loadEsm('src/orders-logic.js');

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e.message }); }
}

const ORDERS = [
  { id: '9767507', pm: 'AMH', address: '6620 Horseback Lane', city: 'Raleigh', tab: 'active' },
  { id: 'WO-002', woId: '02615338', pm: 'MSR', address: '21 ASH ST', tab: 'sent' },
  { id: 'C-1', pm: 'AMH', address: '1 Done Way', tab: 'complete' },
  { id: 'T-1', pm: 'AMH', address: '9 Gone Rd', tab: 'active', deleted: true },
];

test('locationOfOrder maps tabs; deleted -> trash', () => {
  assert.strictEqual(locationOfOrder({ tab: 'active' }), 'active');
  assert.strictEqual(locationOfOrder({ tab: 'sent' }), 'sent');
  assert.strictEqual(locationOfOrder({ tab: 'active', deleted: true }), 'trash');
  assert.strictEqual(locationOfOrder({ tab: 'trash' }), 'trash');
  assert.strictEqual(locationOfOrder({}), 'active');
});

test('orderMatchesQuery: number, address, and woId; empty -> false', () => {
  assert.strictEqual(orderMatchesQuery(ORDERS[0], '9767507'), true);
  assert.strictEqual(orderMatchesQuery(ORDERS[0], 'horseback'), true);
  assert.strictEqual(orderMatchesQuery(ORDERS[1], '02615338'), true);
  assert.strictEqual(orderMatchesQuery(ORDERS[0], ''), false);
  assert.strictEqual(orderMatchesQuery(ORDERS[0], 'nomatch'), false);
});

test('Invoices view (shows sent): active WO 9767507 surfaces as off-view', () => {
  const m = findOtherViewMatches(ORDERS, '9767507', ['sent']);
  assert.strictEqual(m.length, 1);
  assert.strictEqual(m[0].id, '9767507');
  assert.strictEqual(m[0].tab, 'active');
});

test('WO active view: a sent WO surfaces by its real number', () => {
  const m = findOtherViewMatches(ORDERS, '02615338', ['active']);
  assert.strictEqual(m.length, 1);
  assert.strictEqual(m[0].id, 'WO-002');
  assert.strictEqual(m[0].tab, 'sent');
});

test('does NOT surface WOs already in the shown location', () => {
  const m = findOtherViewMatches(ORDERS, 'horseback', ['active']);
  assert.strictEqual(m.length, 0); // 9767507 is active = shown
});

test('trashed WO surfaces with trash location', () => {
  const m = findOtherViewMatches(ORDERS, 'gone', ['active']);
  assert.strictEqual(m.length, 1);
  assert.strictEqual(m[0].tab, 'trash');
});

test('empty query -> [] (no off-view list without a query)', () => {
  assert.deepStrictEqual(findOtherViewMatches(ORDERS, '', ['sent']), []);
  assert.deepStrictEqual(findOtherViewMatches(ORDERS, '   ', ['sent']), []);
});

test('null orders safe', () => {
  assert.deepStrictEqual(findOtherViewMatches(null, 'x', ['sent']), []);
});

test('TAB_LABELS cover all locations', () => {
  for (const k of ['active', 'complete', 'sent', 'trash']) assert.ok(TAB_LABELS[k]);
});

console.log('cross-tab-search test');
console.log('=====================');
let pass = 0, fail = 0;
for (const r of results) {
  if (r.ok) { pass++; console.log('  OK  ' + r.name); }
  else { fail++; console.log('  XX  ' + r.name + '\n      ' + r.err); }
}
console.log('\nTotal: ' + (pass + fail) + ' | Pass: ' + pass + ' | Fail: ' + fail);
process.exit(fail > 0 ? 1 : 0);
