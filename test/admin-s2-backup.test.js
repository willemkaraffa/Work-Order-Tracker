// Admin S2 -- backup tiers + debounced note writes. Two halves:
//   A. PURE (no DOM): backup-logic.js by direct require. Proves the ring can
//      never name a milestone, that one shared pruneList drives both tiers, and
//      the milestoneDue policy (daily throttle, version beats the throttle).
//   B. HOOK (jsdom): the REAL useWorkOrders from src/data.js against a stubbed
//      window.storage. This is the FULL variant of the debounce test, not the
//      helper-only fallback: src/data.js cannot be loaded bare (it imports
//      app.jsx, which self-mounts createRoot(document.getElementById('root')) at
//      module-eval time), so a DOM is required either way -- and once a DOM
//      exists, driving the shipped hook is strictly better evidence than driving
//      createNoteWriter alone.
//
// KNOWN LIMITS, stated up front:
//  - window.storage is a stub. This proves what the hook WRITES and with which
//    opts, not that Electron's storage layer or main.js honours skipBackup.
//  - main.js's fs work (copyFileSync, the milestones/ subdirectory, the startup
//    ordering) is NOT executed here; only the policy it delegates to is.
//  - Real timers, so half B costs ~2s of wall clock.
//  - Deliberately NO pretendToBeVisual: that runs a per-window rAF loop on a
//    libuv handle and, combined with process.exit(), aborts intermittently on
//    Windows (UV_HANDLE_CLOSING) with every assertion green. This file shims
//    rAF itself, closes the JSDOM, and sets process.exitCode.
//
// Run:  node test/admin-s2-backup.test.js
// Exit code: 0 = all green, 1 = at least one fail.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const B = require('../backup-logic.js');

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
  console.error('WATCHDOG: admin-s2-backup did not finish in 60s');
  process.exit(1);
}, 60000);
watchdog.unref();

// ─────────────────────────── A. pure backup policy ───────────────────────────

// 1. The ring cannot see, name or evict a milestone.
test('ring filter rejects the milestones dir entry AND a milestone filename', () => {
  assert.strictEqual(B.isRingBackup('milestones'), false);
  assert.strictEqual(B.isRingBackup(B.milestoneFileName('daily', 0)), true,
    'a milestone file placed in backupDir WOULD be pruned -- that is why it lives in a subdir');
  // What rotateBackups actually lists: readdir of the TOP level of backups/.
  const entries = [];
  for (let i = 0; i < 40; i++) entries.push({ name: `wo-data.2026-08-26T09-${String(i).padStart(2, '0')}-00-000Z.json`, mtime: 1000 + i });
  entries.push({ name: 'milestones', mtime: 999999 });   // the subdirectory
  const listed = entries.filter(e => B.isRingBackup(e.name));
  assert.strictEqual(listed.length, 40, 'the milestones dir entry must not be listed');
  const evicted = B.pruneList(listed, B.MAX_BACKUPS);
  assert.strictEqual(evicted.length, 30);
  assert.ok(!evicted.includes('milestones'));
  assert.ok(!evicted.some(n => n.indexOf('.daily.') >= 0 || n.indexOf('.version.') >= 0 || n.indexOf('.first.') >= 0));
});

// 2. pruneList keeps the newest `max`, returns exactly the rest, newest-first.
test('pruneList keeps the newest max and returns exactly the rest', () => {
  const e = [
    { name: 'a', mtime: 5 }, { name: 'b', mtime: 1 }, { name: 'c', mtime: 4 },
    { name: 'd', mtime: 2 }, { name: 'e', mtime: 3 },
  ];
  assert.deepStrictEqual(B.pruneList(e, 2), ['e', 'd', 'b'], 'newest-first ordering past the cut');
  assert.deepStrictEqual(B.pruneList(e, 5), []);
  assert.deepStrictEqual(B.pruneList(e, 99), []);
  assert.deepStrictEqual(B.pruneList([], 10), []);
  assert.deepStrictEqual(e.map(x => x.name), ['a', 'b', 'c', 'd', 'e'], 'input not mutated');
});

