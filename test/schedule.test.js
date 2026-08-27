// Schedule module tests, two sections.
//
// 1. Pure calendar math from the SHIPPED src/orders-logic.js via the esbuild
//    bridge (weekStart / weekDays / monthGrid / groupByScheduleDate) — no
//    hand-copied mirrors.
// 2. The real ScheduleModule mounted in jsdom, asserting data sourcing (the
//    Slice-1 case: a completed WO that KEPT its schedule still renders), the
//    tech filter, the view toggle and the click handler.
//
// KNOWN LIMITS of section 2, stated up front so a green run is not oversold:
//  - jsdom has NO layout engine and NO CSS cascade. Appearance is unprovable
//    here. "Muted" is read as the inline opacity prop, nothing more.
//  - Element.scrollIntoView does not exist in jsdom; it is stubbed.
//  - This proves structure, data sourcing and handlers. Never looks.
//
// Run:  node test/schedule.test.js
// Exit code: 0 = all green, 1 = at least one fail.

'use strict';

const assert = require('assert');
const path = require('path');
const Module = require('module');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');
const { loadEsm } = require('./_load.js');

const ROOT = path.resolve(__dirname, '..');
const { weekStart, weekDays, monthGrid, groupByScheduleDate, itinShiftDay, itinTodayStr,
        normalizeNote, noteTitle, groupNotesByDate, backlogNotes, isUpcomingSchedule } = loadEsm('src/orders-logic.js');

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e.message }); }
}

// ─── weekStart ───────────────────────────────────────────────────────────────

test('weekStart: a Sunday is its own week start', () => {
  // 2026-08-16 is a Sunday.
  assert.strictEqual(weekStart('2026-08-16'), '2026-08-16');
});

test('weekStart: mid-week snaps back to Sunday', () => {
  assert.strictEqual(weekStart('2026-08-18'), '2026-08-16'); // Tue
  assert.strictEqual(weekStart('2026-08-22'), '2026-08-16'); // Sat
});

test('weekStart: crosses a month boundary backwards', () => {
  // 2026-09-01 is a Tuesday; its Sunday is in August.
  assert.strictEqual(weekStart('2026-09-01'), '2026-08-30');
});

test('weekStart: crosses a year boundary backwards', () => {
  // 2027-01-01 is a Friday; its Sunday is 2026-12-27.
  assert.strictEqual(weekStart('2027-01-01'), '2026-12-27');
});

test('weekStart is idempotent', () => {
  for (const d of ['2026-08-18', '2026-09-01', '2027-01-01', '2026-03-08']) {
    assert.strictEqual(weekStart(weekStart(d)), weekStart(d));
  }
});

// ─── weekDays ────────────────────────────────────────────────────────────────

test('weekDays: 7 contiguous days starting on the week start', () => {
  const w = weekDays('2026-08-18');
  assert.strictEqual(w.length, 7);
  assert.strictEqual(w[0], weekStart('2026-08-18'));
  for (let i = 1; i < 7; i++) assert.strictEqual(w[i], itinShiftDay(w[i - 1], 1));
});

test('weekDays: contiguous across a year boundary', () => {
  const w = weekDays('2026-12-31');
  assert.deepStrictEqual(w, [
    '2026-12-27', '2026-12-28', '2026-12-29', '2026-12-30',
    '2026-12-31', '2027-01-01', '2027-01-02',
  ]);
});

test('weekDays: contiguous across a DST spring-forward week', () => {
  // US DST starts 2026-03-08. Noon anchoring must keep every step one day.
  const w = weekDays('2026-03-10');
  assert.strictEqual(w.length, 7);
  assert.strictEqual(w[0], '2026-03-08');
  assert.strictEqual(w[6], '2026-03-14');
  for (let i = 1; i < 7; i++) assert.strictEqual(w[i], itinShiftDay(w[i - 1], 1));
});

// ─── monthGrid ───────────────────────────────────────────────────────────────

test('monthGrid: 42 contiguous days starting on a Sunday', () => {
  const g = monthGrid('2026-08-18');
  assert.strictEqual(g.length, 42);
  assert.strictEqual(g[0], weekStart('2026-08-01'));
  for (let i = 1; i < 42; i++) assert.strictEqual(g[i], itinShiftDay(g[i - 1], 1));
});

