// Admin S4 -- "Flags". Three sections:
//   A. PURE: normalizeNote / normalizeFlags from the SHIPPED src/orders-logic.js
//      via the esbuild bridge. The ONE schema change this slice makes (`po` on
//      the parts flag), that an old parts record loads with po null, and that
//      the flags stay INDEPENDENT -- setting one never drops another.
//   B. MOUNT (jsdom): the REAL ScheduleModule with stub callbacks. The flag row
//      exists, has no contact button (ruling 3 defers it to S7), each modal
//      writes the patch its flag owns, and the parts modal's ship-to address
//      PREFILLS from the linked WO while still storing whatever the user leaves
//      in the field (ruling 2).
//   C. MOUNT + REAL STORE (jsdom): the REAL ScheduleModule over the REAL
//      useWorkOrders. Ticking a task done off its calendar chip writes
//      flags.task.done and does NOT move `ts`; deleting a note removes exactly
//      that note; and the load-bearing invariant -- a flag write on the note an
//      editor owns FLUSHES that editor first, and a delete RELEASES it, so no
//      typed text is ever left addressed to a note that no longer exists.
//
// KNOWN LIMITS, stated up front:
//  - window.storage is a stub. This proves what the hook LOADS and WRITES, not
//    that Electron's storage layer keeps it.
//  - jsdom has NO layout and NO CSS. Nothing here is a claim about appearance;
//    hover tooltips are asserted as `title` attributes, which is what a tooltip
//    IS in this app, not as rendered pixels.
//  - Deliberately NO pretendToBeVisual: its per-window rAF loop on a libuv
//    handle aborts intermittently on Windows (UV_HANDLE_CLOSING) with every
//    assertion green. rAF is shimmed here, every JSDOM is closed, App intervals
//    are cleared explicitly (a bundle's bare setInterval resolves to NODE's
//    global, so window.close() cannot reap them) and the file sets
//    process.exitCode instead of exiting.
//
// Run:  node test/admin-s4-flags.test.js
// Exit code: 0 = all green, 1 = at least one fail.

'use strict';

const assert = require('assert');
const path = require('path');
const Module = require('module');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');
const { loadEsm } = require('./_load.js');

const ROOT = path.resolve(__dirname, '..');
const { normalizeNote, itinTodayStr } = loadEsm('src/orders-logic.js');

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
  console.error('WATCHDOG: admin-s4-flags did not finish in 60s');
  process.exit(1);
}, 60000);
watchdog.unref();

// ───────────────────────── A. the schema (pure) ──────────────────────────────

test('parts: `po` survives a normalizeNote round-trip', () => {
  const n = normalizeNote({ body: 'x', flags: { parts: { part: 'igniter', po: 'PO-77' } } }, 'a1');
  assert.strictEqual(n.flags.parts.po, 'PO-77');
  const again = normalizeNote(JSON.parse(JSON.stringify(n)), 'a1');
  assert.strictEqual(again.flags.parts.po, 'PO-77');
  assert.strictEqual(again.flags.parts.part, 'igniter');
});

test('parts: a record written BEFORE S4 (no po key) loads with po null', () => {
  const legacy = { body: 'x', flags: { parts: { part: 'blower', status: 'ordered', distributor: 'Ferguson', address: '9 Elm St' } } };
  const n = normalizeNote(legacy, 'a2');
  assert.strictEqual(n.flags.parts.po, null, 'po should be null, not undefined');
  assert.ok('po' in n.flags.parts, 'the key must be PRESENT so the JSON round-trip is stable');
  assert.strictEqual(n.flags.parts.address, '9 Elm St', 'the four old fields must be untouched');
});

test('parts: all five fields are present on a set flag, null never undefined', () => {
  const n = normalizeNote({ body: 'x', flags: { parts: {} } }, 'a3');
  assert.deepStrictEqual(Object.keys(n.flags.parts).sort(),
    ['address', 'distributor', 'part', 'po', 'status']);
  assert.ok(Object.values(n.flags.parts).every(v => v === null));
});