// 3. Daily throttle: once per day, not twice.
test('milestoneDue: daily at >= DAY_MS, null just under it', () => {
  const now = 1_700_000_000_000;
  const last = { at: now - B.DAY_MS, version: '4.5.0' };
  assert.strictEqual(B.milestoneDue(now, '4.5.0', last), 'daily');
  assert.strictEqual(B.milestoneDue(now, '4.5.0', { at: now - B.DAY_MS + 1, version: '4.5.0' }), null);
  assert.strictEqual(B.milestoneDue(now, '4.5.0', { at: now, version: '4.5.0' }), null);
  assert.strictEqual(B.milestoneDue(now, '4.5.0', null), 'first');
  assert.strictEqual(B.milestoneDue(now, '4.5.0', {}), 'first');
});

// 4. A version bump BEATS the throttle -- the pre-migration snapshot is the
//    whole point, and a post-migration one is worthless.
test('milestoneDue: version change wins even seconds after the last milestone', () => {
  const now = 1_700_000_000_000;
  assert.strictEqual(B.milestoneDue(now, '4.6.0', { at: now - 1000, version: '4.5.0' }), 'version');
  assert.strictEqual(B.milestoneDue(now, '4.5.0', { at: now - 1000, version: '4.5.0' }), null);
  assert.ok(B.milestoneFileName('version', now).startsWith('wo-data.version.'));
  assert.ok(B.milestoneFileName('version', now).endsWith('.json'));
  assert.ok(!/[:.]/.test(B.milestoneFileName('version', now).slice('wo-data.version.'.length, -'.json'.length)));
});

// 5. Milestone retention is independent of the ring, and never touches the state
//    sidecar (losing it would re-fire a 'first' milestone every launch).
test('milestone prune uses MAX_MILESTONES and never returns the state sidecar', () => {
  assert.notStrictEqual(B.MAX_MILESTONES, B.MAX_BACKUPS);
  const dir = [{ name: B.MILESTONE_STATE, mtime: 999999 }];
  for (let i = 0; i < 20; i++) dir.push({ name: B.milestoneFileName('daily', i * B.DAY_MS), mtime: 1000 + i });
  const listed = dir.filter(e => B.isMilestoneBackup(e.name));
  assert.strictEqual(listed.length, 20, 'the state sidecar must not be listed');
  const evicted = B.pruneList(listed, B.MAX_MILESTONES);
  assert.strictEqual(evicted.length, 8, '20 milestones - MAX_MILESTONES');
  assert.ok(!evicted.includes(B.MILESTONE_STATE));
  // The ring's depth must not decide this one.
  assert.notStrictEqual(evicted.length, 20 - B.MAX_BACKUPS);
});

// 7b. The locked ruling: skipBackup is asked for at the NOTE write path only and
//     is NOT centralized in the storage layer. Source-level guard (the
//     behavioural half is test 7a below); it fails loudly if someone moves the
//     flag into preload.js or onto every write.
test('skipBackup is not centralized: preload/storage layer stays opt-in', () => {
  const preload = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
  assert.ok(!/skipBackup:\s*true/.test(preload), 'preload must not hardcode skipBackup');
  const data = fs.readFileSync(path.join(ROOT, 'src', 'data.js'), 'utf8');
  // line-scoped (`.` excludes newlines): the argument list now contains a nested
  // call, getPayload(), so a [^)]* character class would stop at the wrong paren.
  const flagged = data.match(/window\.storage\.set\(.*skipBackup/g) || [];
  assert.strictEqual(flagged.length, 1, 'exactly one write path opts out of the ring');
  const plain = data.match(/window\.storage\.set\('wo_data', JSON\.stringify\(next\)\)/g) || [];
  assert.ok(plain.length >= 10, 'the other write paths still rotate the ring: ' + plain.length);
});

// ──────────────────── B. the real hook: debounce + skipBackup ────────────────

const STORED = { orders: [], presets: [], inboxes: [], notes: [], settings: {} };
const calls = [];   // { key, value, opts }

// The bundle's bare setInterval resolves to NODE's global, not the jsdom window,
// so window.close() cannot reap the App's timers and the loop never drains
// (verified: this file hung to the watchdog before this). Same mechanism as
// renderer-smoke.test.js. Wrap setInterval ONLY -- wrapping setTimeout would
// abandon this file's own await/flush timers.
const openIntervals = [];
const realSetInterval = global.setInterval;

function freshDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div><div id="probe"></div></body></html>',
    { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.Node = dom.window.Node;
  global.getComputedStyle = dom.window.getComputedStyle;
  // Shimmed here instead of via pretendToBeVisual (see KNOWN LIMITS).
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
    get: () => Promise.resolve({ value: JSON.stringify(STORED) }),
    set: (key, value, opts) => { calls.push({ key, value, opts }); return Promise.resolve(); },
  };
  return dom;
}

