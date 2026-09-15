'use strict';
// Renderer smoke test. Mounts the REAL <App/> (src/app.jsx self-mounts on import
// via createRoot) inside jsdom and asserts it renders without throwing, on both
// empty/default data and a real-shaped seeded record. Catches React lifecycle
// crashes (A1-A7) that the logic tests can't see. esbuild bridge = shipped code.
//
// Exit: 0 = mounted clean, 1 = threw or rendered nothing.
const { JSDOM } = require('jsdom');
const { loadEsm } = require('./_load.js');

let fails = 0;
function ok(label, cond, extra) {
  if (cond) console.log('  ok   ' + label);
  else { fails++; console.log('  FAIL ' + label + (extra ? ': ' + extra : '')); }
}

// Fresh jsdom + globals before each mount. app.jsx reads global document at
// module-eval time, so this must run BEFORE loadEsm.
// every jsdom we mint is kept here so teardown can close it (see the bottom of
// this file); nothing else closes them. openIntervals is the companion for the
// App's timers: the bundle's bare setInterval resolves to NODE's global, not the
// jsdom window, so window.close() cannot reap them. wrap setInterval ONLY --
// wrapping setTimeout abandons this file's own await/flush timers and the run
// exits before a single assertion, printing a false clean pass.
const openDoms = [];
const openIntervals = [];
const realSetInterval = global.setInterval;
function freshDom(storageSeed) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',
    { url: 'http://localhost/', pretendToBeVisual: true });
  openDoms.push(dom);
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.Node = dom.window.Node;
  global.getComputedStyle = dom.window.getComputedStyle;
  global.requestAnimationFrame = dom.window.requestAnimationFrame || ((cb) => setTimeout(() => cb(Date.now()), 0));
  global.cancelAnimationFrame = dom.window.cancelAnimationFrame || clearTimeout;
  global.setInterval = (...args) => {
    const id = realSetInterval(...args);
    openIntervals.push(id);
    return id;
  };
  // fetch stub. mounting the real App fires live geocoding requests (nominatim,
  // photon, census), and a smoke test must not depend on a third-party endpoint's
  // availability; stubbing keeps the run fast and offline-safe. this does NOT fix
  // the exit bug -- the interval cleanup in teardown does that. every consumer
  // (parseOne, evaluate) guards with Array.isArray + length, so an empty array
  // carrying an empty .features reads as 'no result' on all provider branches.
  const emptyGeo = [];
  emptyGeo.features = [];
  const fetchStub = async () => ({ ok: true, status: 200, json: async () => emptyGeo });
  global.fetch = fetchStub;
  dom.window.fetch = fetchStub;
  // window.storage is the electron bridge useWorkOrders reads. Absent => empty
  // default data path. Seeded => exercises the real data/migration load path.
  if (storageSeed !== undefined) {
    const libSeed = storageSeed && storageSeed.__library;
    dom.window.storage = {
      get: async (k) => {
        if (k === 'wo_data') return { value: JSON.stringify(storageSeed) };
        if (k === 'service_library' && libSeed) return { value: libSeed };
        if (k === 'service_library_model_version') return { value: 1 }; // skip migration in smoke
        return null;
      },
      set: async () => {},
      list: async () => ({ keys: [] }),
      delete: async () => {},
    };
  }
  return dom;
}

// Let React commit + the async load effect's setData fire.
async function flush() { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0)); }

async function mountCase(label, seed) {
  const dom = freshDom(seed);
  let threw = null;
  try {
    loadEsm('src/app.jsx');   // triggers createRoot(...).render(<App/>)
    await flush();
  } catch (e) {
    threw = e;
  }
  const root = dom.window.document.getElementById('root');
  ok(label + ' mounts without throwing', !threw, threw && (threw.message + '\n' + String(threw.stack).split('\n').slice(1, 4).join('\n')));
  ok(label + ' root has rendered children', !!root && root.children.length > 0);
  // App now mounts inside RootErrorBoundary, so a render throw no longer empties
  // #root -- it paints the fallback. Without this assert the two checks above go
  // false-green on exactly the crash they exist to catch.
  const caught = dom.window.document.querySelector('[data-error-boundary]');
  ok(label + ' error boundary did not catch', !caught, caught && caught.textContent);
}