test('monthGrid: contains every day of the anchor month', () => {
  const g = monthGrid('2026-08-18');
  assert.ok(g.includes('2026-08-01'));
  assert.ok(g.includes('2026-08-31'));
  assert.strictEqual(g.filter(d => d.startsWith('2026-08-')).length, 31);
});

test('monthGrid: leading/trailing days come from the adjacent months', () => {
  // 2026-08-01 is a Saturday, so the grid opens with six July days.
  const g = monthGrid('2026-08-01');
  assert.deepStrictEqual(g.slice(0, 6), [
    '2026-07-26', '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31',
  ]);
  assert.strictEqual(g[6], '2026-08-01');
  assert.strictEqual(g[41], '2026-09-05');
});

test('monthGrid: any day of a month yields the same grid', () => {
  assert.deepStrictEqual(monthGrid('2026-08-01'), monthGrid('2026-08-31'));
});

test('monthGrid: spans a year boundary', () => {
  const g = monthGrid('2026-12-15');
  assert.strictEqual(g.length, 42);
  assert.ok(g.includes('2026-12-01'));
  assert.ok(g.includes('2026-12-31'));
  assert.ok(g.includes('2027-01-01'));
});

test('monthGrid: February in a leap year', () => {
  const g = monthGrid('2028-02-10');
  assert.strictEqual(g.length, 42);
  assert.ok(g.includes('2028-02-29'));
});

// ─── groupByScheduleDate ─────────────────────────────────────────────────────

const ORDERS = [
  { id: 'C', schedule: { date: '2026-08-18', start: '13:00' } },
  { id: 'A', schedule: { date: '2026-08-18', start: '08:00' } },
  { id: 'B', schedule: { date: '2026-08-18', start: '08:00' } },
  { id: 'D', schedule: { date: '2026-08-19', start: '10:30' } },
  { id: 'E' },                                     // unscheduled
  { id: 'F', schedule: {} },                       // schedule with no date
  { id: 'G', deleted: true, schedule: { date: '2026-08-18', start: '09:00' } },
];

test('groupByScheduleDate: buckets by date', () => {
  const g = groupByScheduleDate(ORDERS);
  assert.deepStrictEqual(Object.keys(g).sort(), ['2026-08-18', '2026-08-19']);
  assert.strictEqual(g['2026-08-19'].length, 1);
});

test('groupByScheduleDate: sorts by start, then by id', () => {
  const g = groupByScheduleDate(ORDERS);
  assert.deepStrictEqual(g['2026-08-18'].map(o => o.id), ['A', 'B', 'C']);
});

test('groupByScheduleDate: skips deleted, undated and unscheduled orders', () => {
  const g = groupByScheduleDate(ORDERS);
  const ids = Object.values(g).flat().map(o => o.id);
  assert.ok(!ids.includes('E'));
  assert.ok(!ids.includes('F'));
  assert.ok(!ids.includes('G'));
});

test('groupByScheduleDate: keeps completed WOs (S1 retention) so past days show history', () => {
  const g = groupByScheduleDate([
    { id: 'X', tab: 'complete', status: 'Job Complete', schedule: { date: '2026-08-10', start: '09:00' } },
  ]);
  assert.deepStrictEqual(Object.keys(g), ['2026-08-10']);
});

test('groupByScheduleDate: empty / missing input is an empty map', () => {
  assert.deepStrictEqual(groupByScheduleDate([]), {});
  assert.deepStrictEqual(groupByScheduleDate(undefined), {});
});

// --- Schedule notes: normalizeNote / grouping / backlog (Admin S1) ---------
// The Schedule module edits notes through the entry-form view (kind picker +
// title); normalizeNote maps that onto flags. These assert the mapped result.

test('normalizeNote: defaults an unknown kind to task and keeps it undated', () => {
  const n = normalizeNote({ kind: 'bogus', title: '  Order parts  ' }, 'e-1', 1000);
  assert.deepStrictEqual(n.flags.task, { done: false, due: null });
  assert.strictEqual(noteTitle(n), 'Order parts');
  assert.strictEqual(n.id, 'e-1');
  assert.strictEqual(n.ts, 1000);
  assert.strictEqual(n.updated, 1000);
});

test('normalizeNote: an event is never undated (falls back to today)', () => {
  const n = normalizeNote({ kind: 'event', title: 'Meeting' }, 'e-2', 1000);
  assert.strictEqual(n.flags.calendar.date, itinTodayStr());
});

