// Admin S1 — "one note record". Proves the collapse of o.noteCards and
// wo_data.entries into ONE flat notes array: migration idempotence (by COUNT,
// not by a flag), the entry-kind -> flags mapping, that no note or entry text is
// lost, that a migrated reminder still yields a header-bell item, and the
// pinned-first / ts-desc order the detail pane renders.
//
// KNOWN LIMITS, stated up front:
//  - PURE logic only. No jsdom, no React, no storage: this proves the
//    transforms, not that the hook persists them (test/entries-store.test.js
//    drives the real store) and not anything about appearance.
//  - Deliberately opens NO JSDOM. The pretendToBeVisual + process.exit() combo
//    aborts intermittently on Windows (UV_HANDLE_CLOSING); this file sets
//    process.exitCode and arms an unref'd watchdog instead.
//
// Run:  node test/admin-s1-migration.test.js
// Exit code: 0 = all green, 1 = at least one fail.

'use strict';

const assert = require('assert');
const { loadEsm } = require('./_load.js');

const {
  normalizeNote, noteTitle, noteToEntryForm,
  migrateNoteCardsToNotes, migrateEntriesToNotes,
  notesForOrder, lastNoteTsFor, groupNotesByDate, backlogNotes,
  getReminderNotificationItems,
} = loadEsm('src/orders-logic.js');

// Nothing here awaits, but a hung esbuild/require would otherwise hang the
// runner forever; this floor makes that a FAIL instead. unref'd so a green run
// exits immediately.
const watchdog = setTimeout(() => {
  console.error('WATCHDOG: admin-s1-migration did not finish in 20s');
  process.exit(1);
}, 20000);
watchdog.unref();

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) {
    results.push({ name, ok: false, err: e.message + (e.stack ? '\n' + e.stack.split('\n').slice(1, 3).join('\n') : '') });
  }
}

// A representative pre-S1 blob: two WOs with note cards (one pinned, one
// id-less) and three schedule entries, one per kind.
function fixture() {
  return {
    orders: [
      {
        id: 'WO-1', pm: 'MSR', tab: 'active', notes: 'More Information text',
        noteCards: [
          { id: 'n1', ts: 1000, type: 'Note', body: 'first note', pinned: false, edited: false },
          { id: 'n2', ts: 3000, type: 'Customer call', body: 'called the tenant', pinned: true, edited: false },
          { ts: 2000, type: 'Note', body: 'card with no id' },
        ],
      },
      {
        id: 'WO-2', pm: 'AMH', tab: 'trash',
        noteCards: [{ id: 'n9', ts: 500, type: 'Note', body: 'trashed WO note' }],
      },
    ],
    entries: [
      { id: 'e-task', kind: 'task', title: 'Order parts', body: 'from the supply house',
        date: '2026-08-20', done: false, tech: 'Bob', woId: 'WO-1', created: 100, updated: 150 },
      { id: 'e-event', kind: 'event', title: 'Team meeting', body: '',
        date: '2026-08-21', start: '9:00', end: '10:30', tech: null, woId: null, created: 200, updated: 200 },
      { id: 'e-rem', kind: 'reminder', title: 'Call the PM', body: '',
        date: '2026-08-22', remindAt: 5000, tech: null, woId: 'WO-2', created: 300, updated: 300 },
      { id: 'e-back', kind: 'task', title: 'Call vendor', date: null, done: true, created: 400, updated: 400 },
    ],
  };
}

// Run both migrations the way src/data.js runs them on load.
function migrateAll(blob, notes) {
  const moved = migrateNoteCardsToNotes(blob.orders, notes || []);
  return { orders: moved.orders, notes: migrateEntriesToNotes(blob.entries, moved.notes) };
}

// ─── Migration: shape, idempotence, no loss ──────────────────────────────────

test('migration: every note card and entry lands in ONE flat array', () => {
  const out = migrateAll(fixture());
  assert.strictEqual(out.notes.length, 8, 'expected 4 cards + 4 entries');
});

test('migration: noteCards is removed from the order, o.notes (More Info) survives', () => {
  const out = migrateAll(fixture());
  assert.strictEqual('noteCards' in out.orders[0], false);
  assert.strictEqual(out.orders[0].notes, 'More Information text');
});

test('migration: a WO note carries woId + pm, an Admin note has woId null', () => {
  const out = migrateAll(fixture());
  const card = out.notes.find(n => n.id === 'n1');
  assert.strictEqual(card.woId, 'WO-1');
  assert.strictEqual(card.pm, 'MSR');
  assert.strictEqual(out.notes.find(n => n.id === 'e-event').woId, null);
});

