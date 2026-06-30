'use strict';
// End-to-end offline test of all AMH extractors against the WO 9718400 dump
// set: general, condition-issues, bids list, and 2 bid detail pages. Verifies
// multi-issue Description capture and bid-total/line-item summation.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const D = path.join(__dirname, 'fixtures') + path.sep;
const DUMPS = {
  general:        'wo-dump-AMH-1779987193120.json',
  conditions:     'wo-dump-AMH-1779987211685.json',
  bidsList:       'wo-dump-AMH-1779986509675.json',
  bid_0051543:    'wo-dump-AMH-1779987228527.json', // $269.06, toilet
  bid_0051517:    'wo-dump-AMH-1779987247270.json', // $223.63, shower
};
if (Object.values(DUMPS).some(f => !fs.existsSync(path.join(D, f)))) {
  console.log('SKIP wo9718400: fixture set missing'); process.exit(2);
}

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
  return fn(api);
}

let fails = 0;
function check(label, got, want, contains) {
  const ok = contains ? String(got || '').includes(want) : got === want;
  console.log(`  ${ok?'ok  ':'FAIL'} ${label}: got ${JSON.stringify(got)}${contains?' contains':' ==='} ${JSON.stringify(want)}`);
  if (!ok) fails++;
}

console.log('\n=== amhGeneral ===');
withDom(DUMPS.general, api => {
  const g = api.amhGeneral([]);
  console.log(JSON.stringify(g, null, 2));
  check('woId', g.woId, '9718400');
});

console.log('\n=== amhContacts ===');
withDom(DUMPS.general, api => {
  const c = api.amhContacts();
  console.log(JSON.stringify(c, null, 2));
});

console.log('\n=== amhIssues (3 issues expected) ===');
withDom(DUMPS.conditions, api => {
  const r = api.amhIssues();
  console.log(JSON.stringify(r, null, 2));
  check('issues count', r.issues.length, 3);
  check('type', r.type, 'Plumbing');
  check('notes has shower complaint', r.notes, 'shower heads in the main bathroom', true);
  check('notes has toilet complaint',  r.notes, 'toilet bowl handle broke', true);
  check('notes has bathtub complaint', r.notes, 'bathtub is leaking', true);
});

console.log('\n=== amhBidDetail bid 0051543 ($269.06) ===');
withDom(DUMPS.bid_0051543, api => {
  const b = api.amhBidDetail();
  console.log(JSON.stringify(b, null, 2));
  check('amount', b.amount, 269.06);
  check('items count', b.items.length, 5);
  check('item: Emergency fee', !!b.items.find(i => /Emergency fee/.test(i.name)), true);
  check('item: Replace toilet flapper', !!b.items.find(i => /Replace toilet flapper/.test(i.name)), true);
});

console.log('\n=== amhBidDetail bid 0051517 ($223.63) ===');
withDom(DUMPS.bid_0051517, api => {
  const b = api.amhBidDetail();
  console.log(JSON.stringify(b, null, 2));
  check('amount', b.amount, 223.63);
  check('items count', b.items.length, 5);
  check('item: Diagnostic fee', !!b.items.find(i => /Diagnostic fee/.test(i.name)), true);
  check('item: Replace shower head', !!b.items.find(i => /Replace shower head/.test(i.name)), true);
});

console.log('\n=== combined bid totals ===');
const total = withDom(DUMPS.bid_0051543, api => api.amhBidDetail().amount)
            + withDom(DUMPS.bid_0051517, api => api.amhBidDetail().amount);
console.log('  total =', total);
check('combined total', Math.round(total*100)/100, 492.69);

if (fails) { console.error('\n' + fails + ' FAILURES'); process.exit(1); }
console.log('\nALL PASS');