test('flags are INDEPENDENT: adding a reminder does not clear the calendar', () => {
  const base = normalizeNote({ body: 'Remind Cecil about the invoice', flags: { calendar: { date: '2026-09-02', start: '09:00', end: null } } }, 'a4');
  // Exactly what the module's setFlag builds: spread what is there, add one key.
  const next = normalizeNote({ ...base, flags: { ...base.flags, reminder: { at: 1770000000000 } } }, 'a4');
  assert.deepStrictEqual(next.flags.calendar, { date: '2026-09-02', start: '09:00', end: null });
  assert.deepStrictEqual(next.flags.reminder, { at: 1770000000000 });
});

test('flags are INDEPENDENT: a note can be task AND calendar AND parts AND journal at once', () => {
  const n = normalizeNote({
    body: 'order the blower, fit it Tuesday',
    flags: {
      task: { done: false, due: '2026-09-02' },
      calendar: { date: '2026-09-02', start: '13:00' },
      parts: { part: 'blower', po: 'PO-9' },
      journal: true,
    },
  }, 'a5');
  assert.deepStrictEqual(Object.keys(n.flags).sort(), ['calendar', 'journal', 'parts', 'task']);
});

test('removing one flag leaves the others alone', () => {
  const base = normalizeNote({ body: 'x', flags: { task: { done: true, due: null }, journal: true, parts: { part: 'p' } } }, 'a6');
  const flags = { ...base.flags };
  delete flags.task;
  const next = normalizeNote({ ...base, flags }, 'a6');
  assert.deepStrictEqual(Object.keys(next.flags).sort(), ['journal', 'parts']);
  assert.strictEqual(next.flags.parts.part, 'p');
});

test('the contact flag is still TOLERATED by the schema (deferred to S7, not deleted)', () => {
  const n = normalizeNote({ body: 'x', flags: { contact: { contactId: 'c-1' } } }, 'a7');
  assert.deepStrictEqual(n.flags.contact, { contactId: 'c-1' });
});

// ───────────────────────────── shared jsdom rig ──────────────────────────────

// The bundle's bare setInterval resolves to NODE's global, not the jsdom
// window, so window.close() cannot reap the App's minute tick and the loop
// never drains. Wrap setInterval ONLY -- wrapping setTimeout would abandon this
// file's own await/flush timers.
const openIntervals = [];
const realSetInterval = global.setInterval;
let stored = {};

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
    set: () => Promise.resolve(),
  };
  return dom;
}

let bundleText = null;
function bundle() {
  if (!bundleText) {
    const out = esbuild.buildSync({
      stdin: {
        contents: [
          "import React from 'react';",
          "import { createRoot } from 'react-dom/client';",
          "import { ScheduleModule, PAD_IDLE_MS } from './src/schedule.jsx';",
          "import { ConfirmHost } from './src/app.jsx';",
          "import { useWorkOrders } from './src/data.js';",
          "export { React, createRoot, ScheduleModule, PAD_IDLE_MS, ConfirmHost, useWorkOrders };",
        ].join('\n'),
        resolveDir: ROOT, sourcefile: 'admin-s4-entry.jsx', loader: 'jsx',
      },
      bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
      loader: { '.js': 'jsx', '.jsx': 'jsx' }, write: false, logLevel: 'silent',
    });
    bundleText = out.outputFiles[0].text;
  }
  const abs = path.join(ROOT, 'admin-s4-entry.jsx');
  const m = new Module(abs, module);
  m.filename = abs;
  m.paths = Module._nodeModulePaths(ROOT);
  m._compile(bundleText, abs);
  return m.exports;
}

const tick = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setTimeout(r, 0)); };

function closeDom(dom) {
  try { dom.window.close(); } catch (e) { /* already closed */ }
  while (openIntervals.length) {
    try { global.clearInterval(openIntervals.pop()); } catch (e) { /* already cleared */ }
  }
  global.setInterval = realSetInterval;
}

// DOM helpers shared by both mounted sections. The flag row is located by the
// one button only IT owns ("Delete this note"), which is what keeps the
// ambiguous labels -- Journal and Calendar are also BINDER TAB labels --
// unambiguous without adding test hooks to shipped code.
// S5 S3 turned the flag row into icons. Each flag's title has a SET and an
// UNSET form, so a button is addressed by whichever of its two titles it wears.
const FLAG_TITLES = {
  Task: ['Task', 'Make this a task'],
  Remind: ['Reminder at', 'Set a reminder'],
  Calendar: ['On the calendar', 'Put this on a day'],
  Parts: ['Parts order:', 'Record a parts order'],
  Journal: ['Starred into the journal', 'Star this into the journal'],
  'Link WO': ['Linked to', 'Link a work order'],
  Delete: ['Delete this note'],
};

