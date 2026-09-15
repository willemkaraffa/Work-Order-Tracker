'use strict';
// Admin S0 hardening: the two app-level mechanisms behind the "all text entry
// freezes until restart" bug (roadmap-handoffs/admin-module.md).
//   A. leaked modal ref-count  -> useModalOpenFlag now registers live tokens and
//      window.__modalOpen is only a mirror, so a stale count cannot gate typing.
//   B. no error boundary       -> a render throw unmounted the whole tree, leaving
//      nothing focusable. RootErrorBoundary now keeps a mounted tree + a Reload.
// SHIPPED code via the esbuild bridge (test/_load.js). Exit: 0 pass / 1 fail.
//
// HARNESS LIMITS, stated up front:
//  - Case A drives the REAL <App/> (app.jsx self-mounts) because the hooks must run
//    inside the renderer bundled WITH them; a node-side react-dom is a second React
//    copy and its dispatcher would not serve them. Case B needs no hooks (class
//    boundary + a throwing function child), so it renders through node's react-dom.
//  - React essentially always runs effect cleanups, so this harness CANNOT
//    manufacture the skipped-cleanup that leaves a genuinely dead token. Case A
//    therefore proves the leak at the level the old code read it (counter says N
//    while nothing is mounted), plus that a real open modal still suppresses (the
//    ping is answered) and that a normal close drains back to 0. The
//    prune-on-no-answer branch itself is not machine-proven here.
const { JSDOM } = require('jsdom');
const { loadEsm } = require('./_load.js');

let fails = 0;
function ok(label, cond, extra) {
  if (cond) console.log('  ok   ' + label);
  else { fails++; console.log('  FAIL ' + label + (extra ? ': ' + extra : '')); }
}

// Same fresh-globals dance as renderer-smoke: app.jsx reads global document at
// module-eval time, so this runs BEFORE loadEsm.
// NO pretendToBeVisual: that gives each window its own requestAnimationFrame loop
// on a libuv handle, and exiting while those handles are mid-close aborts the
// process on Windows (UV_HANDLE_CLOSING assert) -- intermittently, so it reads as
// a flaky FAIL after the assertions already printed ALL PASS. Nothing here needs a
// window-level rAF: the global fallback below is what the bundle actually calls.
const DOMS = [];
function freshDom(storageSeed) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',
    { url: 'http://localhost/' });
  DOMS.push(dom);
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.Node = dom.window.Node;
  global.getComputedStyle = dom.window.getComputedStyle;
  global.requestAnimationFrame = dom.window.requestAnimationFrame || ((cb) => setTimeout(() => cb(Date.now()), 0));
  global.cancelAnimationFrame = dom.window.cancelAnimationFrame || clearTimeout;
  if (storageSeed !== undefined) {
    dom.window.storage = {
      get: async (k) => (k === 'wo_data' ? { value: JSON.stringify(storageSeed) } : null),
      set: async () => {}, list: async () => ({ keys: [] }), delete: async () => {},
    };
  }
  return dom;
}

async function flush() { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0)); }

function key(dom, k, opts) {
  dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown',
    Object.assign({ key: k, bubbles: true, cancelable: true }, opts || {})));
}

const SEED = {
  orders: [{
    id: 'wo_lock_1', woId: '9999999', tab: 'active', status: 'Open',
    address: '1 Test St', city: 'Raleigh', type: 'Plumbing', dateCreated: '2026-06-01',
  }],
};