(async () => {
  console.log('renderer smoke');
  console.log('==============');

  // Case 1: empty/default data (no stored WOs). Per lesson_test_empty_state.
  await mountCase('empty data', undefined);

  // Case 2: one real-shaped WO with a saved note card + history, plus a legacy
  // schedule entry and an already-migrated note. Exercises the data load +
  // Admin S1 note migration path and the WO-list render on populated state.
  // TODO(note-card input-lock): this is the slot for the recurring edit-freeze
  // regression — drive open-WO -> edit saved note -> assert input stays writable
  // once jsdom interaction for the command center is wired (CLAUDE.md C3).
  const seed = {
    orders: [{
      id: 'wo_smoke_1', woId: '9999999', tab: 'active', status: 'Open',
      address: '1 Test St', city: 'Raleigh', type: 'Plumbing',
      dateCreated: '2026-06-01',
      noteCards: [{ id: 'n1', ts: Date.now(), type: 'Note', body: 'saved note', pinned: false, edited: false }],
      history: [{ ts: Date.now(), action: 'created' }],
    }],
    // Pre-S1 array: must migrate into wo_data.notes on load, not crash the bell.
    entries: [{ id: 'e1', kind: 'reminder', title: 'Call the PM', date: '2026-08-22', remindAt: 1, created: 1 }],
    // Post-S1 record, already in the new shape.
    notes: [{ id: 'n2', ts: Date.now(), body: 'flat note', pinned: true, flags: {}, woId: 'wo_smoke_1' }],
  };
  await mountCase('seeded WO', seed);

  // Case 3: seeded WO + a Service Library carrying the S1a fields (page, numeric
  // material/labor, and an 'Included' sentinel item). New fields must not crash mount.
  const seedWithLib = {
    ...seed,
    __library: {
      General: [], AMH: [],
      MSR: [
        { name: 'Coil Cleaning', desc: '', price: 250, taxable: false, page: 'HVAC', subCategory: 'CLEANING', material: 150, labor: 100 },
        { name: 'Diagnostic Fee', desc: '', price: 100, taxable: true, page: 'HVAC', subCategory: 'INCURRED', material: 'Included', labor: 100 },
      ],
    },
  };
  await mountCase('seeded WO + S1a library', seedWithLib);

  // Case 4: mount ServiceLibrary standalone (App does not show it by default) and
  // assert the S1b nav + breakdown columns render. Seed the DEFAULT tab (General)
  // with L2 pages + a numeric split + an 'Included' sentinel + a page-less row, plus
  // a custom L1 category, so every new code path (pages.map, breakCell, data-driven
  // allTabs) paints on first render without synthetic clicks.
  {
    const dom = freshDom({
      ...seed,
      __library: {
        General: [
          { name: 'HVAC Tune-Up', desc: '', price: 250, taxable: true, page: 'HVAC', subCategory: 'CLEANING', material: 150, labor: 100 },
          { name: 'Unclog Drain', desc: '', price: 300, taxable: false, page: 'Plumbing', subCategory: 'Sewer', material: 'Included', labor: 300 },
          { name: 'Flat Rate', desc: '', price: 75, taxable: true },
        ],
        AMH: [{ name: 'Service Call', desc: '', price: 75, taxable: true }], // page-less
        MSR: [],
        Warranty: [{ name: 'Custom', desc: '', price: 50, taxable: true }],  // custom L1
      },
    });
    let threw = null;
    let el = null;
    try {
      const { mountServiceLibrary } = loadEsm('test/_svclib-mount.jsx');
      el = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(el);
      mountServiceLibrary(el);
      await flush();
    } catch (e) { threw = e; }
    ok('ServiceLibrary mounts without throwing', !threw, threw && (threw.message + '\n' + String(threw.stack).split('\n').slice(1, 4).join('\n')));
    const txt = el ? el.textContent : '';
    ok('ServiceLibrary renders children', !!el && el.children.length > 0);
    ok('L2 page sub-entry renders (HVAC)', txt.includes('HVAC'));
    ok('Included sentinel renders verbatim', txt.includes('Included'));
    ok('custom L1 category renders (Warranty)', txt.includes('Warranty'));
  }

  console.log('');
  console.log(fails ? (fails + ' FAILURES') : 'ALL PASS');
  // teardown, in two parts, for two separate reasons.
  // 1. the App registers its timers on Node's global setInterval, not on the
  //    jsdom window, so closing the windows cannot reap them and the loop never
  //    drains. clear the recorded ids or this file hangs forever.
  // 2. the old hard process.exit aborted the process in win\async.c
  //    (!(handle->flags & UV_HANDLE_CLOSING)) because it tore down esbuild's
  //    still-live worker MessagePort, a uv_async_t, mid-close. that is why a
  //    PASSING test reported FAIL under full-suite load, which shifted the
  //    timing. letting node drain naturally removes the race instead of
  //    narrowing it, so set exitCode and never exit hard.
  for (const id of openIntervals) {
    try { global.clearInterval(id); } catch { /* already cleared */ }
  }
  for (const d of openDoms) {
    try { d.window.close(); } catch { /* already torn down */ }
  }
  process.exitCode = fails ? 1 : 0;
})();
