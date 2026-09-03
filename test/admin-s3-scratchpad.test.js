// Admin S3 -- "Scratchpad". Four sections:
//   A. PURE: scratchpadNotes from the SHIPPED src/orders-logic.js via the
//      esbuild bridge. Inclusion, exclusion and ordering.
//   B. HOOK (jsdom): the REAL useWorkOrders from src/data.js against a stubbed
//      window.storage, proving the persisted module id 'itinerary' -> 'admin'
//      migration on load, and that a store already holding 'admin' is untouched.
//      Driving the hook (not a hand-called helper) is what proves the coercion
//      is actually WIRED into the load path -- a blank-pane bug otherwise.
//   C. MOUNT (jsdom): the REAL ScheduleModule, proving the composer exists, is
//      focused on mount, writes on Enter and on blur, writes NOTHING for a
//      whitespace-only body, and that clicking a saved jotting edits it IN THE
//      COMPOSER -- no EntryModal, so kind 'task' can never be defaulted onto an
//      unflagged note. The positive controls are load-bearing: "no write
//      happened" would also pass if the composer did not exist at all.
//   D. STORE (jsdom): the REAL useWorkOrders again, proving a { body } patch
//      merges -- ts, flags and woId survive, only `updated` moves -- so an edit
//      never promotes a jotting up the journal or flags it into the backlog.
//
// KNOWN LIMITS, stated up front:
//  - window.storage is a stub. This proves what the hook LOADS and WRITES, not
//    that Electron's storage layer keeps it.
//  - jsdom has NO layout and NO CSS. Nothing here is a claim about appearance;
//    "the composer is at the top" is unprovable here and is not asserted.
//  - Deliberately NO pretendToBeVisual: its per-window rAF loop on a libuv
//    handle, combined with process.exit(), aborts intermittently on Windows
//    (UV_HANDLE_CLOSING) with every assertion green. rAF is shimmed here, every
//    JSDOM is closed, App intervals are cleared explicitly (a bundle's bare
//    setInterval resolves to NODE's global, so window.close() cannot reap them)
//    and the file sets process.exitCode instead of exiting.
//
// Run:  node test/admin-s3-scratchpad.test.js
// Exit code: 0 = all green, 1 = at least one fail.

'use strict';

const assert = require('assert');
const path = require('path');
const Module = require('module');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');
const { loadEsm } = require('./_load.js');

const ROOT = path.resolve(__dirname, '..');
const { normalizeNote, scratchpadNotes } = loadEsm('src/orders-logic.js');

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: (e && e.message) || String(e) }); }
}
function ok(name, cond, extra) {
  results.push({ name, ok: !!cond, err: cond ? undefined : String(extra === undefined ? 'assertion failed' : extra) });
}

// A hung esbuild/mount would otherwise hang the runner forever. unref'd so a
// green run exits immediately.
const watchdog = setTimeout(() => {
  console.error('WATCHDOG: admin-s3-scratchpad did not finish in 60s');
  process.exit(1);
}, 60000);
watchdog.unref();

// ─────────────────────────── A. the pure selector ────────────────────────────

// Built with the SHIPPED normalizeNote so the flags under test are the real
// ones, not a hand-written guess at the shape.
function padFixture() {
  return [
    normalizeNote({ body: 'call the supply house', ts: 100 }, 'p-old'),
    normalizeNote({ body: 'warranty account steps\nline two', ts: 300 }, 'p-new'),
    normalizeNote({ body: 'mid jotting', ts: 200 }, 'p-mid'),
    normalizeNote({ kind: 'task', title: 'Order parts', date: null, ts: 400 }, 'p-task'),
    normalizeNote({ kind: 'event', title: 'Team meeting', date: '2026-08-21', ts: 500 }, 'p-event'),
    normalizeNote({ body: 'tenant called back', woId: 'WO-1', ts: 600 }, 'p-wo'),
  ];
}
const padIds = (list) => list.map(n => n.id);

test('scratchpad: a body-only note is included', () => {
  assert.ok(padIds(scratchpadNotes(padFixture())).includes('p-old'));
});

test('scratchpad: a task note is EXCLUDED (flags.task is set)', () => {
  const f = padFixture();
  assert.ok(f.find(n => n.id === 'p-task').flags.task, 'fixture is wrong: no task flag');
  assert.ok(!padIds(scratchpadNotes(f)).includes('p-task'));
});

test('scratchpad: a dated event is EXCLUDED (flags.calendar is set)', () => {
  assert.ok(!padIds(scratchpadNotes(padFixture())).includes('p-event'));
});

test('scratchpad: a note carrying a woId is EXCLUDED even with no flags', () => {
  const f = padFixture();
  const wo = f.find(n => n.id === 'p-wo');
  assert.deepStrictEqual(Object.keys(wo.flags), [], 'fixture is wrong: the WO note has flags');
  assert.ok(!padIds(scratchpadNotes(f)).includes('p-wo'));
});

