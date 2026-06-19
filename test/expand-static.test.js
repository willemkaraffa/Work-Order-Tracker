'use strict';
// Static check that the expansion script's selectors find the right elements
// and the async wrapper runs cleanly against a real AMH issues-page dump.
// jsdom can't simulate React/Ant click handlers, so this verifies the SHAPE
// (selectors hit, no exceptions). Click *effectiveness* needs a live capture.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const DUMP = 'C:/Users/pvega/Downloads/wo-dump-AMH-1779978895264.json';
const d = JSON.parse(fs.readFileSync(DUMP, 'utf8'));
const dom = new JSDOM(d.html, { url: d.url, runScripts: 'outside-only' });
Object.defineProperty(dom.window.document.body, 'innerText', {
  configurable: true, get: () => d.innerText,
});

// Pull the template-literal body verbatim out of scraper.js.
const src = fs.readFileSync(path.join(__dirname, '..', 'scraper.js'), 'utf8');
const m = src.match(/const expandResult = await exec\(win, `([\s\S]*?)`\);/);
if (!m) { console.error('FAIL: expand script not located in scraper.js'); process.exit(1); }
const body = m[1];

(async () => {
  dom.window.eval('globalThis.__result = ' + body);
  const r = await dom.window.__result;
  console.log('expand result:', JSON.stringify(r));
  // Sanity: dump has 1 caret-right and 1 caret-down (one row already expanded).
  // Script should find 1 caret, opened=false (nothing actually toggles in jsdom),
  // but log should show carets=1 with no exception.
  if (!/carets=1/.test(r.log)) { console.error('FAIL: caret selector did not find 1 element'); process.exit(1); }
  console.log('PASS: script runs, selectors hit');
})().catch(e => { console.error('THROW:', e.message, e.stack); process.exit(1); });