test('normalizeNote: rejects a malformed date and pads a short time', () => {
  const n = normalizeNote({ kind: 'task', title: 'x', date: '8/18/2026', start: '9:30', end: 'nope' }, 'e-3', 1);
  assert.strictEqual(n.flags.task.due, null);
  // An undated task has nowhere to hang a clock, so the times drop with the day.
  assert.strictEqual(n.flags.calendar, undefined);
  const dated = normalizeNote({ kind: 'task', title: 'x', date: '2026-08-18', start: '9:30', end: 'nope' }, 'e-3', 1);
  assert.deepStrictEqual(dated.flags.calendar, { date: '2026-08-18', start: '09:30', end: null });
});

test('normalizeNote: switching a task to an event clears done; ts survives, updated moves', () => {
  const first = normalizeNote({ kind: 'task', title: 't', done: true }, 'e-4', 1000);
  assert.strictEqual(first.flags.task.done, true);
  const edited = normalizeNote({ ...first, kind: 'event', date: '2026-08-18' }, 'e-4', 2000);
  assert.strictEqual(edited.flags.task, undefined);
  assert.strictEqual(edited.ts, 1000);
  assert.strictEqual(edited.updated, 2000);
});

test('normalizeNote: absent optional links are null, never undefined', () => {
  const n = normalizeNote({ title: 't' }, 'e-5', 1);
  for (const k of ['woId', 'tech', 'pm', 'contactId']) {
    assert.strictEqual(n[k], null, k + ' should be null');
  }
  assert.deepStrictEqual(JSON.parse(JSON.stringify(n)), n); // stable round-trip
});

test('groupNotesByDate: buckets dated notes, timed before untimed', () => {
  const cal = (date, start) => ({ calendar: { date, start, end: null } });
  const g = groupNotesByDate([
    { id: 'b', body: 'zz', flags: cal('2026-08-18', null) },
    { id: 'a', body: 'aa', flags: cal('2026-08-18', '13:00') },
    { id: 'c', body: 'cc', flags: cal('2026-08-18', '08:00') },
    { id: 'd', body: 'dd', flags: cal('2026-08-19', '09:00') },
    { id: 'e', body: 'backlog', flags: { task: { done: false, due: null } } },
  ]);
  assert.deepStrictEqual(g['2026-08-18'].map(e => e.id), ['c', 'a', 'b']);
  assert.deepStrictEqual(g['2026-08-19'].map(e => e.id), ['d']);
  assert.deepStrictEqual(Object.keys(g).sort(), ['2026-08-18', '2026-08-19']);
});

test('groupNotesByDate: empty / missing input is an empty map', () => {
  assert.deepStrictEqual(groupNotesByDate([]), {});
  assert.deepStrictEqual(groupNotesByDate(undefined), {});
});

test('backlogNotes: undated tasks only, open before done, oldest first', () => {
  const task = (done, due) => ({ task: { done, due } });
  const list = backlogNotes([
    { id: 'done-old', body: 'a', ts: 1, flags: task(true, null) },
    { id: 'open-new', body: 'b', ts: 3, flags: task(false, null) },
    { id: 'open-old', body: 'c', ts: 2, flags: task(false, null) },
    { id: 'dated', body: 'd', ts: 4, flags: task(false, '2026-08-18') },
    { id: 'event', body: 'e', ts: 5, flags: { calendar: { date: '2026-08-18', start: null, end: null } } },
    { id: 'wo-note', body: 'f', ts: 6, flags: {}, woId: 'WO-1' },
  ]);
  assert.deepStrictEqual(list.map(e => e.id), ['open-old', 'open-new', 'done-old']);
});

// ─── isUpcomingSchedule ──────────────────────────────────────────────────────
// The composition four call sites used to hand-write (chip, schedule form, map
// marker, map context menu). Dates are derived from itinTodayStr() so these
// never rot. LIVE_TAGS mirrors the settings.statusTags shape.

const UP_TAGS = { 'Visited': 'visited', 'On Site': 'onsite' };
const upOrder = (over) => ({ tab: 'active', status: 'Open', schedule: { date: itinTodayStr(), start: '09:00' }, ...over });

test('isUpcomingSchedule: past date → false (S1 retention: a kept schedule is not upcoming)', () => {
  assert.strictEqual(isUpcomingSchedule(upOrder({ schedule: { date: itinShiftDay(itinTodayStr(), -1), start: '09:00' } }), UP_TAGS), false);
});