test('scratchpad: newest first by ts', () => {
  assert.deepStrictEqual(padIds(scratchpadNotes(padFixture())), ['p-new', 'p-mid', 'p-old']);
});

test('scratchpad: editing an old note does not jump it (sorts on ts, not updated)', () => {
  const f = padFixture();
  f.find(n => n.id === 'p-old').updated = 99999;
  assert.deepStrictEqual(padIds(scratchpadNotes(f)), ['p-new', 'p-mid', 'p-old']);
});

test('scratchpad: tolerates null/undefined input and junk entries', () => {
  assert.deepStrictEqual(scratchpadNotes(null), []);
  assert.deepStrictEqual(scratchpadNotes(undefined), []);
  assert.deepStrictEqual(padIds(scratchpadNotes([null, undefined, ...padFixture()])), ['p-new', 'p-mid', 'p-old']);
});

// ───────────────────────────── shared jsdom rig ──────────────────────────────

// The bundle's bare setInterval resolves to NODE's global, not the jsdom
// window, so window.close() cannot reap the App's minute tick and the loop
// never drains. Wrap setInterval ONLY -- wrapping setTimeout would abandon this
// file's own await/flush timers.
const openIntervals = [];
const realSetInterval = global.setInterval;

// `stored` is what the storage stub serves; each section sets it before mount.
let stored = {};
const writes = [];

function freshDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div><div id="probe"></div></body></html>',
    { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.Node = dom.window.Node;
  global.getComputedStyle = dom.window.getComputedStyle;
  global.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  global.cancelAnimationFrame = clearTimeout;
  dom.window.requestAnimationFrame = global.requestAnimationFrame;
  dom.window.cancelAnimationFrame = global.cancelAnimationFrame;
  dom.window.Element.prototype.scrollIntoView = function () {};
  global.IS_REACT_ACT_ENVIRONMENT = false;
  global.setInterval = (...args) => { const id = realSetInterval(...args); openIntervals.push(id); return id; };
  // Installed BEFORE the bundle is compiled: app.jsx self-mounts at module-eval
  // time and the hook reads window.storage on its first effect.
  dom.window.storage = {
    get: () => Promise.resolve({ value: JSON.stringify(stored) }),
    set: (key, value, opts) => { writes.push({ key, value, opts }); return Promise.resolve(); },
  };
  return dom;
}

// esbuild is the slow part, so compile each entry ONCE and re-instantiate the
// same text into a fresh Module per DOM (section B mounts twice).
const bundleCache = {};
function bundle(name, lines) {
  if (!bundleCache[name]) {
    const out = esbuild.buildSync({
      stdin: { contents: lines.join('\n'), resolveDir: ROOT, sourcefile: name + '.jsx', loader: 'jsx' },
      bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
      loader: { '.js': 'jsx', '.jsx': 'jsx' }, write: false, logLevel: 'silent',
    });
    bundleCache[name] = out.outputFiles[0].text;
  }
  const abs = path.join(ROOT, name + '.jsx');
  const m = new Module(abs, module);
  m.filename = abs;
  m.paths = Module._nodeModulePaths(ROOT);
  m._compile(bundleCache[name], abs);
  return m.exports;
}

const tick = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0)); };

function closeDom(dom) {
  try { dom.window.close(); } catch (e) { /* already closed */ }
  while (openIntervals.length) {
    try { global.clearInterval(openIntervals.pop()); } catch (e) { /* already cleared */ }
  }
  global.setInterval = realSetInterval;
}

// ─────────────── B. the real hook: lastModule 'itinerary' -> 'admin' ─────────

// Loads the store once through the real hook and returns settings.lastModule.
async function loadLastModule(settings) {
  stored = { orders: [], presets: [], inboxes: [], notes: [], settings };
  const dom = freshDom();
  const { React, createRoot, useWorkOrders } = bundle('admin-s3-hook-entry', [
    "import React from 'react';",
    "import { createRoot } from 'react-dom/client';",
    "import { useWorkOrders } from './src/data.js';",
    "export { React, createRoot, useWorkOrders };",
  ]);
  let handle = null;
  function Probe() { handle = useWorkOrders()[0]; return null; }
  const root = createRoot(dom.window.document.getElementById('probe'));
  root.render(React.createElement(Probe));
  await tick();
  const got = handle && handle.settings ? handle.settings.lastModule : '<no settings>';
  root.unmount();
  closeDom(dom);
  return got;
}

async function hookChecks() {
  const old = await loadLastModule({ lastModule: 'itinerary' });
  ok('migration: a store holding lastModule "itinerary" loads as "admin"', old === 'admin', String(old));

  const already = await loadLastModule({ lastModule: 'admin' });
  ok('migration IS IDEMPOTENT: a store already holding "admin" is unchanged', already === 'admin', String(already));

  const other = await loadLastModule({ lastModule: 'invoices' });
  ok('migration: an unrelated module id is left alone', other === 'invoices', String(other));
}