function domKit(dom, container) {
  const all = (sel) => Array.from(container.querySelectorAll(sel));
  const kit = {
    pad: () => container.querySelector('textarea'),
    click: (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })),
    typeInto: (el, v) => {
      const proto = el.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
      el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    },
    // A real user click: jsdom runs the checkbox activation behaviour (flip
    // checked, then dispatch), and React binds a checkbox onChange to the click
    // event -- so this is one path, not a synthetic double-fire.
    row: (t) => all('div[title]').find(d => d.getAttribute('title') === t),
    // JOURNAL-BODY row lookup. DRIFT this repairs: the scratchpad aside is
    // always mounted (display:none off its tab) and precedes the journal body
    // in DOM order, so a container-wide div[title] search returned the PAD's
    // copy of the same jotting; the click then ran editInComposer and bound the
    // pad, and the whole journal block below silently exercised the pad editor
    // while its comment claimed the pad was left unbound. Every list that is
    // not the journal body sits inside an <aside>, so excluding those is the
    // whole fix -- same trick journalAside() uses from the other end.
    jrow: (t) => all('div[title]').filter(d => !d.closest('aside'))
      .find(d => d.getAttribute('title') === t),
    btn: (label) => all('button').find(b => b.textContent.trim() === label),
    // The WO picker's rows carry the address after the number, so they are
    // matched on the prefix rather than the whole label.
    btnStarts: (t) => all('button').find(b => b.textContent.trim().startsWith(t)),
    // The binder tabs share their labels with flag buttons (Journal, Calendar),
    // so they are addressed by their own title instead.
    tab: (name) => container.querySelector('button[title="' + ({
      scratchpad: 'Write first, decide later', journal: 'Every note, newest first',
      calendar: 'Scheduled jobs and dated notes', contacts: 'Clients, distributors and PMs',
    })[name] + '"]'),
    esc: (el) => el.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    flagRows: () => all('button[title="Delete this note"]').map(b => b.parentElement),
    // Two panels render a flag row: the PAD (index 0) and the Journal editor
    // (last, bound to the note just clicked). Since S5 S3 the pad's toolbar is
    // mounted UNCONDITIONALLY -- that is what mint-then-flag needs -- so index 0
    // is always the pad, where it used to appear only once padNote existed.
    // Defaulting to index 0 silently aimed every flag click after the first
    // `row()` at the WRONG note -- the Calendar modal then opened on an
    // unflagged jotting, so no "Remove flag" existed and the click threw. Default
    // to the LAST row: it is the editor the preceding row() click actually bound.
    // S5 S3: the buttons are ICONS, so the title is the only stable handle --
    // it is the sole place the flag name still appears, in both states.
    flagBtn: (label, which) => {
      const rows = kit.flagRows();
      const r = which == null ? rows[rows.length - 1] : rows[which];
      const pre = FLAG_TITLES[label] || [label];
      return r ? Array.from(r.querySelectorAll('button'))
        .find(b => pre.some(t => (b.getAttribute('title') || '').indexOf(t) === 0)) : null;
    },
    field: (labelText) => {
      const l = all('label').find(x => x.textContent.trim().startsWith(labelText));
      return l ? l.querySelector('input') : null;
    },
  };
  return kit;
}

// ─────────── B. the real ScheduleModule: the flag row and its modals ─────────

