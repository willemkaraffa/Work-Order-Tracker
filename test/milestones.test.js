// deriveMilestones tests. Pure derivation from the SHIPPED src/orders-logic.js
// via the esbuild bridge -- the mapping table is NEVER copied here, so a drift
// between test and app is impossible.
//
// KNOWN LIMITS, stated up front so a green run is not oversold:
//  - Pure data only. Nothing here proves the DayTimeline disclosure renders.
//  - The action strings below are the ones the app writes today; a new history
//    action added elsewhere is silently invisible to this file.
//
// Run:  node test/milestones.test.js
// Exit code: 0 = all green, 1 = at least one fail.

'use strict';

const assert = require('assert');
const { loadEsm } = require('./_load.js');

const { deriveMilestones } = loadEsm('src/orders-logic.js');

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e.message }); }
}

// Deliberately NOT the app's default phase names: a hardcoded stage list in the
// implementation would fail these.
const PHASES = [
  { id: 'p1', name: 'Rolling', statuses: ['On Site', 'Visited'] },
  { id: 'p2', name: 'Booked', statuses: ['Scheduled'] },
  { id: 'p3', name: 'Waiting On Parts', statuses: ['Parts Ordered'] },
];
const wo = (history) => ({ id: '1', history });
const labels = (h, phases) => deriveMilestones(wo(h), phases === undefined ? PHASES : phases).map(m => m.label);

test('noise actions are dropped', () => {
  assert.deepStrictEqual(labels([
    { ts: 1, action: 'created', detail: '' },
    { ts: 2, action: 'captured from portal', detail: '' },
    { ts: 3, action: 'note added', detail: 'x' },
    { ts: 4, action: 'note pinned', detail: 'x' },
    { ts: 5, action: 'edited via modal', detail: '' },
    { ts: 6, action: 'edit tech', detail: 'a → b' },
    { ts: 7, action: 'invoice saved', detail: '' },
    { ts: 8, action: 'client set to AMH', detail: '' },
    { ts: 9, action: 'emergency: set', detail: '' },
    { ts: 10, action: 'updated from import', detail: '' },
  ]), ['Created']);
});

test('bulk-suffixed actions map like their plain forms', () => {
  assert.deepStrictEqual(labels([
    { ts: 1, action: 'created', detail: '' },
    { ts: 2, action: 'status (bulk)', detail: 'New → On Site' },
    { ts: 3, action: 'marked complete (bulk)', detail: '' },
    { ts: 4, action: 'sent to Trash (bulk)', detail: '' },
  ]), ['Created', 'Rolling', 'Complete', 'Cancelled']);
});

test('consecutive same-base rows collapse, keeping the first ts', () => {
  const m = deriveMilestones(wo([
    { ts: 1, action: 'created', detail: '' },
    { ts: 2, action: 'status', detail: 'New → On Site' },
    { ts: 3, action: 'status', detail: 'On Site → Visited' },
  ]), PHASES);
  assert.deepStrictEqual(m.map(x => x.label), ['Created', 'Rolling']);
  assert.strictEqual(m[1].ts, 2);
});

test('a Scheduled-named phase collapses with the scheduled write', () => {
  // Base label strips the ' for ...' suffix, so the status flip and the
  // schedule write are one row -- only when the phase is named 'Scheduled'.
  const sched = [{ id: 's', name: 'Scheduled', statuses: ['Scheduled'] }];
  assert.deepStrictEqual(labels([
    { ts: 1, action: 'created', detail: '' },
    { ts: 2, action: 'status', detail: 'New → Scheduled' },
    { ts: 3, action: 'scheduled', detail: '2026-09-04 09:00' },
  ], sched), ['Created', 'Scheduled']);
});

test('non-consecutive repeats survive', () => {
  assert.deepStrictEqual(labels([
    { ts: 1, action: 'created', detail: '' },
    { ts: 2, action: 'status', detail: 'New → On Site' },
    { ts: 3, action: 'status', detail: 'On Site → Parts Ordered' },
    { ts: 4, action: 'status', detail: 'Parts Ordered → On Site' },
  ]), ['Created', 'Rolling', 'Waiting On Parts', 'Rolling']);
});

test('unscheduled and auto-unscheduled emit nothing', () => {
  assert.deepStrictEqual(labels([
    { ts: 1, action: 'created', detail: '' },
    { ts: 2, action: 'scheduled', detail: '2026-09-04 09:00' },
    { ts: 3, action: 'unscheduled', detail: '' },
    { ts: 4, action: 'auto-unscheduled (expired)', detail: '' },
  ]), ['Created', 'Scheduled for 2026-09-04 09:00']);
});

test('phase names come from the supplied phases table', () => {
  const other = [{ id: 'z', name: 'Zebra Phase', statuses: ['On Site'] }];
  assert.deepStrictEqual(labels([
    { ts: 1, action: 'created', detail: '' },
    { ts: 2, action: 'edit status', detail: 'New → On Site' },
  ], other), ['Created', 'Zebra Phase']);
  // A status no phase claims emits nothing.
  assert.deepStrictEqual(labels([
    { ts: 1, action: 'created', detail: '' },
    { ts: 2, action: 'status', detail: 'New → Unclaimed Status' },
  ], other), ['Created']);
});

test('missing or non-array phases degrades to no phase rows', () => {
  assert.deepStrictEqual(labels([
    { ts: 1, action: 'created', detail: '' },
    { ts: 2, action: 'status', detail: 'New → On Site' },
  ], null), ['Created']);
});

test('a history with no created entry synthesizes Created at the first ts', () => {
  const m = deriveMilestones(wo([
    { ts: 500, action: 'captured from portal', detail: '' },
    { ts: 600, action: 'sent to billing queue', detail: '' },
    { ts: 700, action: 'marked Paid', detail: '' },
  ]), PHASES);
  assert.deepStrictEqual(m.map(x => x.label), ['Created', 'Sent to billing', 'Paid']);
  assert.strictEqual(m[0].ts, 500);
});

test('empty or missing history yields an empty array', () => {
  assert.deepStrictEqual(deriveMilestones(wo([]), PHASES), []);
  assert.deepStrictEqual(deriveMilestones({ id: '1' }, PHASES), []);
  assert.deepStrictEqual(deriveMilestones(null, PHASES), []);
});

test('billing and lifecycle actions map', () => {
  assert.deepStrictEqual(labels([
    { ts: 1, action: 'imported', detail: '' },
    { ts: 2, action: 'sent to Invoiced', detail: '' },
    { ts: 3, action: 'invoice billed from remittance', detail: '' },
    { ts: 4, action: 'sent to Trash', detail: '' },
    { ts: 5, action: 'restored from Trash', detail: '' },
  ]), ['Created', 'Invoiced', 'Paid', 'Cancelled', 'Reopened']);
});

console.log('deriveMilestones');
console.log('================');
let pass = 0, fail = 0;
for (const r of results) {
  if (r.ok) { pass++; console.log('  ok   ' + r.name); }
  else      { fail++; console.log('  FAIL ' + r.name + '\n      ' + r.err); }
}
console.log('');
console.log('Total: ' + (pass + fail) + ' | Pass: ' + pass + ' | Fail: ' + fail);
process.exit(fail > 0 ? 1 : 0);
