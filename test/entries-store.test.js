// Schedule-entry STORE test (S3): drives the real useWorkOrders hook from
// src/data.js in jsdom against a stubbed window.storage, and asserts what is
// actually persisted. The mounted-UI tests in schedule.test.js stub the three
// entry callbacks, so without this file the add/update/delete write path would
// ship unexecuted.
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

// Legacy (pre-S3) blob: no `entries` key at all. The hook must backfill it.
const STORED = { orders: [], presets: [], inboxes: [], settings: {} };
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
    handle = { data: t[0], addEntry: t[18], updateEntry: t[19], deleteEntry: t[20] };
    return null;
  }
  const root = createRoot(dom.window.document.getElementById('probe'));
  root.render(React.createElement(Probe));
  const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0)); };
  await flush();

  ok('store: legacy blob without `entries` loads with an empty entries array',
    !!handle && handle.data && Array.isArray(handle.data.entries) && handle.data.entries.length === 0,
    handle && handle.data && JSON.stringify(handle.data.entries));

  // add
  const id = handle.addEntry({ kind: 'task', title: '  Order parts  ', date: null });
  await flush();
  const afterAdd = writes[writes.length - 1];
  ok('store: addEntry returns a minted id', typeof id === 'string' && id.indexOf('e-') === 0, String(id));
  ok('store: addEntry persists one normalized entry',
    afterAdd && afterAdd.entries.length === 1 && afterAdd.entries[0].title === 'Order parts'
    && afterAdd.entries[0].id === id && afterAdd.entries[0].date === null && afterAdd.entries[0].done === false,
    JSON.stringify(afterAdd && afterAdd.entries));
  ok('store: addEntry leaves orders untouched',
    afterAdd && Array.isArray(afterAdd.orders) && afterAdd.orders.length === 0,
    JSON.stringify(afterAdd && afterAdd.orders));
  ok('store: state reflects the write without a reload',
    handle.data.entries.length === 1 && handle.data.entries[0].id === id,
    JSON.stringify(handle.data.entries));

  // update
  const created = handle.data.entries[0].created;
  handle.updateEntry(id, { done: true });
  await flush();
  const afterDone = writes[writes.length - 1];
  ok('store: updateEntry flips done and keeps created',
    afterDone.entries.length === 1 && afterDone.entries[0].done === true
    && afterDone.entries[0].created === created,
    JSON.stringify(afterDone.entries));

  // Normalization still applies on the update path: an undated event is illegal.
  handle.updateEntry(id, { kind: 'event', date: null });
  await flush();
  const afterKind = writes[writes.length - 1];
  ok('store: an event can never persist undated',
    afterKind.entries[0].kind === 'event' && /^\d{4}-\d{2}-\d{2}$/.test(String(afterKind.entries[0].date)),
    JSON.stringify(afterKind.entries));
  ok('store: switching a task to an event clears done',
    afterKind.entries[0].done === false, JSON.stringify(afterKind.entries));

  // a second entry, then delete only the first
  const id2 = handle.addEntry({ kind: 'task', title: 'Call vendor' });
  await flush();
  handle.deleteEntry(id);
  await flush();
  const afterDelete = writes[writes.length - 1];
  ok('store: deleteEntry removes only the targeted entry',
    afterDelete.entries.length === 1 && afterDelete.entries[0].id === id2,
    JSON.stringify(afterDelete.entries));

  root.unmount();
}

(async () => {
  await run();
  console.log('schedule entries store (real useWorkOrders + stubbed storage)');
  console.log('===========================================================');
  let pass = 0, fail = 0;
  for (const r of results) {
    if (r.ok) { pass++; console.log('  ok   ' + r.name); }
    else      { fail++; console.log('  FAIL ' + r.name + '\n      ' + r.err); }
  }
  console.log('');
  console.log('Total: ' + (pass + fail) + ' | Pass: ' + pass + ' | Fail: ' + fail);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('THREW: ' + ((e && e.stack) || e)); process.exit(1); });