async function flagRowChecks() {
  stored = { orders: [], presets: [], inboxes: [], notes: [], settings: {} };
  const dom = freshDom();
  const { React, createRoot, ScheduleModule } = bundle();

  const edits = [];
  const orders = [
    { id: 'WO-1', address: '9 Elm St', city: 'Trenton', status: 'New', tech: 'Alice' },
    { id: 'WO-2', address: '400 Oak Ave', city: 'Camden', status: 'New', tech: 'Bob' },
  ];
  const notes = [
    normalizeNote({ body: 'plain jotting', ts: 900 }, 's-plain'),
    // The linked note carries a woId, which is what the parts prefill reads. It
    // is set on the RECORD, not in flags: the WO link is a link, not a flag key.
    normalizeNote({ body: 'linked jotting', ts: 800, woId: 'WO-1' }, 's-linked'),
    normalizeNote({ body: 'already dated', ts: 700, flags: { calendar: { date: '2026-09-02', start: '09:00' } } }, 's-cal'),
  ];

  const container = dom.window.document.getElementById('probe');
  const root = createRoot(container);
  root.render(React.createElement(ScheduleModule, {
    orders, techs: ['Alice', 'Bob'], statusColors: {}, statusTags: {},
    tech: 'ALL', setTech: () => {}, focus: null, onClearFocus: () => {},
    onOpenWO: () => {}, onOpenMaps: () => {},
    notes,
    onAddNote: () => 'minted', onUpdateNote: (id, patch) => edits.push([id, patch]), onDeleteNote: () => {},
  }));
  await tick();
  const k = domKit(dom, container);

  // Everything here runs on the JOURNAL tab, which is the one view that lists
  // EVERY note: a WO-linked note and a dated note are by definition not
  // jottings, so the scratchpad column could never reach them. The pad is left
  // unbound throughout, so exactly ONE flag row is ever mounted and the button
  // lookups stay unambiguous.
  k.click(k.tab('journal')); await tick();
  // S5 S3 SPLIT this case in two rather than let one count stand for both.
  // The half that survives on its merits: the JOURNAL editor still renders
  // nothing to flag until a note is bound, because the whole aside body is
  // gated on jNote. Scoped to that aside (the last one: the scratchpad aside is
  // always mounted and comes first in DOM order).
  // Both halves of the pair are scoped to that aside on purpose: nothing
  // selected means no journal flag row, selecting a note means exactly one. A
  // container-wide count would just encode "pad toolbar plus journal row".
  const journalAside = () => Array.from(container.querySelectorAll('aside')).pop();
  const journalFlagRows = () => journalAside().querySelectorAll('button[title="Delete this note"]').length;
  ok('flags: NO JOURNAL flag row until a note is selected (nothing selected = nothing to flag)',
    journalFlagRows() === 0, String(journalFlagRows()));
  // The half S3 deliberately reversed, stated outright so it reads as a
  // DECISION: an ungated pad toolbar is mint-then-flag's precondition, since a
  // flag click on unsaved text has to mint the note before it can flag it.
  ok('S3: the pad toolbar is mounted with nothing selected (mint-then-flag needs it)',
    k.flagRows().length === 1, String(k.flagRows().length));

  k.click(k.jrow('plain jotting')); await tick();
  ok('flags: selecting a note reveals its flag row', journalFlagRows() === 1, String(journalFlagRows()));

  // The SELECTED note's row is the last one, which is the same row flagBtn
  // defaults to. Never re-simplify this back to [0]: the subject of these
  // assertions was ALWAYS the selected note's row, and [0] only ever meant that
  // by accident of the pad row not existing yet. 'plain jotting' carries no
  // flags, so every title below is its unset form.
  const editorRow = () => k.flagRows()[k.flagRows().length - 1];
  const labels = Array.from(editorRow().querySelectorAll('button')).map(b => b.getAttribute('title'));
  ok('flags: the row ships task / reminder / calendar / parts / journal / WO link + delete',
    labels.join('|') === 'Make this a task|Set a reminder|Put this on a day|Record a parts order|'
      + 'Star this into the journal|Link a work order|Delete this note', labels.join('|'));
  ok('flags: there is NO contact button (ruling 3 defers contacts to S7)',
    labels.every(t => t.toLowerCase().indexOf('contact') === -1), labels.join('|'));
  ok('flags: every button carries a hover tooltip (a title attribute)',
    Array.from(editorRow().querySelectorAll('button')).every(b => (b.getAttribute('title') || '').length > 0),
    JSON.stringify(labels));

  // ── task ──
  k.click(k.flagBtn('Task')); await tick();
  ok('task: the button opens a small Task modal', container.textContent.indexOf('Due date (blank = backlog)') !== -1,
    container.textContent.slice(0, 200));
  k.typeInto(k.field('Due date'), '2026-09-04'); await tick();
  k.click(k.btn('Save')); await tick();
  ok('task: Save writes flags.task with the due date',
    edits.length === 1 && edits[0][0] === 's-plain'
      && JSON.stringify(edits[0][1]) === JSON.stringify({ flags: { task: { done: false, due: '2026-09-04' } } }),
    JSON.stringify(edits));
  ok('task: the patch carries flags and NOTHING else (ts and body are untouched)',
    JSON.stringify(Object.keys(edits[0][1])) === '["flags"]', JSON.stringify(edits[0][1]));
  ok('task: saving closes the modal', container.textContent.indexOf('Due date (blank = backlog)') === -1);

  // ── parts: an UNLINKED note prefills nothing ──
  edits.length = 0;
  k.click(k.flagBtn('Parts')); await tick();
  ok('parts: the modal has all five fields including the S4 PO number',
    !!k.field('Part') && !!k.field('Status') && !!k.field('PO / cost number')
      && !!k.field('Distributor') && !!k.field('Ship-to address'));
  ok('parts: an UNLINKED note prefills NOTHING',
    k.field('Ship-to address').value === '', JSON.stringify(k.field('Ship-to address').value));
  k.click(k.btn('Cancel')); await tick();
  ok('parts: Cancel writes nothing', edits.length === 0, JSON.stringify(edits));

  // ── the WO picker reuses orderMatchesQuery ──
  k.click(k.flagBtn('Link WO')); await tick();
  ok('wo link: the picker asks for a query before listing anything',
    container.textContent.indexOf('Type to search.') !== -1, container.textContent.slice(-200));
  k.typeInto(k.field('Search by WO number'), 'camden'); await tick();
  ok('wo link: the picker matches on ADDRESS/CITY, not just the WO number (orderMatchesQuery)',
    !!k.btnStarts('WO-2') && !k.btnStarts('WO-1'), container.textContent.slice(-300));
  k.click(k.btnStarts('WO-2')); await tick();
  ok('wo link: picking writes woId on the RECORD, not into flags',
    edits.length === 1 && JSON.stringify(edits[0][1]) === JSON.stringify({ woId: 'WO-2' }), JSON.stringify(edits));

  // ── parts: prefill from the linked WO (ruling 2) ──
  edits.length = 0;
  k.click(k.jrow('linked jotting')); await tick();
  // The flag button keeps the label "Link WO" even when linked -- deliberate,
  // see the comment at src/schedule.jsx:891: the jump row right below already
  // carries a button labelled with the number, and two same-labelled buttons
  // doing different things in one panel is a trap. So linkage shows in the
  // TITLE, and the NUMBER labels the jump button.
  ok('wo link: a linked note says so in the flag title, and the jump row carries the number',
    (k.flagBtn('Link WO') || {}).title === 'Linked to WO-1 - click to change' && !!k.btn('WO-1'),
    JSON.stringify([(k.flagBtn('Link WO') || {}).title, !!k.btn('WO-1')]));
  k.click(k.flagBtn('Parts')); await tick();
  ok('parts: the ship-to address PREFILLS from the linked work order',
    k.field('Ship-to address').value === '9 Elm St, Trenton', k.field('Ship-to address').value);
  ok('parts: the prefilled address is EDITABLE, not read-only',
    !k.field('Ship-to address').readOnly && !k.field('Ship-to address').disabled);

  // Ruling 2: whatever ends up in the field is what gets STORED, so the note
  // stays self-contained if the WO's address later changes.
  k.typeInto(k.field('Ship-to address'), 'c/o the shop, 12 Depot Rd'); await tick();
  k.typeInto(k.field('Part'), 'blower motor'); await tick();
  k.typeInto(k.field('PO / cost number'), 'PO-4412'); await tick();
  k.click(k.btn('Save')); await tick();
  ok('parts: the USER-TYPED address is what gets stored, not the WO address',
    edits.length === 1 && edits[0][1].flags.parts.address === 'c/o the shop, 12 Depot Rd',
    JSON.stringify(edits));
  ok('parts: the PO number is stored on the flag',
    edits[0][1].flags.parts.po === 'PO-4412', JSON.stringify(edits[0][1].flags.parts));

  // ── independence, through the real UI ──
  edits.length = 0;
  k.click(k.jrow('already dated')); await tick();
  k.click(k.flagBtn('Remind')); await tick();
  k.typeInto(k.field('Remind me at'), '2026-09-02T08:30'); await tick();
  k.click(k.btn('Save')); await tick();
  ok('independence: setting a reminder on a dated note KEEPS its calendar flag',
    edits.length === 1 && edits[0][1].flags.calendar
      && edits[0][1].flags.calendar.date === '2026-09-02'
      && typeof edits[0][1].flags.reminder.at === 'number',
    JSON.stringify(edits));

  edits.length = 0;
  k.click(k.flagBtn('Calendar')); await tick();
  ok('calendar: the modal seeds from the note it was opened on',
    k.field('Day') && k.field('Day').value === '2026-09-02', String(k.field('Day') && k.field('Day').value));
  k.click(k.btn('Remove flag')); await tick();
  ok('calendar: "Remove flag" drops ONLY the calendar key',
    edits.length === 1 && !edits[0][1].flags.calendar, JSON.stringify(edits));

  edits.length = 0;
  k.click(k.flagBtn('Journal')); await tick();
  ok('journal flag: the star is a straight toggle, no modal',
    edits.length === 1 && edits[0][1].flags.journal === true, JSON.stringify(edits));

  root.unmount();
  closeDom(dom);
}