test('isUpcomingSchedule: today → true (comparison is >=)', () => {
  assert.strictEqual(isUpcomingSchedule(upOrder(), UP_TAGS), true);
});

test('isUpcomingSchedule: future date → true', () => {
  assert.strictEqual(isUpcomingSchedule(upOrder({ schedule: { date: itinShiftDay(itinTodayStr(), 7), start: '09:00' } }), UP_TAGS), true);
});

test('isUpcomingSchedule: complete tab → false', () => {
  assert.strictEqual(isUpcomingSchedule(upOrder({ tab: 'complete' }), UP_TAGS), false);
});

test('isUpcomingSchedule: visited-tagged status → false', () => {
  assert.strictEqual(isUpcomingSchedule(upOrder({ status: 'Visited' }), UP_TAGS), false);
});

test('isUpcomingSchedule: "Job Complete" status → false', () => {
  assert.strictEqual(isUpcomingSchedule(upOrder({ status: 'Job Complete - Enter Bid' }), UP_TAGS), false);
});

test('isUpcomingSchedule: deleted → false', () => {
  assert.strictEqual(isUpcomingSchedule(upOrder({ deleted: true }), UP_TAGS), false);
});

test('isUpcomingSchedule: no schedule at all → false (no throw on o.schedule.date)', () => {
  assert.strictEqual(isUpcomingSchedule({ tab: 'active', status: 'Open' }, UP_TAGS), false);
  assert.strictEqual(isUpcomingSchedule({ tab: 'active', status: 'Open', schedule: {} }, UP_TAGS), false);
  assert.strictEqual(isUpcomingSchedule(null, UP_TAGS), false);
});

// ─── Mounted ScheduleModule (jsdom) ──────────────────────────────────────────
// Ported from a throwaway probe so these checks live in the suite instead of a
// scratchpad. Fixture dates are derived from today, so this stays green on any
// run date (never hardcode a week).

function ok(label, cond, extra) {
  results.push({ name: label, ok: !!cond, err: cond ? undefined : String(extra === undefined ? 'assertion failed' : extra) });
}

// Fresh jsdom + globals BEFORE the bundle is compiled: importing schedule.jsx
// pulls app.jsx, which self-mounts createRoot(#root) at module-eval time. #root
// is for that self-mount; #probe is this test's own container. Never two roots
// on one node.
function freshDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div><div id="probe"></div></body></html>',
    { url: 'http://localhost/', pretendToBeVisual: true });
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.Node = dom.window.Node;
  global.getComputedStyle = dom.window.getComputedStyle;
  global.requestAnimationFrame = dom.window.requestAnimationFrame || ((cb) => setTimeout(() => cb(Date.now()), 0));
  global.cancelAnimationFrame = dom.window.cancelAnimationFrame || clearTimeout;
  dom.window.Element.prototype.scrollIntoView = function () {};  // jsdom has none
  global.IS_REACT_ACT_ENVIRONMENT = false;                       // act() noise drowns the output
  return dom;
}

// One bundle holding React, react-dom AND ScheduleModule. Two React copies =
// "invalid hook call", so the mount entry cannot live in this CJS file.
// test/_load.js takes a path, not source, hence the same esbuild -> Module trick
// applied to a stdin entry resolved from the repo root.
function loadMountBridge() {
  const out = esbuild.buildSync({
    stdin: {
      contents: [
        "import React from 'react';",
        "import { createRoot } from 'react-dom/client';",
        "import { ScheduleModule } from './src/schedule.jsx';",
        "export { React, createRoot, ScheduleModule };",
      ].join('\n'),
      resolveDir: ROOT,
      sourcefile: 'schedule-mount-entry.jsx',
      loader: 'jsx',
    },
    bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
    loader: { '.js': 'jsx', '.jsx': 'jsx' }, write: false, logLevel: 'silent',
  });
  const abs = path.join(ROOT, 'schedule-mount-entry.jsx');
  const m = new Module(abs, module);
  m.filename = abs;
  m.paths = Module._nodeModulePaths(ROOT);
  m._compile(out.outputFiles[0].text, abs);
  return m.exports;
}

