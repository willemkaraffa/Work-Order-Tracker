// Slice 4: reminder notification items. Pure logic from the SHIPPED
// src/orders-logic.js via the esbuild bridge -- no hand-copied mirror.
//
// KNOWN LIMIT: this proves the filter + mapping only. Whether the bell renders
// the item, and whether the minute tick re-runs the memo, is app.jsx/renderer
// territory (test/renderer-smoke.test.js) and is NOT asserted here.
//
// Run:  node test/reminder-logic.test.js
// Exit code: 0 = all green, 1 = at least one fail.

'use strict';

const assert = require('assert');
const { loadEsm } = require('./_load.js');

const { getReminderNotificationItems, normalizeNote } = loadEsm('src/orders-logic.js');

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e.message }); }
}

const NOW = Date.UTC(2026, 7, 18, 15, 0, 0); // fixed clock: tests never read Date.now()
const MIN = 60000;

// Build notes through the SHIPPED normalizeNote so the stored shape is real. S1
// folded entries into notes; normalizeNote's legacy branch still consumes these
// {kind, title, remindAt, done, woId} raws, so every assertion below is unchanged.
const mk = (raw, id) => normalizeNote(raw, id, NOW);

test('due: a reminder whose remindAt has passed becomes one item', () => {
  const out = getReminderNotificationItems([mk({ kind: 'reminder', title: 'Call vendor', remindAt: NOW - MIN }, 'e1')], {}, NOW);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].id, 'reminder-e1');
  assert.strictEqual(out[0].kind, 'reminder');
  assert.ok(out[0].title.indexOf('Call vendor') !== -1, out[0].title);
  assert.ok(out[0].sub, 'sub should carry the fire time');
});

test('due: remindAt exactly now still fires (at-or-before)', () => {
  const out = getReminderNotificationItems([mk({ kind: 'reminder', title: 'Now', remindAt: NOW }, 'e1')], {}, NOW);
  assert.strictEqual(out.length, 1);
});

test('not yet due: a future remindAt is silent', () => {
  const out = getReminderNotificationItems([mk({ kind: 'reminder', title: 'Later', remindAt: NOW + MIN }, 'e1')], {}, NOW);
  assert.strictEqual(out.length, 0);
});

test('missing remindAt: a plain task/event never fires', () => {
  const out = getReminderNotificationItems([
    mk({ kind: 'task', title: 'No remind' }, 'e1'),
    mk({ kind: 'event', title: 'Meeting', date: '2026-08-18' }, 'e2'),
  ], {}, NOW);
  assert.strictEqual(out.length, 0);
});

test('done: a completed task with a past remindAt is silent', () => {
  const out = getReminderNotificationItems([mk({ kind: 'task', title: 'Done thing', remindAt: NOW - MIN, done: true }, 'e1')], {}, NOW);
  assert.strictEqual(out.length, 0);
});

test('open task with a past remindAt DOES fire (reminders are not kind-gated)', () => {
  const out = getReminderNotificationItems([mk({ kind: 'task', title: 'Open thing', remindAt: NOW - MIN }, 'e1')], {}, NOW);
  assert.strictEqual(out.length, 1);
});

test('dismissed: a dismissal keyed to that fire time suppresses it', () => {
  const e = mk({ kind: 'reminder', title: 'Call vendor', remindAt: NOW - MIN }, 'e1');
  const dismissed = { 'reminder-e1': String(NOW - MIN) };
  assert.strictEqual(getReminderNotificationItems([e], dismissed, NOW).length, 0);
});

test('dismissed: moving remindAt re-arms the reminder', () => {
  const e = mk({ kind: 'reminder', title: 'Call vendor', remindAt: NOW - MIN }, 'e1');
  const dismissed = { 'reminder-e1': String(NOW - 999 * MIN) }; // dismissed for an OLD fire time
  assert.strictEqual(getReminderNotificationItems([e], dismissed, NOW).length, 1);
});

test('dismissed: an overdue dismissal cannot silence a reminder (namespaced ids)', () => {
  const e = mk({ kind: 'reminder', title: 'Call vendor', remindAt: NOW - MIN }, 'e1');
  assert.strictEqual(getReminderNotificationItems([e], { 'overdue-e1': String(NOW - MIN) }, NOW).length, 1);
});

test('woId: an entry tied to a WO carries `wo` so the bell can route to it', () => {
  const out = getReminderNotificationItems([mk({ kind: 'reminder', title: 'Call vendor', remindAt: NOW - MIN, woId: '03475941' }, 'e1')], {}, NOW);
  assert.strictEqual(out[0].wo, '03475941');
  assert.ok(out[0].sub.indexOf('03475941') !== -1, out[0].sub);
});

test('no woId: `wo` is absent, so onNotifClick falls through to the Schedule module', () => {
  const out = getReminderNotificationItems([mk({ kind: 'reminder', title: 'Call vendor', remindAt: NOW - MIN }, 'e1')], {}, NOW);
  assert.ok(!out[0].wo, JSON.stringify(out[0]));
});

test('schedDate carries the fire time (the dismissal re-arm key)', () => {
  const out = getReminderNotificationItems([mk({ kind: 'reminder', title: 'Call vendor', remindAt: NOW - MIN }, 'e1')], {}, NOW);
  assert.strictEqual(out[0].schedDate, String(NOW - MIN));
});

test('junk in: null / empty / idless entries do not throw', () => {
  assert.strictEqual(getReminderNotificationItems(null, null, NOW).length, 0);
  assert.strictEqual(getReminderNotificationItems([null, {}, { remindAt: NOW - MIN }], {}, NOW).length, 0);
});

// ─── Report ──────────────────────────────────────────────────────────────────

console.log('reminder notification items');
console.log('===========================');
let pass = 0, fail = 0;
for (const r of results) {
  if (r.ok) { pass++; console.log('  ok   ' + r.name); }
  else      { fail++; console.log('  FAIL ' + r.name + '\n      ' + r.err); }
}
console.log('');
console.log('Total: ' + (pass + fail) + ' | Pass: ' + pass + ' | Fail: ' + fail);
process.exit(fail > 0 ? 1 : 0);