test('migration: an id-less card still migrates, with a stable id', () => {
  const out = migrateAll(fixture());
  const orphan = out.notes.find(n => n.body === 'card with no id');
  assert.ok(orphan, 'id-less card was dropped');
  assert.ok(orphan.id, 'expected a minted id');
});

test('migration IS IDEMPOTENT: a second pass does not duplicate (count, not flag)', () => {
  const first = migrateAll(fixture());
  // Second pass over the ALREADY migrated store: orders no longer carry cards,
  // entries are gone, and the notes array is fed back in.
  const second = migrateAll({ orders: first.orders, entries: [] }, first.notes);
  assert.strictEqual(second.notes.length, first.notes.length);
  // And a pass that re-sees the ORIGINAL sources must still not double up.
  const replay = migrateAll(fixture(), first.notes);
  assert.strictEqual(replay.notes.length, first.notes.length);
  const ids = replay.notes.map(n => n.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'duplicate ids: ' + ids.join(','));
});

test('migration: no note or entry TEXT is lost (title folds into body)', () => {
  const out = migrateAll(fixture());
  const bodies = out.notes.map(n => n.body);
  for (const t of ['first note', 'called the tenant', 'card with no id', 'trashed WO note',
                   'Order parts', 'Team meeting', 'Call the PM', 'Call vendor']) {
    assert.ok(bodies.some(b => b.indexOf(t) !== -1), 'lost: ' + t);
  }
  const task = out.notes.find(n => n.id === 'e-task');
  assert.strictEqual(task.body, 'Order parts\nfrom the supply house');
  assert.strictEqual(noteTitle(task), 'Order parts');
});

test('migration: ts is written-at (created carries), updated is preserved', () => {
  const out = migrateAll(fixture());
  const task = out.notes.find(n => n.id === 'e-task');
  assert.strictEqual(task.ts, 100);
  assert.strictEqual(task.updated, 150);
  assert.strictEqual(out.notes.find(n => n.id === 'n2').ts, 3000);
});

// ─── kind -> flags ───────────────────────────────────────────────────────────

test('kind -> flags: task becomes flags.task {done, due}', () => {
  const n = migrateAll(fixture()).notes.find(x => x.id === 'e-task');
  assert.deepStrictEqual(n.flags.task, { done: false, due: '2026-08-20' });
  assert.strictEqual(n.flags.reminder, undefined);
  assert.strictEqual(n.tech, 'Bob');
});

test('kind -> flags: event becomes flags.calendar {date, start, end}, times padded', () => {
  const n = migrateAll(fixture()).notes.find(x => x.id === 'e-event');
  assert.deepStrictEqual(n.flags.calendar, { date: '2026-08-21', start: '09:00', end: '10:30' });
  assert.strictEqual(n.flags.task, undefined);
});

test('kind -> flags: reminder becomes flags.reminder {at} AND keeps its day', () => {
  const n = migrateAll(fixture()).notes.find(x => x.id === 'e-rem');
  assert.deepStrictEqual(n.flags.reminder, { at: 5000 });
  assert.strictEqual(n.flags.calendar.date, '2026-08-22');
});

test('kind -> flags: a WO note card gets NO flags (it is journal, not calendar)', () => {
  const n = migrateAll(fixture()).notes.find(x => x.id === 'n1');
  assert.deepStrictEqual(n.flags, {});
  assert.strictEqual(n.type, 'Note');
});

test('flags are independent: a task can carry a reminder too', () => {
  const n = normalizeNote({ kind: 'task', title: 'x', date: '2026-08-20', remindAt: 7 }, 'a', 1);
  assert.deepStrictEqual(n.flags.task, { done: false, due: '2026-08-20' });
  assert.deepStrictEqual(n.flags.reminder, { at: 7 });
});

test('normalizeNote: the entry form round-trips through the note without drift', () => {
  const first = normalizeNote({ kind: 'reminder', title: 'Call the PM', body: 'ask about access',
    date: '2026-08-22', remindAt: 5000, woId: 'WO-2' }, 'e-rem', 1);
  const form = noteToEntryForm(first);
  assert.strictEqual(form.kind, 'reminder');
  assert.strictEqual(form.title, 'Call the PM');
  assert.strictEqual(form.body, 'ask about access');
  const second = normalizeNote({ ...first, ...form }, 'e-rem', 2);
  assert.deepStrictEqual(second.flags, first.flags);
  assert.strictEqual(second.body, first.body);
});

test('normalizeNote: an edit moves `updated` but NEVER `ts` (journal position)', () => {
  const first = normalizeNote({ body: 'note' }, 'a', 1000);
  const edited = normalizeNote({ ...first, body: 'note, revised', edited: true }, 'a', 9000);
  assert.strictEqual(edited.ts, 1000);
  assert.strictEqual(edited.updated, 9000);
});

