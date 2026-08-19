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

// Every window this test opens, so they can all be closed before exit. pretendToBeVisual
// runs a requestAnimationFrame loop per window on a libuv handle; leaving several of them
// open and then calling process.exit() raced libuv's teardown and aborted the process with
// "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c" AFTER every
// assertion had already printed ok. The runner saw a non-zero status and reported FAIL on
// a test that passed.
const doms = [];

// Fresh jsdom + globals before each mount. app.jsx reads global document at
// module-eval time, so this must run BEFORE loadEsm.
function freshDom(storageSeed) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',
    { url: 'http://localhost/', pretendToBeVisual: true });
  doms.push(dom);
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.Node = dom.window.Node;
  global.getComputedStyle = dom.window.getComputedStyle;
  global.requestAnimationFrame = dom.window.requestAnimationFrame || ((cb) => setTimeout(() => cb(Date.now()), 0));
  global.cancelAnimationFrame = dom.window.cancelAnimationFrame || clearTimeout;
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
}

(async () => {
  console.log('renderer smoke');
  console.log('==============');

  // Case 1: empty/default data (no stored WOs). Per lesson_test_empty_state.
  await mountCase('empty data', undefined);

  // Case 2: one real-shaped WO with a saved note card + history. Exercises the
  // data load + migrate path and the WO-list render on populated state.
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

  // Close every window (stops its rAF loop), then let the loop turn so the handles
  // finish closing before the process goes away.
  for (const d of doms) { try { d.window.close(); } catch (_) {} }
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));

  // exitCode, NOT process.exit(): exit() tears the process down mid-teardown, which is
  // the race above. Setting the code lets node leave once the loop is genuinely idle.
  process.exitCode = fails ? 1 : 0;

  // Watchdog for the opposite failure: if some handle still holds the loop open, this
  // test would hang the whole runner. unref'd, so it never keeps the process alive on
  // its own and only fires if we are still here 5s later.
  setTimeout(() => {
    console.log('renderer-smoke: event loop still busy after tests; forcing exit');
    process.exit(fails ? 1 : 0);
  }, 5000).unref();
})();