// One bundle holding React, react-dom and the real hook (two React copies would
// throw "invalid hook call"). Same stdin-entry trick as entries-store.test.js.
function loadBridge() {
  const out = esbuild.buildSync({
    stdin: {
      contents: [
        "import React from 'react';",
        "import { createRoot } from 'react-dom/client';",
        "import { useWorkOrders, NOTE_WRITE_MS } from './src/data.js';",
        "export { React, createRoot, useWorkOrders, NOTE_WRITE_MS };",
      ].join('\n'),
      resolveDir: ROOT,
      sourcefile: 'admin-s2-entry.jsx',
      loader: 'jsx',
    },
    bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
    loader: { '.js': 'jsx', '.jsx': 'jsx' }, write: false, logLevel: 'silent',
  });
  const abs = path.join(ROOT, 'admin-s2-entry.jsx');
  const m = new Module(abs, module);
  m.filename = abs;
  m.paths = Module._nodeModulePaths(ROOT);
  m._compile(out.outputFiles[0].text, abs);
  return m.exports;
}

async function runHook() {
  const dom = freshDom();
  const { React, createRoot, useWorkOrders, NOTE_WRITE_MS } = loadBridge();

  let handle = null;
  function Probe() {
    const t = useWorkOrders();
    handle = { data: t[0], updateSettings: t[3], addNote: t[18], updateNote: t[19] };
    return null;
  }
  const root = createRoot(dom.window.document.getElementById('probe'));
  root.render(React.createElement(Probe));
  const tick = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0)); };
  await tick();

  // The bundle ALSO self-mounts the real App into #root (app.jsx does that at
  // module-eval time), so the App's own hook shares this storage stub. Every
  // later count is therefore taken as a delta from a settled baseline, never as
  // an absolute -- and no load-time write may claim skipBackup.
  ok('hook: mounted and settled', !!handle && !!handle.data, String(handle && handle.data));
  ok('hook: no load-time write opts out of the ring',
    calls.every(c => c.opts === undefined), JSON.stringify(calls.map(c => c.opts)));

  // 6. Coalescing: N rapid note writes -> ONE write, carrying the LATEST notes.
  const before = calls.length;
  handle.addNote({ body: 'first' });
  handle.addNote({ body: 'second' });
  handle.addNote({ body: 'third' });
  await tick();
  ok('debounce: three rapid note writes issue NO immediate storage.set',
    calls.length === before, JSON.stringify(calls.slice(before).map(c => c.opts)));
  ok('debounce: state is still synchronous (all three notes readable now)',
    handle.data.notes.length === 3 && handle.data.notes.map(n => n.body).join(',') === 'first,second,third',
    JSON.stringify(handle.data.notes.map(n => n.body)));

  await new Promise(r => setTimeout(r, NOTE_WRITE_MS + 250));
  const burst = calls.slice(before);
  ok('debounce: the burst collapsed into exactly ONE write', burst.length === 1,
    'writes=' + burst.length);
  const payload = burst.length ? JSON.parse(burst[0].value) : null;
  ok('debounce: that one write carries the LATEST store, not a stale snapshot',
    !!payload && payload.notes.length === 3 && payload.notes.map(n => n.body).join(',') === 'first,second,third',
    JSON.stringify(payload && payload.notes.map(n => n.body)));

  // 7a. The note write asks for skipBackup; another write path does not.
  ok('skipBackup: the note write opts out of the ring',
    burst.length === 1 && burst[0].opts && burst[0].opts.skipBackup === true,
    JSON.stringify(burst.length && burst[0].opts));
  const beforeSettings = calls.length;
  handle.updateSettings({ density: 'compact' });
  await tick();
  const settingsCalls = calls.slice(beforeSettings);
  ok('skipBackup: a non-note write path still rotates the ring (immediate, no opts)',
    settingsCalls.length === 1 && settingsCalls[0].opts === undefined,
    JSON.stringify(settingsCalls.map(c => c.opts)));

  // The pending write must not be lost on teardown.
  const beforeUnload = calls.length;
  handle.addNote({ body: 'fourth' });
  await tick();
  ok('flush: the fourth note is still pending before unload', calls.length === beforeUnload,
    'writes=' + (calls.length - beforeUnload));
  dom.window.dispatchEvent(new dom.window.Event('beforeunload'));
  const flushed = calls.slice(beforeUnload);
  ok('flush: beforeunload writes the pending state immediately',
    flushed.length === 1 && JSON.parse(flushed[0].value).notes.length === 4
    && flushed[0].opts && flushed[0].opts.skipBackup === true,
    JSON.stringify(flushed.map(c => c.opts)));

  // CLOBBER REGRESSION. A deferred note write must never revert an immediate
  // write from another path that landed while it was pending. The first cut of
  // createNoteWriter serialized the store at QUEUE time, so this interleave --
  // note queued, settings written immediately, note flush lands last -- wrote the
  // pre-settings snapshot over the top. Memory still showed the settings change,
  // so the loss was invisible until the next launch. This case FAILS against
  // snapshot-at-queue-time and passes with serialize-at-flush-time.
  const beforeClobber = calls.length;
  handle.addNote({ body: 'interleaved note' });      // queued, deferred
  await tick();
  handle.updateSettings({ theme: 'dark' });          // immediate, lands FIRST
  await tick();
  await new Promise(r => setTimeout(r, NOTE_WRITE_MS + 250));
  const seq = calls.slice(beforeClobber);
  ok('clobber: the immediate write lands first, the note flush last',
    seq.length === 2 && seq[0].opts === undefined && seq[1].opts && seq[1].opts.skipBackup === true,
    JSON.stringify(seq.map(c => c.opts)));
  const finalStore = seq.length ? JSON.parse(seq[seq.length - 1].value) : null;
  ok('clobber: the note flush carries the settings write queued AFTER it, not a stale snapshot',
    !!finalStore && finalStore.settings && finalStore.settings.theme === 'dark',
    JSON.stringify(finalStore && finalStore.settings));
  ok('clobber: and it still carries its own note',
    !!finalStore && finalStore.notes.some(n => n.body === 'interleaved note'),
    JSON.stringify(finalStore && finalStore.notes.map(n => n.body)));

  // Nothing left queued: unmount must not double-write.
  const beforeUnmount = calls.length;
  root.unmount();
  await tick();
  ok('flush: unmount with nothing pending writes nothing',
    calls.length === beforeUnmount, 'writes=' + (calls.length - beforeUnmount));

  dom.window.close();
  for (const id of openIntervals) { try { global.clearInterval(id); } catch (e) { /* already cleared */ } }
}

(async () => {
  await runHook();
  console.log('admin S2 backup tiers + debounced note writes');
  console.log('=============================================');
  let pass = 0, fail = 0;
  for (const r of results) {
    if (r.ok) { pass++; console.log('  ok   ' + r.name); }
    else      { fail++; console.log('  FAIL ' + r.name + '\n       ' + r.err); }
  }
  console.log('');
  console.log('Total: ' + (pass + fail) + ' | Pass: ' + pass + ' | Fail: ' + fail);
  process.exitCode = fail > 0 ? 1 : 0;
})().catch(e => { console.error('THREW: ' + ((e && e.stack) || e)); process.exitCode = 1; });