// ───────────── C. the real ScheduleModule: the AUTOSAVING pad ────────────────
// S3b amendment. Enter-to-save shipped and was rejected on sight, so the pad is
// now a notepad: Enter is a newline, no keystroke saves, and the text writes
// itself on an idle timer. Every assertion below that encoded Enter-saves or
// Shift+Enter was DELETED with the behaviour, the same way the EntryModal
// assertions were -- keeping one would assert a feature the human ordered gone.
//
// The timer is driven by PAD_IDLE_MS exported from the module, never by a
// guessed sleep, so this file cannot silently rot if the delay is retuned.

async function composerChecks() {
  stored = { orders: [], presets: [], inboxes: [], notes: [], settings: {} };
  const dom = freshDom();
  const { React, createRoot, ScheduleModule, PAD_IDLE_MS } = bundle('admin-s3-mount-entry', [
    "import React from 'react';",
    "import { createRoot } from 'react-dom/client';",
    "import { ScheduleModule, PAD_IDLE_MS } from './src/schedule.jsx';",
    "export { React, createRoot, ScheduleModule, PAD_IDLE_MS };",
  ]);

  // onAddNote returns the minted id, exactly as data.js addNote does. Without
  // that the pad could never update the note it just created.
  let seq = 0;
  const added = [], edits = [];
  const notes = [
    normalizeNote({ body: 'older jotting', ts: 100 }, 's-old'),
    normalizeNote({ body: 'newest jotting', ts: 900 }, 's-new'),
    normalizeNote({ kind: 'task', title: 'Call vendor', date: null, ts: 500 }, 's-task'),
  ];
  const container = dom.window.document.getElementById('probe');
  const root = createRoot(container);
  const render = () => root.render(React.createElement(ScheduleModule, {
    orders: [], techs: ['Alice'], statusColors: {}, statusTags: {},
    tech: 'ALL', setTech: () => {},
    focus: null, onClearFocus: () => {}, onOpenWO: () => {}, onOpenMaps: () => {},
    notes,
    onAddNote: (rec) => { added.push(rec); return 'minted-' + (++seq); },
    onUpdateNote: (id, patch) => { edits.push([id, patch]); },
  }));
  render(); await tick();

  const pad = () => container.querySelector('textarea');
  const typeInto = (el, v) => {
    const desc = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value');
    desc.set.call(el, v);
    el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  };
  const press = (el, key, shift) => el.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', { key, shiftKey: !!shift, bubbles: true }));
  const row = (t) => Array.from(container.querySelectorAll('div[title]'))
    .find(d => d.getAttribute('title') === t);
  const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  // The ONLY wall-clock wait in this file, and it is the timer under test.
  const idle = async () => { await new Promise(r => setTimeout(r, PAD_IDLE_MS + 60)); await tick(); };
  const BLANKS = '   \t  ';

  ok('pad: a textarea is mounted with no interaction at all', !!pad());
  ok('pad: it has focus on module entry',
    !!pad() && dom.window.document.activeElement === pad(),
    String(dom.window.document.activeElement && dom.window.document.activeElement.tagName));
  ok('pad: the placeholder no longer promises Enter saves',
    (pad().placeholder || '').indexOf('Enter saves') === -1, pad().placeholder);

  // The default body view is the scratchpad, newest first, task note excluded.
  const rowTitles = Array.from(container.querySelectorAll('div[title]')).map(d => d.getAttribute('title'));
  ok('scratchpad view is the DEFAULT body view, newest first',
    rowTitles.indexOf('newest jotting') === 0 && rowTitles.indexOf('older jotting') === 1, rowTitles.join(','));
  ok('scratchpad view does not list the task note (it stays in the quick-nav)',
    rowTitles.indexOf('Call vendor') === -1, rowTitles.join(','));

  // Enter is a NEWLINE. Nothing about a keystroke saves.
  typeInto(pad(), 'buy a new torch'); await tick();
  press(pad(), 'Enter'); await tick();
  ok('pad: Enter writes NOTHING (it is a newline, not a save key)',
    added.length === 0 && edits.length === 0, JSON.stringify({ added, edits }));
  ok('pad: Enter does not clear the pad', pad().value === 'buy a new torch', pad().value);
  press(pad(), 'Enter', true); await tick();
  ok('pad: Shift+Enter writes nothing either (it has no special meaning now)',
    added.length === 0 && edits.length === 0, JSON.stringify({ added, edits }));

  // Autosave: one note per idle pause, NOT one per keystroke.
  typeInto(pad(), 'buy a new torch a'); await tick();
  typeInto(pad(), 'buy a new torch an'); await tick();
  typeInto(pad(), 'buy a new torch and tape'); await tick();
  ok('pad: rapid typing issues NO write while the timer is still running',
    added.length === 0 && edits.length === 0, JSON.stringify({ added, edits }));
  await idle();
  ok('pad: one idle pause mints EXACTLY ONE note, carrying the latest text',
    added.length === 1 && added[0].body === 'buy a new torch and tape', JSON.stringify(added));
  ok('pad: the minted note is body-only -- no kind, no flags',
    JSON.stringify(Object.keys(added[0])) === '["body"]', JSON.stringify(added[0]));
  ok('pad: autosaving does NOT clear the pad (you are still writing in it)',
    pad().value === 'buy a new torch and tape', pad().value);

  typeInto(pad(), 'buy a new torch and tape, from Ferguson'); await tick();
  await idle();
  ok('pad: continued typing UPDATES the same note, it does not mint a second',
    added.length === 1 && edits.length === 1 && edits[0][0] === 'minted-1'
      && edits[0][1].body === 'buy a new torch and tape, from Ferguson',
    JSON.stringify({ added, edits }));
  ok('pad: the update patch carries body and NOTHING else',
    JSON.stringify(Object.keys(edits[0][1])) === '["body"]', JSON.stringify(edits[0][1]));

  // Blur flushes immediately, without waiting out the timer.
  typeInto(pad(), 'blurred before the timer fired'); await tick();
  pad().blur(); await tick();
  ok('pad: blur flushes at once, no idle wait',
    edits.length === 2 && edits[1][1].body === 'blurred before the timer fired', JSON.stringify(edits));
  pad().blur(); await tick();
  ok('pad: a second blur with unchanged text writes nothing more', edits.length === 2, JSON.stringify(edits));

  // Escape clears ONLY once a note exists.
  pad().focus();
  press(pad(), 'Escape'); await tick();
  ok('pad: Escape clears the pad once the note is saved', pad().value === '', JSON.stringify(pad().value));
  ok('pad: Escape flushed first, so nothing typed was lost', edits.length === 2, JSON.stringify(edits));

  // A pad that owns no note yet must ignore Escape entirely, so a stray press
  // can never destroy text that was never saved.
  const beforeStray = added.length + edits.length;
  typeInto(pad(), 'not saved yet'); await tick();
  press(pad(), 'Escape'); await tick();
  ok('pad: Escape does NOTHING on a pad with no saved note (unsaved text survives)',
    pad().value === 'not saved yet' && added.length + edits.length === beforeStray,
    JSON.stringify({ value: pad().value, added, edits }));

  // After a clear, the pad is writing a NEW note, not the old one.
  await idle();
  ok('pad: typing after a clear mints a NEW note instead of overwriting the last',
    added.length === 2 && added[1].body === 'not saved yet' && edits.length === 2,
    JSON.stringify({ added, edits }));

  // Blank / whitespace-only never mints.
  const beforeBlank = added.length;
  typeInto(pad(), BLANKS); await tick();
  await idle();
  ok('pad: a whitespace-only pad mints NOTHING on the idle tick', added.length === beforeBlank,
    JSON.stringify(added.slice(beforeBlank)));
  pad().blur(); await tick();
  ok('pad: a whitespace-only pad mints NOTHING on blur either', added.length === beforeBlank,
    JSON.stringify(added.slice(beforeBlank)));
  ok('pad: emptying the pad DETACHES it, so the note just written is not blanked',
    edits.every(e => String(e[1].body || '').trim() !== ''), JSON.stringify(edits));

  // Clicking a saved jotting edits it IN THE PAD, never in a modal.
  pad().focus();
  typeInto(pad(), ''); await tick();
  const editsBefore = edits.length, addedBefore = added.length;

  click(row('older jotting')); await tick();
  ok('edit: clicking a row loads its body into the pad',
    pad().value === 'older jotting', JSON.stringify(pad().value));
  ok('edit: clicking a row opens NO modal (EntryModal is gone)',
    container.textContent.indexOf('Edit entry') === -1 && container.textContent.indexOf('New entry') === -1,
    container.textContent.slice(0, 200));
  ok('edit: the pad is focused after a row click', dom.window.document.activeElement === pad());
  ok('edit: merely loading a row writes nothing',
    edits.length === editsBefore && added.length === addedBefore, JSON.stringify({ added, edits }));

  typeInto(pad(), 'older jotting, revised'); await tick();
  await idle();
  ok('edit: autosave updates the CLICKED note, by its own id',
    edits.length === editsBefore + 1 && edits[editsBefore][0] === 's-old'
      && edits[editsBefore][1].body === 'older jotting, revised', JSON.stringify(edits.slice(editsBefore)));
  ok('edit: editing a saved note never calls onAddNote (no duplicate)',
    added.length === addedBefore, JSON.stringify(added.slice(addedBefore)));

  // Clearing the pad detaches it from that note, so the next thing typed is a
  // NEW note and cannot overwrite the one just edited.
  typeInto(pad(), ''); await tick();
  typeInto(pad(), 'a brand new jotting'); await tick();
  await idle();
  ok('edit: after clearing, the next text mints a NEW note rather than overwriting',
    added.length === addedBefore + 1 && added[added.length - 1].body === 'a brand new jotting'
      && edits.length === editsBefore + 1,
    JSON.stringify({ added: added.slice(addedBefore), edits: edits.slice(editsBefore) }));

  root.unmount();
  closeDom(dom);
}