// ────────── C. the real store: tick, delete, and the flush invariant ─────────
// Drives the REAL ScheduleModule over the REAL useWorkOrders, because the two
// capabilities S3b left as debt are only real if they reach the store.

async function storeChecks() {
  const today = itinTodayStr();
  stored = {
    orders: [{ id: 'WO-1', address: '9 Elm St', city: 'Trenton', status: 'New' }],
    presets: [], inboxes: [], settings: {},
    notes: [
      normalizeNote({ body: 'tick me', ts: 1000, flags: { task: { done: false, due: today } } }, 'c-task'),
      normalizeNote({ body: 'keep me', ts: 1001 }, 'c-keep'),
      normalizeNote({ body: 'delete me', ts: 1002 }, 'c-del'),
      normalizeNote({ body: 'flag me', ts: 1003 }, 'c-flag'),
    ],
  };
  const dom = freshDom();
  const { React, createRoot, ScheduleModule, ConfirmHost, useWorkOrders, PAD_IDLE_MS } = bundle();

  let api = null;
  function Host() {
    const t = useWorkOrders();
    api = { data: t[0] };
    return React.createElement(React.Fragment, null,
      React.createElement(ScheduleModule, {
        orders: (t[0] && t[0].orders) || [], techs: [], statusColors: {}, statusTags: {},
        tech: 'ALL', setTech: () => {}, focus: null, onClearFocus: () => {},
        onOpenWO: () => {}, onOpenMaps: () => {},
        notes: (t[0] && t[0].notes) || [],
        onAddNote: t[18], onUpdateNote: t[19], onDeleteNote: t[20],
      }),
      React.createElement(ConfirmHost, null));
  }
  const container = dom.window.document.getElementById('probe');
  const root = createRoot(container);
  root.render(React.createElement(Host));
  await tick();
  const k = domKit(dom, container);
  const rec = (id) => ((api.data && api.data.notes) || []).find(n => n.id === id) || null;
  const count = () => ((api.data && api.data.notes) || []).length;
  const idle = async () => { await new Promise(r => setTimeout(r, PAD_IDLE_MS + 80)); await tick(); };

  // ── tick a task done off its calendar chip (S4 debt #1) ──
  const before = rec('c-task');
  k.click(k.tab('calendar')); await tick();
  const box = container.querySelector('input[type="checkbox"]');
  ok('tick: a task chip on the calendar carries a tick box', !!box);
  k.click(box); await tick();
  const after = rec('c-task');
  ok('tick: the chip writes flags.task.done',
    !!(after && after.flags.task && after.flags.task.done === true), JSON.stringify(after && after.flags));
  ok('tick: `ts` (the journal position) does NOT move',
    after.ts === before.ts, String(after.ts) + ' vs ' + String(before.ts));
  ok('tick: the due date and the body are untouched',
    after.flags.task.due === before.flags.task.due && after.body === before.body,
    JSON.stringify({ due: after.flags.task.due, body: after.body }));
  ok('tick: `updated` DOES move (it is edited-at)', after.updated >= before.updated,
    String(after.updated) + ' vs ' + String(before.updated));

  // ── the flush invariant: a flag write on the note the editor OWNS ──
  // Proven against the broken ordering in scratchpad/flush-interleave-probe.js:
  // without the flush the store holds the PRE-FLAG body for the whole idle
  // window, which is the same window PAD_IDLE_MS documents as the crash window.
  k.click(k.tab('scratchpad')); await tick();
  k.click(k.row('flag me')); await tick();
  k.typeInto(k.pad(), 'flag me, now edited'); await tick();
  ok('flush: nothing is written yet -- the pad timer is still armed',
    rec('c-flag').body === 'flag me', rec('c-flag').body);
  k.click(k.flagBtn('Task')); await tick();
  k.click(k.btn('Save')); await tick();
  const flagged = rec('c-flag');
  ok('flush: the flag write FLUSHED the pad first -- the body is already current',
    flagged.body === 'flag me, now edited', flagged.body);
  ok('flush: and the flag itself landed', !!flagged.flags.task, JSON.stringify(flagged.flags));
  await idle();
  const settled = rec('c-flag');
  ok('flush: after the idle window nothing changed -- no second racing write',
    settled.body === 'flag me, now edited' && !!settled.flags.task && settled.updated === flagged.updated,
    JSON.stringify({ body: settled.body, flags: settled.flags }));

  // ── delete a note (S4 debt #2) ──
  const beforeCount = count();
  k.click(k.row('delete me')); await tick();
  k.typeInto(k.pad(), 'delete me, half typed'); await tick();   // arm the timer too
  k.click(k.flagBtn('Delete')); await tick();
  ok('delete: it asks first (confirmDialog, never the native window.confirm)',
    container.textContent.indexOf('Delete this note?') !== -1, container.textContent.slice(-200));
  const confirm = Array.from(container.querySelectorAll('button')).filter(b => b.textContent.trim() === 'Delete').pop();
  k.click(confirm); await tick(); await tick();
  ok('delete: the note is gone', rec('c-del') === null, JSON.stringify(rec('c-del')));
  ok('delete: EXACTLY that note and no other',
    count() === beforeCount - 1 && !!rec('c-keep') && !!rec('c-task') && !!rec('c-flag'),
    String(count()) + ' vs ' + String(beforeCount));
  ok('delete: the pad was RELEASED, so no typed text is left addressed to a dead note',
    k.pad().value === '', JSON.stringify(k.pad().value));
  const afterDelete = count();
  await idle();
  ok('delete: and the released pad does not resurrect or strand anything on the idle tick',
    count() === afterDelete && rec('c-del') === null, String(count()));

  // Cancelling must not delete.
  const keepCount = count();
  k.click(k.row('keep me')); await tick();
  k.click(k.flagBtn('Delete')); await tick();
  k.click(k.btn('Cancel')); await tick(); await tick();
  ok('delete: Cancel deletes nothing', count() === keepCount && !!rec('c-keep'), String(count()));

  dom.window.dispatchEvent(new dom.window.Event('beforeunload'));   // drain the S2 note debounce
  await tick();
  root.unmount();
  closeDom(dom);
}

// ─────────────────────────────────── report ──────────────────────────────────

(async () => {
  await flagRowChecks();
  await storeChecks();
  console.log('admin S4 -- flag schema, flag row + modals, tick, delete, flush invariant');
  console.log('========================================================================');
  let pass = 0, fail = 0;
  for (const r of results) {
    if (r.ok) { pass++; console.log('  ok   ' + r.name); }
    else      { fail++; console.log('  FAIL ' + r.name + '\n      ' + r.err); }
  }
  console.log('');
  console.log('Total: ' + (pass + fail) + ' | Pass: ' + pass + ' | Fail: ' + fail);
  process.exitCode = fail > 0 ? 1 : 0;
})().catch(e => { console.error('THREW: ' + ((e && e.stack) || e)); process.exitCode = 1; });
