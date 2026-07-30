'use strict';
// Runs the SHIPPED extension scraper (extension/content.js) against a REAL captured
// MSR page and asserts the contact fields come out. Not a copy of the logic: the
// drift that produces false-green tests is exactly what this avoids.
//
// FIXTURE IS NOT IN THE REPO, on purpose. A dump of a live work order carries a
// resident's name, phone, email and address. It lives in Downloads (or wherever
// MSR_DUMP points) and this test SKIPS (exit 2) when it is absent, so the gate stays
// runnable on any machine without shipping personal data.
//
//   node test/msr-extract.test.js
//   MSR_DUMP=C:/path/to/wo-dump-MSR-*.json node test/msr-extract.test.js
//
// WHAT IT PINS: WO 03984243 (2026-07-22) captured with phone, contact, city and
// propertyId all blank while the page plainly showed them. Cause was reading
// label/value pairs out of flattened innerText; the fix queries the Lightning
// record-layout items instead. This test fails if that regresses.
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

function findDump() {
  if (process.env.MSR_DUMP && fs.existsSync(process.env.MSR_DUMP)) return process.env.MSR_DUMP;
  const dir = path.join(os.homedir(), 'Downloads');
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return null; }
  const hits = names.filter(n => /^wo-dump-MSR-.*\.json$/i.test(n))
    .map(n => path.join(dir, n))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return hits[0] || null;
}

const dumpPath = findDump();
if (!dumpPath) {
  console.log('SKIP msr-extract: no wo-dump-MSR-*.json (set MSR_DUMP to point at one)');
  process.exit(2);
}

let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch { console.log('SKIP msr-extract: jsdom not installed'); process.exit(2); }

const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
if (!dump.html || !/records-record-layout-item/.test(dump.html)) {
  // An older dump (or a list page) has no record-layout grid; nothing to assert.
  console.log('SKIP msr-extract: dump has no record-layout grid: ' + path.basename(dumpPath));
  process.exit(2);
}

const dom = new JSDOM(dump.html, { url: dump.url || 'https://amherst.my.site.com/partner/s/workorder/x' });

// content.js is a content script: it expects browser globals at import time and
// registers listeners. Shim just enough for the module body to run.
// jsdom does not implement innerText (it is layout-dependent, and jsdom has no
// layout). scrapeMSR reads doc.body.innerText for its FALLBACK paths, so without this
// the module throws before reaching anything worth asserting. Mapped to textContent,
// which is close enough to let the code run.
//
// STATED LIMIT: this makes the innerText fallbacks behave differently here than in a
// real browser (no line breaks between blocks), so this test does NOT validate them.
// It validates the structural field-query path, which is what the fix introduced and
// what the assertions below target.
Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', {
  get() { return this.textContent; },
  configurable: true,
});

global.window = dom.window;
global.document = dom.window.document;
global.location = dom.window.location;
global.MutationObserver = dom.window.MutationObserver;
global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
global.chrome = {
  storage: { local: { get: (_k, cb) => cb && cb({}), set: (_v, cb) => cb && cb() } },
  runtime: { onMessage: { addListener: () => {} }, sendMessage: () => {}, getURL: p => p },
};

const content = require(path.join(__dirname, '..', 'extension', 'content.js'));

let fail = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
};

console.log('msr-extract: ' + path.basename(dumpPath));

const data = content.scrapeMSR([], dom.window.document);

check('WO number is read from the page', () => {
  assert.match(String(data.woId || ''), /^\d{6,}$/, 'woId was ' + JSON.stringify(data.woId));
});

// THE REGRESSION. Every one of these was blank on the capture that prompted the fix.
check('phone is extracted (was blank on WO 03984243)', () => {
  const digits = String(data.phone || '').replace(/\D/g, '');
  assert.ok(digits.length >= 10, 'phone was ' + JSON.stringify(data.phone));
});

check('contact name is extracted (regex needed an "Open" token this page lacks)', () => {
  assert.ok(String(data.contactName || '').trim().length > 1,
    'contactName was ' + JSON.stringify(data.contactName));
});

check('contact name carries no Preview affordance text', () => {
  assert.doesNotMatch(String(data.contactName || ''), /Preview\s*$/,
    'contactName was ' + JSON.stringify(data.contactName));
});

check('contacts list is populated and carries the phone', () => {
  assert.ok(Array.isArray(data.contacts) && data.contacts.length >= 1, 'contacts was ' + JSON.stringify(data.contacts));
  assert.ok(String(data.contacts[0].phone || '').replace(/\D/g, '').length >= 10,
    'contacts[0].phone was ' + JSON.stringify(data.contacts[0]));
});

check('address is extracted', () => {
  assert.ok(String(data.address || '').trim().length > 3, 'address was ' + JSON.stringify(data.address));
});

check('address carries no Preview affordance text', () => {
  assert.doesNotMatch(String(data.address || ''), /Preview\s*$/, 'address was ' + JSON.stringify(data.address));
});

console.log(fail ? `\n${fail} failed` : '\nall passed');
process.exit(fail ? 1 : 0);