// ─── C2. a pending write must not be stranded by an unmount (rule A7) ────────
// Its own mount, because proving it requires unmounting.

async function unmountFlushCheck() {
  stored = { orders: [], presets: [], inboxes: [], notes: [], settings: {} };
  const dom = freshDom();
  const { React, createRoot, ScheduleModule } = bundle('admin-s3-mount-entry', [
    "import React from 'react';",
    "import { createRoot } from 'react-dom/client';",
    "import { ScheduleModule, PAD_IDLE_MS } from './src/schedule.jsx';",
    "export { React, createRoot, ScheduleModule, PAD_IDLE_MS };",
  ]);
  const added = [];
  const container = dom.window.document.getElementById('probe');
  const root = createRoot(container);
  root.render(React.createElement(ScheduleModule, {
    orders: [], techs: ['Alice'], statusColors: {}, statusTags: {},
    tech: 'ALL', setTech: () => {},
    focus: null, onClearFocus: () => {}, onOpenWO: () => {}, onOpenMaps: () => {},
    notes: [],
    onAddNote: (rec) => { added.push(rec); return 'minted-u'; },
    onUpdateNote: () => {},
  }));
  await tick();

  const pad = container.querySelector('textarea');
  const desc = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value');
  desc.set.call(pad, 'typed, then the module was torn down');
  pad.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await tick();
  ok('unmount: nothing is written yet -- the timer is still armed', added.length === 0, JSON.stringify(added));

  root.unmount();          // a module switch, a tab close, anything
  await tick();
  ok('unmount: the pending write is FLUSHED, not stranded',
    added.length === 1 && added[0].body === 'typed, then the module was torn down', JSON.stringify(added));

  closeDom(dom);
}