test('normalizeNote: a set flag never carries undefined, and an event is never undated', () => {
  const n = normalizeNote({ kind: 'event', title: 'x', date: 'not-a-date' }, 'a', 1);
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(n.flags.calendar.date));
  assert.strictEqual(n.flags.calendar.start, null);
  assert.strictEqual(JSON.parse(JSON.stringify(n)).flags.calendar.end, null);
});

test('normalizeNote: a non-schedule flag survives a Schedule form save', () => {
  const stored = normalizeNote({ body: 'part on order', flags: { parts: { part: 'blower motor' }, journal: true } }, 'a', 1);
  const resaved = normalizeNote({ ...stored, ...noteToEntryForm(stored), kind: 'task', date: '2026-08-20' }, 'a', 2);
  assert.strictEqual(resaved.flags.parts.part, 'blower motor');
  assert.strictEqual(resaved.flags.journal, true);
  assert.strictEqual(resaved.flags.task.due, '2026-08-20');
});

// ─── Reminders still fire ────────────────────────────────────────────────────

test('bell: a MIGRATED reminder still yields a notification item', () => {
  const items = getReminderNotificationItems(migrateAll(fixture()).notes, {}, 6000);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].id, 'reminder-e-rem');
  assert.strictEqual(items[0].kind, 'reminder');
  assert.strictEqual(items[0].title, 'Reminder · Call the PM');
  assert.strictEqual(items[0].wo, 'WO-2');
  assert.strictEqual(items[0].schedDate, '5000');
});

test('bell: a reminder that has not arrived yet does not fire', () => {
  assert.strictEqual(getReminderNotificationItems(migrateAll(fixture()).notes, {}, 4999).length, 0);
});

test('bell: the persisted "reminder-"+id dismissal still suppresses it', () => {
  const notes = migrateAll(fixture()).notes;
  assert.strictEqual(getReminderNotificationItems(notes, { 'reminder-e-rem': '5000' }, 6000).length, 0);
});

test('bell: a done task never nags', () => {
  const n = normalizeNote({ kind: 'task', title: 'x', done: true, remindAt: 1 }, 'a', 1);
  assert.strictEqual(getReminderNotificationItems([n], {}, 9000).length, 0);
});

// ─── Readers: detail order, calendar, backlog ────────────────────────────────

// One record means one list: a WO's notes are EVERY note carrying its woId, so
// a schedule task linked to that WO now shows in its detail pane. That is the
// slice's point, not a leak -- an Admin note is only the woId-less case.
test('detail order: pinned first, then newest ts first', () => {
  const notes = migrateAll(fixture()).notes;
  const forWo1 = notesForOrder(notes, 'WO-1');
  assert.deepStrictEqual(forWo1.map(n => noteTitle(n)),
    ['called the tenant', 'card with no id', 'first note', 'Order parts']);
});

test('detail order: another WO\'s notes are not mixed in, and no woId means none', () => {
  const notes = migrateAll(fixture()).notes;
  assert.deepStrictEqual(notesForOrder(notes, 'WO-2').map(n => noteTitle(n)),
    ['trashed WO note', 'Call the PM']);
  assert.strictEqual(notesForOrder(notes, null).length, 0);
});

test('lastNoteTsFor: newest written-at for that WO only', () => {
  const notes = migrateAll(fixture()).notes;
  assert.strictEqual(lastNoteTsFor(notes, 'WO-1'), 3000);
  assert.strictEqual(lastNoteTsFor(notes, 'WO-2'), 500);
  assert.strictEqual(lastNoteTsFor(notes, 'WO-none'), 0);
});

test('calendar: dated notes bucket by day; a WO note never reaches the calendar', () => {
  const by = groupNotesByDate(migrateAll(fixture()).notes);
  assert.deepStrictEqual(Object.keys(by).sort(), ['2026-08-20', '2026-08-21', '2026-08-22']);
  assert.strictEqual(by['2026-08-20'][0].id, 'e-task');
});

test('backlog: only the undated task, and a WO note is not backlog', () => {
  const back = backlogNotes(migrateAll(fixture()).notes);
  assert.deepStrictEqual(back.map(n => n.id), ['e-back']);
});

// ─── Report ──────────────────────────────────────────────────────────────────

console.log('Admin S1 — one note record (migration + readers)');
console.log('===============================================');
let pass = 0, fail = 0;
for (const r of results) {
  if (r.ok) { pass++; console.log('  ok   ' + r.name); }
  else      { fail++; console.log('  FAIL ' + r.name + '\n      ' + r.err); }
}
console.log('');
console.log('Total: ' + (pass + fail) + ' | Pass: ' + pass + ' | Fail: ' + fail);
process.exitCode = fail > 0 ? 1 : 0;
