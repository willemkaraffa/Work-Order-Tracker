'use strict';
// Resilience test for scraper-extract.js against real saved DOM dumps.
// jsdom parses the dump HTML for querySelector-based logic; body.innerText is
// overridden with the dump's real Chromium-captured text (jsdom can't compute
// innerText). Loads the EXACT module that ships in the BrowserWindow.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const DUMP_DIR = path.join(__dirname, 'fixtures');
const MODULE = path.join(__dirname, '..', 'scraper-extract.js');

if (!fs.existsSync(DUMP_DIR) || !fs.readdirSync(DUMP_DIR).some(f => /^wo-dump-.*\.json$/.test(f))) {
  console.log('SKIP extract: no dumps in test/fixtures'); process.exit(2);
}

function loadDump(file) {
  const dump = JSON.parse(fs.readFileSync(path.join(DUMP_DIR, file), 'utf8'));
  const dom = new JSDOM(dump.html, { url: dump.url });
  Object.defineProperty(dom.window.document.body, 'innerText', {
    configurable: true, get: () => dump.innerText,
  });
  global.window = dom.window;
  global.document = dom.window.document;
  global.location = dom.window.location;
  delete require.cache[require.resolve(MODULE)];
  return require(MODULE);
}

function tabOf(url) {
  if (/\/bids\//.test(url)) return 'amhBids';
  if (/tabId=condition-issues/.test(url)) return 'amhIssues';
  if (/amh\.com/.test(url)) return 'amhGeneral';
  return 'msr';
}

const dumps = fs.readdirSync(DUMP_DIR).filter(f => /^wo-dump-.*\.json$/.test(f));

let fail = 0;
function check(label, got, want, contains) {
  const ok = contains ? (got || '').includes(want) : got === want;
  if (!ok) { fail++; console.log(`  FAIL ${label}: got ${JSON.stringify(got)} want${contains ? ' contains' : ''} ${JSON.stringify(want)}`); }
  else console.log(`  ok   ${label}: ${JSON.stringify(got)}`);
}

for (const file of dumps) {
  const dump = JSON.parse(fs.readFileSync(path.join(DUMP_DIR, file), 'utf8'));
  const kind = tabOf(dump.url);
  console.log(`\n=== ${file}  [${kind}]  ${dump.url}`);
  const api = loadDump(file);
  let out;
  if (kind === 'amhGeneral') out = api.amhGeneral([]);
  else if (kind === 'amhIssues') out = api.amhIssues();
  else if (kind === 'msr') out = api.msr([]);
  else { console.log('  (bid detail page — handled by scraper.js, skipping)'); continue; }
  console.log('  ->', JSON.stringify(out));

  // Assertions per known fixtures
  if (file === 'wo-dump-AMH-1779481024875.json') {
    check('woId', out.woId, '9723779');
    check('address', out.address, '36 Gregory Drive');
    check('city', out.city, 'Clayton');
    check('propertyId', out.propertyId, 'NC21822');
    check('status', out.status, 'In Progress');
    check('priority', out.priority, 'Medium');
    check('dateCreated', out.dateCreated, '2026-05-21');
    check('phone', out.phone, '984-399-3844');
  }
  if (file === 'wo-dump-AMH-1779482689124.json' || file === 'wo-dump-AMH-1779482966696.json') {
    check('type', out.type, 'Plumbing');
    check('notes', out.notes, 'Toilet', true);
    check('notes-complaint', out.notes, 'upstairs toilet bowl', true);
  }
  if (file === 'wo-dump-MSR-1779482947336.json') {
    check('woId', out.woId, '02761757');
    check('type', out.type, 'HVAC');
    check('status', out.status, 'In Progress');
    // round5 A3 / #12b: MSR has no accept date -> dateCreated must be the capture
    // date (today), NOT the Scheduled Start Time (5/22/2026 -> 2026-05-22).
    check('dateCreated = capture date', out.dateCreated, new Date().toISOString().slice(0, 10));
    if (out.dateCreated === '2026-05-22') { fail++; console.log('  FAIL dateCreated still = scheduled date'); }
  }
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURES'}`);
process.exit(fail === 0 ? 0 : 1);