// ───── D. the real store: a { body } patch must not move a note in time ──────
// The composer's edit path ends in updateNote. This drives the SHIPPED hook to
// prove the merge keeps ts/flags/woId, so an edit cannot promote a jotting up
// the journal (the S1 rule) and cannot flag it into the backlog.

async function storeChecks() {
  stored = { orders: [], presets: [], inboxes: [], notes: [], settings: {} };
  const dom = freshDom();
  const { React, createRoot, useWorkOrders } = bundle('admin-s3-hook-entry', [
    "import React from 'react';",
    "import { createRoot } from 'react-dom/client';",
    "import { useWorkOrders } from './src/data.js';",
    "export { React, createRoot, useWorkOrders };",
  ]);
  let handle = null;
  function Probe() { const t = useWorkOrders(); handle = { data: t[0], addNote: t[18], updateNote: t[19] }; return null; }
  const root = createRoot(dom.window.document.getElementById('probe'));
  root.render(React.createElement(Probe));
  await tick();

  const mine = () => scratchpadNotes(handle.data.notes);
  handle.addNote({ body: 'the older one' });
  await new Promise(r => setTimeout(r, 5));   // distinct ts, so order is not an id tiebreak
  handle.addNote({ body: 'the newer one' });
  await tick();
  const older = mine().find(n => n.body === 'the older one');
  ok('store: the composer payload { body } is a complete scratchpad note',
    !!older && older.woId === null && Object.keys(older.flags).length === 0, JSON.stringify(older));
  ok('store: two jottings, newest first',
    mine().map(n => n.body).join('|') === 'the newer one|the older one', mine().map(n => n.body).join('|'));

  const ts0 = older.ts;
  await new Promise(r => setTimeout(r, 5));
  handle.updateNote(older.id, { body: 'the older one, revised' });
  await tick();
  const after = handle.data.notes.find(n => n.id === older.id);
  ok('store: a { body } patch actually changes the body', after.body === 'the older one, revised', after.body);
  ok('store: a { body } patch PRESERVES ts (journal position is written-at)',
    after.ts === ts0, String(after.ts) + ' vs ' + String(ts0));
  ok('store: a { body } patch preserves flags and woId -- no task flag appears',
    Object.keys(after.flags).length === 0 && after.woId === null,
    JSON.stringify(after.flags) + ' ' + String(after.woId));
  ok('store: a { body } patch bumps updated', after.updated > ts0, String(after.updated) + ' vs ' + String(ts0));
  ok('store: the edited note does NOT jump to the top of the scratchpad',
    mine().map(n => n.body).join('|') === 'the newer one|the older one, revised',
    mine().map(n => n.body).join('|'));
  ok('store: the edited note is still IN the scratchpad (no flag was added)',
    mine().length === 2, String(mine().length));

  dom.window.dispatchEvent(new dom.window.Event('beforeunload'));   // drain the S2 note debounce
  await tick();
  root.unmount();
  closeDom(dom);
}

// ───────────── E. the binder: tabs, Journal, quick-nav, selection ────────────
// Admin S3b rebuilt the module's shell. The pad is the tab, the sub-modules are
// binder tabs, and the retired backlog rail came back as a MERGED pinned +
// undated-task quick-nav in the Journal.
//
// The Scratchpad pane is never unmounted -- inactive tabs hide it with
// display:none -- so a raw querySelectorAll would see rows that are on screen
// only in the DOM sense. `vis()` below filters on the inline display, which is
// exactly the mechanism under test; it is not a workaround.