// ---- Case A: a leaked/desynced modal count must not suppress typing ----------
async function caseA() {
  console.log('A. modal flag cannot lock typing');
  const dom = freshDom(SEED);
  loadEsm('src/app.jsx');          // self-mounts <RootErrorBoundary><App/></...>
  await flush();

  // App boots on Overview; Continue navigates to Work Orders, whose header owns
  // the type-to-search input.
  const cont = Array.from(dom.window.document.querySelectorAll('button'))
    .find(b => (b.textContent || '').trim().startsWith('Continue'));
  ok('Overview Continue button present', !!cont);
  if (!cont) return;
  cont.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await flush();

  const search = dom.window.document.querySelector('input[placeholder^="Search WO"]');
  ok('Work Orders search input mounted', !!search);
  if (!search) return;

  // 1. Leak the counter the way the bug does, with NO modal mounted.
  dom.window.document.body.focus();
  dom.window.__modalOpen = 5;
  key(dom, 'x');
  await flush();
  ok('typing works with a leaked count (invariant)', search.value === 'x', 'value=' + search.value);
  ok('leaked count healed back to the live token count', dom.window.__modalOpen === 0,
    'modalOpen=' + dom.window.__modalOpen);

  // 2. Positive control: a REAL modal (QuickJump, Ctrl+K) must still suppress, or
  //    the "fix" would just be the feature switched off.
  search.blur();
  key(dom, 'k', { ctrlKey: true });
  await flush();
  if (dom.window.document.activeElement && dom.window.document.activeElement.blur) {
    dom.window.document.activeElement.blur();   // QuickJump autofocuses its own field
  }
  ok('QuickJump open registers exactly one live token', dom.window.__modalOpen === 1,
    'modalOpen=' + dom.window.__modalOpen);
  ok('focus parked on body before the suppression probe',
    dom.window.document.activeElement === dom.window.document.body,
    dom.window.document.activeElement && dom.window.document.activeElement.tagName);
  key(dom, 'z');
  await flush();
  ok('open modal still suppresses type-to-search', search.value === 'x', 'value=' + search.value);

  // 3. Close it: the token drains and typing resumes.
  key(dom, 'k', { ctrlKey: true });
  await flush();
  ok('closing the modal drains the token', dom.window.__modalOpen === 0,
    'modalOpen=' + dom.window.__modalOpen);
  dom.window.document.body.focus();
  key(dom, 'y');
  await flush();
  ok('typing resumes after the modal closes', search.value === 'xy', 'value=' + search.value);
}

// ---- Case B: the error boundary keeps a mounted, focusable tree --------------
async function caseB() {
  console.log('B. render throw is caught, tree survives');
  const dom = freshDom(SEED);
  const { RootErrorBoundary } = loadEsm('src/app.jsx');
  ok('RootErrorBoundary exported', typeof RootErrorBoundary === 'function');
  if (typeof RootErrorBoundary !== 'function') return;
  await flush();

  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const host = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(host);

  const Boom = () => { throw new Error('boom from a render'); };
  const quiet = console.error;
  console.error = () => {};            // React logs the caught throw; keep output readable
  try {
    const root = createRoot(host);
    root.render(React.createElement(RootErrorBoundary, null, React.createElement(Boom)));
    await flush();
  } finally { console.error = quiet; }

  ok('boundary rendered a fallback instead of an empty root', host.children.length > 0);
  const fallback = host.querySelector('[data-error-boundary]');
  ok('fallback is the boundary fallback', !!fallback);
  ok('fallback names the failure', !!fallback && fallback.textContent.includes('boom from a render'),
    fallback && fallback.textContent);
  const btn = host.querySelector('button');
  ok('a focusable recovery control survives', !!btn && /reload/i.test(btn.textContent));
  if (btn) {
    btn.focus();
    ok('that control can actually take focus', dom.window.document.activeElement === btn,
      dom.window.document.activeElement && dom.window.document.activeElement.tagName);
  }
}

(async () => {
  console.log('admin S0 hardening');
  console.log('==================');
  await caseA();
  await caseB();
  console.log('');
  console.log(fails ? (fails + ' FAILURES') : 'ALL PASS');
  // Teardown order matters. Close every window, let the loop turn twice so those
  // handles finish closing, then set the code and let node leave on its own --
  // process.exit() while a handle is still closing is the abort described above.
  DOMS.forEach(d => { try { d.window.close(); } catch (_) {} });
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
  process.exitCode = fails ? 1 : 0;
  // The opposite failure mode: the mounted App can leave a stray timer holding the
  // loop open, which would hang the runner instead of failing it. This forces the
  // exit if that happens, and being unref'd it never delays a clean exit.
  const bail = setTimeout(() => process.exit(fails ? 1 : 0), 5000);
  if (bail.unref) bail.unref();
})();