async function mountedChecks() {
  const dom = freshDom();
  const { React, createRoot, ScheduleModule } = loadMountBridge();

  const today = itinTodayStr();
  const week = weekDays(today);
  // A past-ish day GUARANTEED inside the visible week (yesterday leaves the week
  // when today is Sunday). The completed WO's mute state is status-driven, not
  // date-driven, so any in-week day that is not today works.
  const otherDay = today === week[0] ? week[6] : itinShiftDay(today, -1);
  // A date guaranteed OUTSIDE the current week, to prove the range filter bites.
  const farOff = itinShiftDay(week[0], -30);

  const statusTags = { 'Job Complete': 'visited', Scheduled: '', Dispatched: '' };
  const techs = ['Alice', 'Bob'];
  const orders = [
    { id: 'WO-LIVE-A', city: 'Springfield', tab: 'active', status: 'Scheduled', tech: 'Alice', type: 'Plumbing',
      address: '1 Main St, Springfield, IL 62701', schedule: { date: today, start: '09:00' } },
    { id: 'WO-LIVE-B', city: 'Shelbyville', tab: 'active', status: 'Dispatched', tech: 'Bob', type: 'HVAC',
      address: '2 Oak Ave, Shelbyville, IL 62565', schedule: { date: today, start: '13:00' } },
    // THE SLICE-1 CASE: completed WO that kept its schedule. Must still render.
    { id: 'WO-DONE', city: 'Springfield', tab: 'complete', status: 'Job Complete', tech: 'Alice', type: 'Plumbing',
      address: '3 Elm Rd, Springfield, IL 62701', schedule: { date: otherDay, start: '08:00' } },
    { id: 'WO-TRASH', city: 'Springfield', tab: 'active', status: 'Scheduled', tech: 'Alice', deleted: true,
      address: '4 Pine Ct, Springfield, IL 62701', schedule: { date: today, start: '10:00' } },
    { id: 'WO-NOSCHED', city: 'Springfield', tab: 'active', status: 'Scheduled', tech: 'Alice', address: '5 Ash Ln, Springfield, IL 62701' },
    { id: 'WO-FAR', city: 'Springfield', tab: 'active', status: 'Scheduled', tech: 'Alice',
      address: '6 Fir Way, Springfield, IL 62701', schedule: { date: farOff, start: '11:00' } },
  ];

  const opened = [];
  let tech = 'ALL';
  const container = dom.window.document.getElementById('probe');
  const root = createRoot(container);
  const render = () => root.render(React.createElement(ScheduleModule, {
    orders, techs, statusColors: {}, statusTags,
    tech, setTech: (t) => { tech = t; render(); },
    focus: null, onClearFocus: () => {},
    onOpenWO: (id) => { opened.push(id); },
  }));
  const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0)); };
  const cards = () => Array.from(container.querySelectorAll('div[title]'));
  const idsOnScreen = () => cards().map(c => (c.getAttribute('title') || '').split(' - ')[0]);
  const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  const byLabel = (l) => Array.from(container.querySelectorAll('button')).find(b => b.textContent.trim() === l);
  const mmdd = (d) => d.slice(5, 7) + '/' + d.slice(8);

  render(); await flush();

  // Admin S3b: the module LANDS on the Scratchpad binder tab, so the Calendar
  // TAB and then the Week range must be selected before any calendar assertion
  // can see them. NOTHING below is weakened: every assertion expression is
  // byte-identical to the pre-S3 file. That Scratchpad is the landing tab is
  // proven in test/admin-s3-scratchpad.test.js.
  click(byLabel('Calendar')); await flush();
  click(byLabel('Week')); await flush();

  // [1] week grid
  const text = container.textContent;
  ok('mount: header title present', text.indexOf('Admin') !== -1);
  ok('mount: Week renders all 7 day columns',
    week.every(d => text.indexOf(mmdd(d)) !== -1), 'expected columns ' + week.map(mmdd).join(','));
  // Assert on the count element's OWN text. container.textContent concatenates
  // siblings with no separator ("3 jobsDayWeekMonth"), so a trailing \b can
  // never match there -- that was a bad assumption, not a product defect.
  const countLine = Array.from(container.querySelectorAll('div'))
    .find(d => d.children.length === 0 && /\d+ jobs?$/.test(d.textContent.trim()));
  ok('mount: count line reads 3 jobs (2 today + 1 elsewhere in the week)',
    !!countLine && /(^|\s)3 jobs$/.test(countLine.textContent.trim()), countLine && countLine.textContent);

  // [2] THE SLICE-1 CASE: sourcing all orders, not activeOrders
  const ids = idsOnScreen();
  ok('mount: completed WO with a kept schedule RENDERS', ids.indexOf('WO-DONE') !== -1, 'on screen: ' + ids.join(','));
  ok('mount: live WOs render', ids.indexOf('WO-LIVE-A') !== -1 && ids.indexOf('WO-LIVE-B') !== -1, 'on screen: ' + ids.join(','));
  ok('mount: trashed WO does NOT render', ids.indexOf('WO-TRASH') === -1, 'on screen: ' + ids.join(','));
  ok('mount: unscheduled WO does NOT render', ids.indexOf('WO-NOSCHED') === -1, 'on screen: ' + ids.join(','));
  ok('mount: WO outside the week does NOT render', ids.indexOf('WO-FAR') === -1, 'on screen: ' + ids.join(','));

  // [3] muted styling (inline opacity only, no CSS engine here)
  const doneCard = cards().find(c => c.getAttribute('title').indexOf('WO-DONE') === 0);
  const liveCard = cards().find(c => c.getAttribute('title').indexOf('WO-LIVE-A') === 0);
  ok('mount: not-live card is dimmed', !!doneCard && doneCard.style.opacity === '0.5', doneCard && doneCard.style.opacity);
  ok('mount: live card is not dimmed', !!liveCard && liveCard.style.opacity === '1', liveCard && liveCard.style.opacity);

  // [4] click opens the command center
  if (liveCard) click(liveCard);
  await flush();
  ok('mount: onOpenWO fired once with the WO id', opened.length === 1 && opened[0] === 'WO-LIVE-A', JSON.stringify(opened));

  // [5] tech filter narrows
  const sel = container.querySelector('select');
  sel.value = 'Bob';
  sel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await flush();
  const bobIds = idsOnScreen();
  ok('mount: tech filter narrows to one tech',
    bobIds.indexOf('WO-LIVE-B') !== -1 && bobIds.indexOf('WO-LIVE-A') === -1 && bobIds.indexOf('WO-DONE') === -1,
    'on screen: ' + bobIds.join(','));
  sel.value = 'ALL';
  sel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await flush();
  ok('mount: ALL restores every job', idsOnScreen().length === 3, idsOnScreen().join(','));

  // [6] view toggle
  click(byLabel('Month')); await flush();
  const grid = monthGrid(today);
  ok('mount: monthGrid is 42 cells', grid.length === 42, String(grid.length));
  ok('mount: month view renders a WO whose date falls inside the grid',
    grid.indexOf(farOff) === -1 ? true : idsOnScreen().indexOf('WO-FAR') !== -1,
    'farOff ' + farOff + ' inGrid=' + (grid.indexOf(farOff) !== -1));
  click(byLabel('Day')); await flush();
  const dayIds = idsOnScreen();
  ok('mount: day view shows the anchor day only',
    dayIds.indexOf('WO-LIVE-A') !== -1 && dayIds.indexOf('WO-DONE') === -1, dayIds.join(','));
  click(byLabel('Week')); await flush();

  // [7] empty range
  const prev = Array.from(container.querySelectorAll('button')).find(b => b.textContent.indexOf('‹') !== -1);
  for (let i = 0; i < 3; i++) { click(prev); await flush(); }
  ok('mount: an empty range shows the "No jobs scheduled" line',
    container.textContent.indexOf('No jobs scheduled') !== -1, container.textContent.slice(0, 200));

  root.unmount();
}

