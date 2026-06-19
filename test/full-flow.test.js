'use strict';
// Mimics captureAMH end-to-end against the WO 9718400 dump set, including the
// inline getApprovedBidUrls script (case-insensitive Approved match) and the
// amhBidDetail extractor. jsdom can't simulate clicks, but it can verify every
// extraction step that runs over static DOM after the click phase.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const D = 'C:/Users/pvega/Downloads/';
const DUMPS = {
  general:     'wo-dump-AMH-1779987193120.json',
  conditions:  'wo-dump-AMH-1779987211685.json',
  bidsList:    'wo-dump-AMH-1779986509675.json',
  bidDetail1:  'wo-dump-AMH-1779987228527.json',  // $269.06
  bidDetail2:  'wo-dump-AMH-1779987247270.json',  // $223.63
};

function withDom(file, fn) {
  const d = JSON.parse(fs.readFileSync(path.join(D, file), 'utf8'));
  const dom = new JSDOM(d.html, { url: d.url });
  Object.defineProperty(dom.window.document.body, 'innerText', {
    configurable: true, get: () => d.innerText,
  });
  global.window = dom.window;
  global.document = dom.window.document;
  global.location = dom.window.location;
  delete require.cache[require.resolve(path.join(__dirname,'..','scraper-extract.js'))];
  const api = require(path.join(__dirname,'..','scraper-extract.js'));
  return fn(api, dom);
}

// Re-run the inline script logic from scraper.js getApprovedBidUrls.
// Hand-ported (template-literal escape sequences in the source need
// unescaping to eval directly; cheaper to mirror the logic here).
function getApprovedBidUrlsFromDom() {
  const BID_RE = /\/my-amh\/bids\/([a-f0-9-]{36})/i;
  const links = Array.from(document.querySelectorAll('a[href*="/my-amh/bids/"]'));
  const seen = new Set();
  const urls = [];
  for (const link of links) {
    if (!BID_RE.test(link.href)) continue;
    if (seen.has(link.href)) continue;
    const row = link.closest('tr,[class*="row"],[class*="card"]') || link.parentElement;
    if (!row) continue;
    const pill = row.querySelector('.pill-label, .pill .pill-label, [class*="pill-label"]');
    const statusText = pill ? pill.textContent : row.textContent;
    if (!/approved/i.test(statusText)) continue;
    seen.add(link.href);
    urls.push(link.href);
  }
  return urls;
}

let fails = 0;
function check(label, got, want, contains) {
  const ok = contains ? String(got || '').includes(want) : got === want;
  console.log(`  ${ok?'ok  ':'FAIL'} ${label}: ${JSON.stringify(got)}${contains?' contains ':' === '}${JSON.stringify(want)}`);
  if (!ok) fails++;
}

console.log('=== getApprovedBidUrls on bid list (case-insensitive Approved) ===');
const bidUrls = withDom(DUMPS.bidsList, () => getApprovedBidUrlsFromDom());
console.log('  urls:', bidUrls);
check('bid url count', bidUrls.length, 3);

console.log('\n=== End-to-end synthesis ===');
const issues  = withDom(DUMPS.conditions, api => api.amhIssues());
const general = withDom(DUMPS.general,    api => api.amhGeneral([]));
const contacts= withDom(DUMPS.general,    api => api.amhContacts());

let bidTotal = 0;
const bidItems = [];
for (const detailFile of [DUMPS.bidDetail1, DUMPS.bidDetail2]) {
  const det = withDom(detailFile, api => api.amhBidDetail());
  bidTotal += det.amount;
  for (const it of det.items) {
    if (!bidItems.find(x => x.name.toLowerCase() === it.name.toLowerCase())) bidItems.push(it);
  }
}
const primary = contacts[0] || null;
const merged = {
  ...general,
  type:  issues.type || general.type || 'Other',
  notes: issues.notes || '',
  bidItems,
  bidAmount: bidTotal ? String(bidTotal.toFixed(2)) : '',
  phone:       primary ? primary.phone : general.phone,
  contactName: primary ? primary.name  : '',
  contacts,
};
console.log('  merged:', JSON.stringify({
  woId: merged.woId,
  address: merged.address,
  city: merged.city,
  propertyId: merged.propertyId,
  phone: merged.phone,
  contactName: merged.contactName,
  type: merged.type,
  bidAmount: merged.bidAmount,
  bidItemCount: merged.bidItems.length,
  notes: merged.notes,
}, null, 2));

check('woId', merged.woId, '9718400');
check('bidAmount', merged.bidAmount, '492.69');
check('bidItems', merged.bidItems.length, 10);
check('type', merged.type, 'Plumbing');
check('notes shower', merged.notes, 'shower heads in the main bathroom', true);
check('notes toilet', merged.notes, 'toilet bowl handle broke', true);
check('notes bathtub', merged.notes, 'bathtub is leaking', true);
check('contactName', merged.contactName, 'Karen Johnson');
check('phone', merged.phone, '9198275177');

if (fails) { console.error('\n' + fails + ' FAILURES'); process.exit(1); }
console.log('\nALL PASS');