async function binderChecks() {
  stored = { orders: [], presets: [], inboxes: [], notes: [], settings: {} };
  const dom = freshDom();
  const { React, createRoot, ScheduleModule, PAD_IDLE_MS } = bundle('admin-s3-mount-entry', [
    "import React from 'react';",
    "import { createRoot } from 'react-dom/client';",
    "import { ScheduleModule, PAD_IDLE_MS } from './src/schedule.jsx';",
    "export { React, createRoot, ScheduleModule, PAD_IDLE_MS };",
  ]);
  const idle = async () => { await new Promise(r => setTimeout(r, PAD_IDLE_MS + 60)); await tick(); };

  const edits = [], openedWO = [], openedMap = [];
  const notes = [
    normalizeNote({ body: 'newest jotting', ts: 900 }, 'j-pad-new'),
    normalizeNote({ body: 'older jotting', ts: 100 }, 'j-pad-old'),
    normalizeNote({ kind: 'task', title: 'Call vendor', date: null, done: false, ts: 500 }, 'j-task'),
    normalizeNote({ body: 'pinned policy note', pinned: true, ts: 700 }, 'j-pin'),
    normalizeNote({ kind: 'task', title: 'Chase the permit', date: null, done: false, pinned: true, ts: 600 }, 'j-both'),
    normalizeNote({ body: 'tenant called back', woId: 'WO-9', ts: 800 }, 'j-wo'),
  ];

  const container = dom.window.document.getElementById('probe');
  const root = createRoot(container);
  root.render(React.createElement(ScheduleModule, {
    orders: [], techs: ['Alice'], statusColors: {}, statusTags: {},
    tech: 'ALL', setTech: () => {},
    focus: null, onClearFocus: () => {},
    onOpenWO: (id) => { openedWO.push(id); },
    onOpenMaps: (id) => { openedMap.push(id); },
    notes,
    onAddNote: (rec) => { edits.push(['<MINT>', rec]); return 'minted-b'; },
    onUpdateNote: (id, patch) => { edits.push([id, patch]); },
  }));
  await tick();

  const vis = (el) => {
    let n = el;
    while (n && n !== container) { if (n.style && n.style.display === 'none') return false; n = n.parentElement; }
    return true;
  };
  const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  const press = (el, key, shift) => el.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', { key, shiftKey: !!shift, bubbles: true }));
  const typeInto = (el, v) => {
    const desc = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value');
    desc.set.call(el, v);
    el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  };
  const byLabel = (l) => Array.from(container.querySelectorAll('button')).find(b => b.textContent.trim() === l);
  // J1 left the Journal with ONE filter, on the rail (the body Seg retired), and
  // its buttons read "glyph word", so navBtn matches the WORD. jAside is the
  // visible aside, which on this tab is the rail.
  const jAside = () => Array.from(container.querySelectorAll('aside')).filter(vis)[0];
  const navBtn = (l) => Array.from(jAside().querySelectorAll('button'))
    .find(b => b.textContent.trim().split(' ').pop() === l);
  const rows = () => Array.from(container.querySelectorAll('div[title]')).filter(vis);
  const rowTitles = () => rows().map(d => d.getAttribute('title'));
  const rowByTitle = (t) => rows().find(d => d.getAttribute('title') === t);
  // J1 INVERTED the Journal: the list lives on the RAIL and the main pane holds
  // the note, so a note is on screen once, not twice, and navRows is the list.
  const navRows = () => (jAside() ? Array.from(jAside().querySelectorAll('div[title]')) : []);
  const navTitles = () => navRows().map(d => d.getAttribute('title'));
  // S5: the quick-nav WORD markers were retired when padRow gained derived flag
  // dots, so the marker is now the glyph and its colour, not the word.
  const marksOf = (t) => {
    const r = navRows().find(d => d.getAttribute('title') === t);
    return r ? Array.from(r.querySelectorAll('span')).map(s => s.textContent.trim())
      .filter(x => x === '⚑' || x === '✓') : ['<no quick-nav row>'];
  };
  // The pad is identified by its placeholder; the journal editor is the other
  // textarea. Never by index, which would silently follow a DOM reorder.
  const pad = () => Array.from(container.querySelectorAll('textarea'))
    .find(t => (t.placeholder || '').indexOf('Start writing') === 0);
  const jPad = () => Array.from(container.querySelectorAll('textarea'))
    .find(t => (t.placeholder || '').indexOf('Start writing') !== 0);

  // [1] the binder itself
  for (const label of ['Scratchpad', 'Journal', 'Calendar', 'Contacts']) {
    ok('binder: tab "' + label + '" exists', !!byLabel(label));
  }
  ok('binder: lands on Scratchpad with the pad focused and live',
    !!pad() && dom.window.document.activeElement === pad(),
    String(dom.window.document.activeElement && dom.window.document.activeElement.tagName));
  // scratchpadNotes = zero flags AND no woId, so the WO-linked note is out and
  // the pinned-but-unflagged one is in. Newest first.
  ok('binder: the Scratchpad column shows the jottings only, newest first',
    rowTitles().join('|') === 'newest jotting|pinned policy note|older jotting',
    rowTitles().join('|'));
  ok('binder: no calendar chrome on the Scratchpad tab',
    !byLabel('Today') && !container.querySelector('select'));

  // [2] JOURNAL body: every note, newest first, jottings included
  click(byLabel('Journal')); await tick();
  // J1: the every-note list MOVED from the main pane to the rail's All filter.
  ok('journal: body lists EVERY note, newest first, jottings included',
    navTitles().join('|')
      === 'newest jotting|tenant called back|pinned policy note|Chase the permit|Call vendor|older jotting',
    navTitles().join('|'));

  // [3] QUICK-NAV: pinned AND undated tasks, merged, each marked
  ok('quick-nav: a pinned note is marked Pinned', marksOf('pinned policy note').join(',') === '⚑',
    marksOf('pinned policy note').join(','));
  ok('quick-nav: an undated task is marked Task', marksOf('Call vendor').join(',') === '✓',
    marksOf('Call vendor').join(','));
  ok('quick-nav: a note that is BOTH carries both markers', marksOf('Chase the permit').join(',') === '✓,⚑',
    marksOf('Chase the permit').join(','));
  ok('quick-nav: a note that is BOTH appears exactly ONCE (merged, not concatenated)',
    navTitles().filter(t => t === 'Chase the permit').length === 1, navTitles().join('|'));
  // RETIRED by J1, not weakened: the merged pinned+tasks list is gone, All now
  // lists every note by design, and this case's two halves are asserted verbatim
  // by the Pinned and Tasks filter cases immediately below.

  // [4] the marker filter
  click(navBtn('Pinned')); await tick();
  ok('quick-nav: the Pinned filter keeps only pinned entries',
    navTitles().join('|') === 'pinned policy note|Chase the permit', navTitles().join('|'));
  click(navBtn('Tasks')); await tick();
  // Same SET as before; the order is backlogNotes' own (open before done, then
  // oldest first), which J1 keeps deliberately instead of the journal sort.
  ok('quick-nav: the Tasks filter keeps only undated tasks',
    navTitles().join('|') === 'Call vendor|Chase the permit', navTitles().join('|'));
  click(navBtn('All')); await tick();

  // The Journal's Jottings Seg RETIRED with J1 (one filter, on the rail), so the
  // case that drove it is gone with it. The jottings category itself is still
  // proved above, on the Scratchpad column that owns it.

  // [5] selection opens the editor in the main pane
  click(rowByTitle('tenant called back')); await tick();
  // J1: selection no longer SWAPS the rail away -- the rail is permanent and the
  // editor opens in the main pane, so the claim is now "editor opens, rail stays".
  ok('journal: selecting a row opens the note editor and the rail stays',
    !!jPad() && jPad().value === 'tenant called back' && navRows().length > 0,
    String(jPad() && jPad().value) + ' rail=' + navRows().length);
  ok('journal: a WO-linked note offers the WO and Map jumps',
    !!byLabel('WO-9') && !!byLabel('Map'));
  click(byLabel('WO-9')); await tick();
  click(byLabel('Map')); await tick();
  ok('journal: the WO jump reuses onOpenWO', openedWO.join(',') === 'WO-9', openedWO.join(','));
  ok('journal: the map jump reuses onOpenMaps', openedMap.join(',') === 'WO-9', openedMap.join(','));

  typeInto(jPad(), 'tenant called back, twice'); await tick();
  press(jPad(), 'Enter'); await tick();
  ok('journal: Enter writes NOTHING (it is a newline here too, not a save key)',
    edits.length === 0, JSON.stringify(edits));
  ok('journal: Enter neither clears nor deselects the panel',
    jPad() && jPad().value === 'tenant called back, twice', String(jPad() && jPad().value));
  press(jPad(), 'Enter', true); await tick();
  ok('journal: Shift+Enter writes nothing either', edits.length === 0, JSON.stringify(edits));
  await idle();
  ok('journal: an idle pause commits through onUpdateNote, body and nothing else',
    edits.length === 1 && edits[0][0] === 'j-wo'
      && JSON.stringify(Object.keys(edits[0][1])) === '["body"]'
      && edits[0][1].body === 'tenant called back, twice', JSON.stringify(edits));

  jPad().focus();
  typeInto(jPad(), 'tenant called back, three times'); await tick();
  jPad().blur(); await tick();
  ok('journal: blur flushes at once, no idle wait',
    edits.length === 2 && edits[1][1].body === 'tenant called back, three times', JSON.stringify(edits));
  jPad().focus(); jPad().blur(); await tick();
  ok('journal: a second blur with unchanged text writes nothing more', edits.length === 2, JSON.stringify(edits));

  click(byLabel('Back')); await tick();
  ok('journal: Back closes the editor, the rail is untouched', !jPad() && navRows().length > 0,
    String(navRows().length));

  // [6] THE SWITCH-MID-WRITE CASE. The worst bug available in this design is a
  // timer armed for note A firing after the panel has rebound to note B, writing
  // A's text onto B's id. Arm a write on A, switch to B before the timer fires.
  click(rowByTitle('pinned policy note')); await tick();            // A = j-pin
  typeInto(jPad(), 'pinned policy note, amended'); await tick();    // timer armed
  const beforeSwitch = edits.length;
  click(rowByTitle('Call vendor')); await tick();                   // B = j-task
  ok('journal: switching entries mid-write FLUSHES the entry being left, onto ITS id',
    edits.length === beforeSwitch + 1 && edits[beforeSwitch][0] === 'j-pin'
      && edits[beforeSwitch][1].body === 'pinned policy note, amended',
    JSON.stringify(edits.slice(beforeSwitch)));
  ok('journal: the panel rebound to the new entry, showing ITS text',
    !!jPad() && jPad().value === 'Call vendor',
    String(jPad() && jPad().value));
  await idle();
  ok('journal: the armed timer never fired onto the NEW entry id',
    edits.length === beforeSwitch + 1, JSON.stringify(edits.slice(beforeSwitch)));

  // [7] Escape FLUSHES, then deselects. With autosave there is no unsaved state
  // to abandon, so a silently discarded tail would be data loss.
  click(rowByTitle('older jotting')); await tick();
  typeInto(jPad(), 'older jotting, via the journal'); await tick();
  const beforeEsc = edits.length;
  press(jPad(), 'Escape'); await tick();
  ok('journal: Escape flushes before deselecting (no silent data loss)',
    edits.length === beforeEsc + 1 && edits[beforeEsc][0] === 'j-pad-old'
      && edits[beforeEsc][1].body === 'older jotting, via the journal',
    JSON.stringify(edits.slice(beforeEsc)));
  ok('journal: Escape then closes the editor, the rail is untouched',
    !jPad() && navRows().length > 0, String(navRows().length));

  // The unchanged-text guard still holds: browsing costs no writes.
  const beforeBrowse = edits.length;
  click(rowByTitle('newest jotting')); await tick();
  jPad().focus(); jPad().blur(); await tick();
  ok('journal: blurring an UNCHANGED note writes nothing (no browse-time write storm)',
    edits.length === beforeBrowse, JSON.stringify(edits.slice(beforeBrowse)));
  click(byLabel('Back')); await tick();

  // [8] the pad is never unmounted: text mid-autosave-window survives a tab trip
  click(byLabel('Scratchpad')); await tick();
  typeInto(pad(), 'half typed, mid autosave window'); await tick();
  click(byLabel('Calendar')); await tick();
  ok('calendar: the tab owns the calendar chrome (Today + tech dropdown)',
    !!byLabel('Today') && !!byLabel('Week') && !!container.querySelector('select'));
  ok('calendar: no backlog rail anywhere', container.textContent.indexOf('Backlog') === -1);
  // NOTE ON SCOPE: this proves the pad is never UNMOUNTED, which is the A3
  // property under test. In a real browser a tab click also blurs the pad, so
  // writePad would have flushed the text on the way out; jsdom's synthetic click
  // fires no blur, which is what leaves the pad mid-autosave-window and readable
  // here. Either way nothing typed is lost -- that is the point of autosave.
  ok('pad: STILL MOUNTED behind another tab, draft intact',
    !!pad() && pad().value === 'half typed, mid autosave window' && !vis(pad()), String(pad() && pad().value));
  click(byLabel('Contacts')); await tick();
  ok('contacts: an empty state naming S7', container.textContent.indexOf('S7') !== -1,
    container.textContent.slice(-200));
  click(byLabel('Scratchpad')); await tick();
  ok('pad: the draft survived the round trip and the cursor came back',
    pad().value === 'half typed, mid autosave window' && dom.window.document.activeElement === pad(),
    pad().value);

  root.unmount();
  closeDom(dom);
}

// ─────────────────────────────────── report ──────────────────────────────────

(async () => {
  await hookChecks();
  await composerChecks();
  await unmountFlushCheck();
  await storeChecks();
  await binderChecks();
  console.log('admin S3 -- scratchpad selector, lastModule migration, mounted composer');
  console.log('======================================================================');
  let pass = 0, fail = 0;
  for (const r of results) {
    if (r.ok) { pass++; console.log('  ok   ' + r.name); }
    else      { fail++; console.log('  FAIL ' + r.name + '\n      ' + r.err); }
  }
  console.log('');
  console.log('Total: ' + (pass + fail) + ' | Pass: ' + pass + ' | Fail: ' + fail);
  process.exitCode = fail > 0 ? 1 : 0;
})().catch(e => { console.error('THREW: ' + ((e && e.stack) || e)); process.exitCode = 1; });
