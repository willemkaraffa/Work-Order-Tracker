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
function freshDom(storageSeed) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',
    { url: 'http://localhost/', pretendToBeVisual: true });
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
    dom.window.storage = {
      get: async (k) => (k === 'wo_data' ? { value: JSON.stringify(storageSeed) } : null),
      set: async () => {},
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

  console.log('');
  console.log(fails ? (fails + ' FAILURES') : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
