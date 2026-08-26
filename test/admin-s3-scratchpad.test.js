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

// ───────────── C. the real ScheduleModule: the mounted composer ──────────────

async function composerChecks() {
  stored = { orders: [], presets: [], inboxes: [], notes: [], settings: {} };
  const dom = freshDom();
  const { React, createRoot, ScheduleModule } = bundle('admin-s3-mount-entry', [
    "import React from 'react';",
    "import { createRoot } from 'react-dom/client';",
    "import { ScheduleModule } from './src/schedule.jsx';",
    "export { React, createRoot, ScheduleModule };",
  ]);

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
    focus: null, onClearFocus: () => {}, onOpenWO: () => {},
    notes,
    onAddNote: (rec) => { added.push(rec); },
    onUpdateNote: (id, patch) => { edits.push([id, patch]); },
    onDeleteNote: () => {},
  }));
  render(); await tick();

  const pad = () => container.querySelector('textarea');
  // React installs its own value setter on the node; assigning .value directly
  // never reaches onChange. Call the prototype setter, then fire input.
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

  ok('composer: a textarea is mounted with no interaction at all', !!pad());
  ok('composer: it has focus on module entry',
    !!pad() && dom.window.document.activeElement === pad(), String(dom.window.document.activeElement && dom.window.document.activeElement.tagName));

  // The default body view is the scratchpad, newest first, task note excluded.
  const rowTitles = Array.from(container.querySelectorAll('div[title]')).map(d => d.getAttribute('title'));
  ok('scratchpad view is the DEFAULT body view, newest first',
    rowTitles.indexOf('newest jotting') === 0 && rowTitles.indexOf('older jotting') === 1, rowTitles.join(','));
  ok('scratchpad view does not list the task note (it stays in the backlog)',
    rowTitles.indexOf('Call vendor') > 1 || rowTitles.indexOf('Call vendor') === -1, rowTitles.join(','));

  // POSITIVE CONTROL FIRST. Without it, every "wrote nothing" below would also
  // pass against a composer that does not work at all.
  typeInto(pad(), 'buy a new torch'); await tick();
  press(pad(), 'Enter'); await tick();
  ok('composer: Enter writes the note, body only',
    added.length === 1 && added[0].body === 'buy a new torch' && !added[0].kind, JSON.stringify(added));
  ok('composer: saving clears the draft', pad().value === '', JSON.stringify(pad().value));
  ok('composer: focus stays in the composer after an Enter save',
    dom.window.document.activeElement === pad(), String(dom.window.document.activeElement && dom.window.document.activeElement.tagName));

  // Shift+Enter must NOT save (it inserts a newline instead).
  typeInto(pad(), 'line one'); await tick();
  press(pad(), 'Enter', true); await tick();
  ok('composer: Shift+Enter does NOT save', added.length === 1, JSON.stringify(added));
  typeInto(pad(), ''); await tick();

  // THE SPEC CASE: whitespace-only writes nothing, on either save path.
  const before = added.length;
  typeInto(pad(), '   \n\t  '); await tick();
  press(pad(), 'Enter'); await tick();
  ok('composer: a whitespace-only Enter writes NOTHING', added.length === before, JSON.stringify(added.slice(before)));
  pad().blur(); await tick();
  ok('composer: a whitespace-only blur writes NOTHING', added.length === before, JSON.stringify(added.slice(before)));

  // Blur saves a real body.
  pad().focus();
  typeInto(pad(), 'boss wants the Cecil invoice chased'); await tick();
  pad().blur(); await tick();
  ok('composer: blur writes the note',
    added.length === before + 1 && added[before].body === 'boss wants the Cecil invoice chased',
    JSON.stringify(added.slice(before)));
  ok('composer: blur-save cleared the draft, so a later blur cannot double-write', pad().value === '');
  pad().blur(); await tick();
  ok('composer: a second blur after a save writes nothing more', added.length === before + 1, JSON.stringify(added.slice(before)));

  // ── editing a saved jotting happens IN THE COMPOSER, never in EntryModal ──
  // EntryModal's form defaults an unflagged note to kind 'task', so opening a
  // scratchpad row there would convert it into a backlog task on save. These
  // checks are what hold that door shut.
  const addedBeforeEdit = added.length;

  click(row('older jotting')); await tick();
  ok('edit: clicking a row loads its body into the composer',
    pad().value === 'older jotting', JSON.stringify(pad().value));
  ok('edit: clicking a row opens NO modal (EntryModal never renders)',
    container.textContent.indexOf('Edit entry') === -1 && container.textContent.indexOf('New entry') === -1,
    container.textContent.slice(0, 200));
  ok('edit: the composer is focused after a row click',
    dom.window.document.activeElement === pad());

  typeInto(pad(), 'older jotting, revised'); await tick();
  press(pad(), 'Enter'); await tick();
  ok('edit: saving calls onUpdateNote with the clicked row id',
    edits.length === 1 && edits[0][0] === 's-old', JSON.stringify(edits));
  ok('edit: saving does NOT call onAddNote (no duplicate note)',
    added.length === addedBeforeEdit, JSON.stringify(added.slice(addedBeforeEdit)));
  ok('edit: the patch carries body and NOTHING else -- no kind, so no task flag',
    edits.length === 1 && JSON.stringify(Object.keys(edits[0][1])) === '["body"]'
      && edits[0][1].body === 'older jotting, revised', JSON.stringify(edits));
  ok('edit: the draft cleared after the update', pad().value === '');

  // The edit target must be released, or the next jotting would overwrite it.
  typeInto(pad(), 'a brand new jotting'); await tick();
  press(pad(), 'Enter'); await tick();
  ok('edit: the NEXT jotting after an edit calls onAddNote, not onUpdateNote',
    added.length === addedBeforeEdit + 1 && added[added.length - 1].body === 'a brand new jotting'
      && edits.length === 1, JSON.stringify({ added: added.slice(addedBeforeEdit), edits }));

  // Escape abandons an edit without writing. It is the only way out, since blur saves.
  click(row('newest jotting')); await tick();
  ok('edit: a second row loads too', pad().value === 'newest jotting', JSON.stringify(pad().value));
  typeInto(pad(), 'newest jotting, mangled'); await tick();
  press(pad(), 'Escape'); await tick();
  ok('edit: Escape clears the draft', pad().value === '', JSON.stringify(pad().value));
  ok('edit: Escape wrote nothing',
    edits.length === 1 && added.length === addedBeforeEdit + 1,
    JSON.stringify({ edits, added: added.slice(addedBeforeEdit) }));
  pad().blur(); await tick();
  ok('edit: a blur after Escape still writes nothing (the edit target was released)',
    edits.length === 1 && added.length === addedBeforeEdit + 1,
    JSON.stringify({ edits, added: added.slice(addedBeforeEdit) }));

  // Whitespace-only must not BLANK an existing note. It refuses the write and
  // leaves the draft as typed, with the edit still open.
  pad().focus();
  click(row('older jotting')); await tick();
  typeInto(pad(), '   \t '); await tick();
  press(pad(), 'Enter'); await tick();
  ok('edit: a whitespace-only submit does NOT blank the note being edited',
    edits.length === 1, JSON.stringify(edits));
  ok('edit: a refused whitespace submit leaves the draft exactly as typed',
    pad().value === '   \t ', JSON.stringify(pad().value));
  typeInto(pad(), 'recovered after the refusal'); await tick();
  press(pad(), 'Enter'); await tick();
  ok('edit: the edit stayed OPEN through the refusal (still updates, never adds)',
    edits.length === 2 && edits[1][0] === 's-old' && edits[1][1].body === 'recovered after the refusal'
      && added.length === addedBeforeEdit + 1,
    JSON.stringify({ edits, added: added.slice(addedBeforeEdit) }));

  root.unmount();
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

// ─────────────────────────────────── report ──────────────────────────────────

(async () => {
  await hookChecks();
  await composerChecks();
  await storeChecks();
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
