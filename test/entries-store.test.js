// NOTE STORE test (Admin S1, was the S3 entry store): drives the real
// useWorkOrders hook from src/data.js in jsdom against a stubbed window.storage,
// and asserts what is actually persisted into the ONE flat wo_data.notes array
// -- including the load-time migration of o.noteCards and wo_data.entries. The
// mounted-UI tests in schedule.test.js stub the three note callbacks, so without
// this file the add/update/delete write path would ship unexecuted.
//
// KNOWN LIMITS, stated up front:
//  - window.storage is a stub. This proves what the hook WRITES, not that
//    Electron's storage layer keeps it.
//  - No layout, no CSS: nothing here is a claim about appearance.
//
// Run:  node test/entries-store.test.js
// Exit code: 0 = all green, 1 = at least one fail.

'use strict';

const path = require('path');
const Module = require('module');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const results = [];
function ok(name, cond, extra) {
  results.push({ name, ok: !!cond, err: cond ? undefined : String(extra === undefined ? 'assertion failed' : extra) });
}

// Legacy (pre-S1) blob: no `notes` key, a WO carrying note cards, and a
// schedule entry. The hook must backfill notes and migrate BOTH sources into it.
const STORED = {
  orders: [{ id: 'WO-1', pm: 'MSR', tab: 'active', notes: 'More Information',
             noteCards: [{ id: 'n1', ts: 1000, type: 'Note', body: 'saved note', pinned: true }] }],
  presets: [], inboxes: [], settings: {},
  entries: [{ id: 'e-1', kind: 'reminder', title: 'Call the PM', date: '2026-08-22',
              remindAt: 5000, created: 300, updated: 300 }],
};
const writes = [];

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
  dom.window.Element.prototype.scrollIntoView = function () {};
  global.IS_REACT_ACT_ENVIRONMENT = false;
  // Storage stub, installed BEFORE the bundle is compiled: app.jsx self-mounts
  // at module-eval time and the hook reads window.storage on its first effect.
  dom.window.storage = {
    get: () => Promise.resolve({ value: JSON.stringify(STORED) }),
    set: (k, v) => { writes.push(JSON.parse(v)); return Promise.resolve(); },
  };
  return dom;
}

// One bundle holding React, react-dom and the real hook (two React copies would
// throw "invalid hook call"). Same stdin-entry trick as schedule.test.js.
function loadBridge() {
  const out = esbuild.buildSync({
    stdin: {
      contents: [
        "import React from 'react';",
        "import { createRoot } from 'react-dom/client';",
        "import { useWorkOrders } from './src/data.js';",
        "export { React, createRoot, useWorkOrders };",
      ].join('\n'),
      resolveDir: ROOT,
      sourcefile: 'entries-store-entry.jsx',
      loader: 'jsx',
    },
    bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
    loader: { '.js': 'jsx', '.jsx': 'jsx' }, write: false, logLevel: 'silent',
  });
  const abs = path.join(ROOT, 'entries-store-entry.jsx');
  const m = new Module(abs, module);
  m.filename = abs;
  m.paths = Module._nodeModulePaths(ROOT);
  m._compile(out.outputFiles[0].text, abs);
  return m.exports;
}

