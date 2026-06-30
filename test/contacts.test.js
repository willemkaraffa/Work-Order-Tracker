'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function run(dumpFile, label) {
  const d = JSON.parse(fs.readFileSync(dumpFile, 'utf8'));
  const dom = new JSDOM(d.html, { url: d.url });
  Object.defineProperty(dom.window.document.body, 'innerText', {
    configurable: true, get: () => d.innerText,
  });
  global.window = dom.window;
  global.document = dom.window.document;
  global.location = dom.window.location;
  delete require.cache[require.resolve(path.join(__dirname,'..','scraper-extract.js'))];
  const api = require(path.join(__dirname,'..','scraper-extract.js'));
  const r = api.amhContacts();
  console.log('===', label, '===');
  console.log(JSON.stringify(r, null, 2));
  return r;
}

const FIX = path.join(__dirname, 'fixtures');
const fileA = path.join(FIX, 'wo-dump-AMH-1779481024875.json');
if (!fs.existsSync(fileA)) { console.log('SKIP contacts: fixture missing'); process.exit(2); }

const a = run(fileA, 'WO 9723779 (single contact)');
if (!a.length || a[0].name !== 'ReShanda Alston' || a[0].phone !== '9843993844') { console.error('FAIL A'); process.exit(1); }

try {
  const b = run(path.join(FIX, 'wo-dump-AMH-1779982058902.json'), 'WO 9731934 (two contacts, concatenated role)');
  if (b.length !== 2) { console.error('FAIL B: expected 2 contacts, got', b.length); process.exit(1); }
  if (!/PRIMARY CONTACT/.test(b[0].role) || b[0].name !== 'Donelle King' || b[0].phone !== '8572695684') { console.error('FAIL B primary'); process.exit(1); }
  if (b[1].name !== 'Damion King' || b[1].phone !== '4752807301') { console.error('FAIL B secondary'); process.exit(1); }
} catch (e) {
  if (e.code === 'ENOENT') console.log('(WO 9731934 fixture missing — skipped)');
  else throw e;
}

console.log('PASS');