// --- Mounted entries: calendar chips (S3b) ----------------------------------
// Own fixture and own mount: the section above asserts exact card counts, and
// entry chips share the div[title] selector with WO cards.
// Admin S1: the module takes notes, not entries. The fixture is built with the
// SHIPPED normalizeNote so the flags under test are the real ones.
//
// Admin S3b DELETED, by explicit human ruling, the entry editor (EntryModal),
// the "+ New" button, entry delete and the backlog rail. The assertions that
// proved those behaviours were removed with them -- keeping one would assert
// that a feature the human ordered removed still exists. What remains is every
// assertion about calendar RENDERING, SOURCING, EXCLUSION and the TECH FILTER,
// unchanged. The two undated tasks stay in the fixture on purpose: they now
// prove an EXCLUSION (an undated task appears on no calendar day) instead of a
// backlog rail.

async function entryChecks() {
  const dom = freshDom();
  const { React, createRoot, ScheduleModule } = loadMountBridge();

  const today = itinTodayStr();
  const notes = [
    normalizeNote({ kind: 'task', title: 'Order parts', date: today, start: '08:00', done: false, tech: null }, 'e-task', 1),
    normalizeNote({ kind: 'event', title: 'Team meeting', date: today, start: '12:00', tech: 'Bob' }, 'e-event', 2),
    normalizeNote({ kind: 'task', title: 'Call vendor', date: null, done: false, tech: null }, 'e-back', 3),
    normalizeNote({ kind: 'task', title: 'File permit', date: null, done: true, tech: null }, 'e-back-done', 4),
  ];
  const orders = [
    { id: 'WO-LIVE-A', city: 'Springfield', tab: 'active', status: 'Scheduled', tech: 'Alice', type: 'Plumbing',
      address: '1 Main St, Springfield, IL 62701', schedule: { date: today, start: '09:00' } },
  ];

  let tech = 'ALL';
  const container = dom.window.document.getElementById('probe');
  const root = createRoot(container);
  const render = () => root.render(React.createElement(ScheduleModule, {
    orders, techs: ['Alice', 'Bob'], statusColors: {}, statusTags: {},
    tech, setTech: (t) => { tech = t; render(); },
    focus: null, onClearFocus: () => {}, onOpenWO: () => {}, onOpenMaps: () => {},
    notes,
    onAddNote: () => {}, onUpdateNote: () => {},
  }));
  const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0)); };
  const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  const byLabel = (l) => Array.from(container.querySelectorAll('button')).find(b => b.textContent.trim() === l);
  const chip = (t) => Array.from(container.querySelectorAll('div[title]'))
    .find(d => (d.getAttribute('title') || '').indexOf(t) === 0);

  render(); await flush();
  // S3b: the binder lands on Scratchpad, so open the Calendar tab first. Every
  // calendar assertion below is unchanged.
  click(byLabel('Calendar')); await flush();
  click(byLabel('Week')); await flush();

  // [1] dated entries render on the calendar
  ok('entries: dated task renders on the calendar', !!chip('Order parts'));
  ok('entries: event renders on the calendar', !!chip('Team meeting'));
  ok('entries: header counts the dated entries', container.textContent.indexOf('2 entries') !== -1,
    container.textContent.slice(0, 300));

  // [2] an undated task lands on no day at all (the rail that used to catch it
  //     is gone; the EXCLUSION it always relied on is what is proved here)
  ok('entries: an undated task appears on no calendar day', !chip('Call vendor') && !chip('File permit'),
    Array.from(container.querySelectorAll('div[title]')).map(d => d.getAttribute('title')).join(','));

  // [3] chips are READ-ONLY: no checkbox, and clicking one opens nothing
  ok('entries: a calendar chip carries no checkbox (chips are read-only)',
    !container.querySelector('input[type="checkbox"]'));
  click(chip('Team meeting')); await flush();
  ok('entries: clicking a chip opens no editor',
    container.textContent.indexOf('Edit entry') === -1 && container.textContent.indexOf('New entry') === -1,
    container.textContent.slice(0, 200));

  // [4] tech filter: tagged entry hides, untagged stays
  const sel = container.querySelector('select');
  sel.value = 'Alice';
  sel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await flush();
  ok('entries: an event tagged to another tech is filtered out', !chip('Team meeting'));
  ok('entries: untagged entry survives the tech filter', !!chip('Order parts'));
  sel.value = 'ALL';
  sel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await flush();
  ok('entries: ALL restores the tagged entry', !!chip('Team meeting'));

  root.unmount();
}

// ─── Report ──────────────────────────────────────────────────────────────────

(async () => {
  await mountedChecks();
  await entryChecks();
  console.log('schedule calendar math + mounted module');
  console.log('=======================================');
  let pass = 0, fail = 0;
  for (const r of results) {
    if (r.ok) { pass++; console.log('  ok   ' + r.name); }
    else      { fail++; console.log('  FAIL ' + r.name + '\n      ' + r.err); }
  }
  console.log('');
  console.log('Total: ' + (pass + fail) + ' | Pass: ' + pass + ' | Fail: ' + fail);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('THREW: ' + ((e && e.stack) || e)); process.exit(1); });