async function run() {
  const dom = freshDom();
  const { React, createRoot, useWorkOrders } = loadBridge();

  // The hook returns a positional tuple; the entry mutators are the last three.
  let handle = null;
  function Probe() {
    const t = useWorkOrders();
    handle = { data: t[0], addNote: t[18], updateNote: t[19], deleteNote: t[20] };
    return null;
  }
  const root = createRoot(dom.window.document.getElementById('probe'));
  root.render(React.createElement(Probe));
  const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0)); };
  await flush();

  ok('store: the legacy note card migrated into the flat notes array',
    !!handle && handle.data && Array.isArray(handle.data.notes)
    && handle.data.notes.some(n => n.id === 'n1' && n.woId === 'WO-1' && n.body === 'saved note' && n.pinned === true),
    handle && handle.data && JSON.stringify(handle.data.notes));
  ok('store: the legacy schedule entry migrated into the same array, as flags',
    handle.data.notes.some(n => n.id === 'e-1' && n.flags.reminder && n.flags.reminder.at === 5000
      && n.flags.calendar.date === '2026-08-22' && n.body === 'Call the PM'),
    JSON.stringify(handle.data.notes));
  ok('store: the migrated order no longer carries noteCards, o.notes survives',
    handle.data.orders[0].noteCards === undefined && handle.data.orders[0].notes === 'More Information',
    JSON.stringify(handle.data.orders[0]));
  ok('store: wo_data.entries is gone once emptied',
    handle.data.entries === undefined, JSON.stringify(Object.keys(handle.data)));

  const migratedCount = handle.data.notes.length;

  // add
  const id = handle.addNote({ kind: 'task', title: '  Order parts  ', date: null });
  await flush();
  const afterAdd = writes[writes.length - 1];
  ok('store: addNote returns a minted id', typeof id === 'string' && id.indexOf('n-') === 0, String(id));
  ok('store: addNote persists one normalized note',
    afterAdd && afterAdd.notes.length === migratedCount + 1
    && afterAdd.notes[migratedCount].body === 'Order parts'
    && afterAdd.notes[migratedCount].id === id
    && afterAdd.notes[migratedCount].flags.task.due === null
    && afterAdd.notes[migratedCount].flags.task.done === false,
    JSON.stringify(afterAdd && afterAdd.notes));
  ok('store: addNote leaves orders untouched',
    afterAdd && Array.isArray(afterAdd.orders) && afterAdd.orders.length === 1,
    JSON.stringify(afterAdd && afterAdd.orders));
  ok('store: state reflects the write without a reload',
    handle.data.notes.length === migratedCount + 1 && handle.data.notes[migratedCount].id === id,
    JSON.stringify(handle.data.notes));
  ok('store: the persisted blob still has no entries key',
    afterAdd.entries === undefined, JSON.stringify(Object.keys(afterAdd)));

  // update
  const ts = handle.data.notes[migratedCount].ts;
  handle.updateNote(id, { kind: 'task', title: 'Order parts', done: true });
  await flush();
  const afterDone = writes[writes.length - 1];
  ok('store: updateNote flips done and keeps ts (journal position)',
    afterDone.notes[migratedCount].flags.task.done === true && afterDone.notes[migratedCount].ts === ts
    && afterDone.notes[migratedCount].updated >= ts,
    JSON.stringify(afterDone.notes[migratedCount]));

  // Normalization still applies on the update path: an undated event is illegal.
  handle.updateNote(id, { kind: 'event', title: 'Order parts', date: null });
  await flush();
  const afterKind = writes[writes.length - 1];
  ok('store: an event can never persist undated',
    /^\d{4}-\d{2}-\d{2}$/.test(String(afterKind.notes[migratedCount].flags.calendar.date)),
    JSON.stringify(afterKind.notes[migratedCount]));
  ok('store: switching a task to an event drops the task flag',
    afterKind.notes[migratedCount].flags.task === undefined, JSON.stringify(afterKind.notes[migratedCount]));

  // a second note, then delete only the first
  const id2 = handle.addNote({ body: 'Call vendor', woId: 'WO-1' });
  await flush();
  handle.deleteNote(id);
  await flush();
  const afterDelete = writes[writes.length - 1];
  ok('store: deleteNote removes only the targeted note',
    afterDelete.notes.length === migratedCount + 1
    && !afterDelete.notes.some(n => n.id === id)
    && afterDelete.notes.some(n => n.id === id2),
    JSON.stringify(afterDelete.notes));

  root.unmount();
}

(async () => {
  await run();
  console.log('note store + load-time migration (real useWorkOrders + stubbed storage)');
  console.log('========================================================================');
  let pass = 0, fail = 0;
  for (const r of results) {
    if (r.ok) { pass++; console.log('  ok   ' + r.name); }
    else      { fail++; console.log('  FAIL ' + r.name + '\n      ' + r.err); }
  }
  console.log('');
  console.log('Total: ' + (pass + fail) + ' | Pass: ' + pass + ' | Fail: ' + fail);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('THREW: ' + ((e && e.stack) || e)); process.exit(1); });
