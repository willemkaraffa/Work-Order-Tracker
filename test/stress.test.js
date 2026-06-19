'use strict';
// Adversarial / edge-case stress tests for scraper-extract.js.
// Pure helpers hit directly via _internals; DOM-dependent paths via synthetic
// jsdom documents. Complements extract.test.js (real fixtures).
const path = require('path');
const { JSDOM } = require('jsdom');
const MODULE = path.join(__dirname, '..', 'scraper-extract.js');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; } else { fail++; console.log(`  FAIL ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
}
function truthy(label, got) {
  if (got) { pass++; } else { fail++; console.log(`  FAIL ${label}: got ${JSON.stringify(got)} (expected truthy)`); }
}

// Load module fresh against a given DOM (or a blank one for pure helpers).
function load(html, url) {
  const dom = new JSDOM(html || '<!doctype html><html><body></body></html>', { url: url || 'https://example.com/' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.location = dom.window.location;
  delete require.cache[require.resolve(MODULE)];
  return require(MODULE);
}
// Override body.innerText with arbitrary text (jsdom can't compute it).
function setText(t) { Object.defineProperty(document.body, 'innerText', { configurable: true, get: () => t }); }

console.log('\n== pure helpers ==');
{
  const { _internals: I } = load();

  // extractCityFromAddress
  eq('city: full addr', I.extractCityFromAddress('706 Midsummer Lane, Apex, NC 27502'), 'Apex');
  eq('city: spelled state', I.extractCityFromAddress('12404 Kendall Ridge Court, Durham, North Carolina 27703'), 'Durham');
  eq('city: no zip', I.extractCityFromAddress('1036 Statler Drive, Durham, NC'), 'Durham');
  eq('city: empty', I.extractCityFromAddress(''), '');
  eq('city: street only', I.extractCityFromAddress('706 Midsummer Lane'), '');
  eq('city: garbage', I.extractCityFromAddress('foo'), '');

  // extractAddressCity (pure: takes bodyText)
  eq('addr: AMH same-line no state', I.extractAddressCity('36 Gregory Drive, Clayton, 27520'), { address: '36 Gregory Drive', city: 'Clayton' });
  eq('addr: same-line state+zip', I.extractAddressCity('100 Oak St, Cary, NC 27511'), { address: '100 Oak St', city: 'Cary' });
  eq('addr: two-line MSR', I.extractAddressCity('4112 Viewmont Dr\nRaleigh, North Carolina 27610'), { address: '4112 Viewmont Dr', city: 'Raleigh' });
  eq('addr: none', I.extractAddressCity('no address here at all'), { address: '', city: '' });
  eq('addr: empty/null', I.extractAddressCity(null), { address: '', city: '' });
  eq('addr: number but not street', I.extractAddressCity('5 items in cart'), { address: '', city: '' });
  // unit/apt suffix should still grab street, city
  eq('addr: apt', I.extractAddressCity('200 Main St Apt 4, Durham, NC 27701'), { address: '200 Main St Apt 4', city: 'Durham' });

  // mapPriority
  eq('pri: 3-MEDIUM', I.mapPriority('3 - MEDIUM'), 'Medium');
  eq('pri: 1 high', I.mapPriority('1 - HIGH'), 'High');
  eq('pri: urgent', I.mapPriority('Urgent'), 'High');
  eq('pri: routine', I.mapPriority('Routine'), 'Low');
  eq('pri: warranty', I.mapPriority('Warranty Claim'), 'Warranty');
  eq('pri: empty', I.mapPriority(''), 'Medium');

  // mapTradeToType
  eq('type: plumbing', I.mapTradeToType('Plumbing'), 'Plumbing');
  eq('type: minor plumbing', I.mapTradeToType('MINOR PLUMBING'), 'Plumbing');
  eq('type: cooling', I.mapTradeToType('Heating & cooling'), 'HVAC');
  eq('type: air', I.mapTradeToType('Air conditioner'), 'HVAC');
  eq('type: electrical', I.mapTradeToType('Major Electrical'), 'Electrical');
  eq('type: appliance', I.mapTradeToType('Appliance Repair'), 'Appliance');
  eq('type: unknown', I.mapTradeToType('Landscaping'), 'Other');
  eq('type: empty', I.mapTradeToType(''), 'Other');

  // applyMappings
  eq('map: accepted', I.applyMappings('WORK ORDER ACCEPTED', []), 'In Progress');
  eq('map: parts', I.applyMappings('Parts on order', []), 'Parts Pending');
  eq('map: completed', I.applyMappings('Completed', []), 'Pending-Complete');
  eq('map: closed', I.applyMappings('Cancelled', []), 'Closed');
  eq('map: unknown->Open', I.applyMappings('Some Weird Status', []), 'Open');
  eq('map: empty->Open', I.applyMappings('', []), 'Open');
  eq('map: user mapping wins', I.applyMappings('UNSCHEDULED', [{ portal: 'unscheduled', tracker: 'Open' }]), 'Open');

  // toISODate
  eq('date: mdy', I.toISODate('05/21/2026'), '2026-05-21');
  eq('date: single digits', I.toISODate('5/1/2026'), '2026-05-01');
  eq('date: junk -> today', /^\d{4}-\d{2}-\d{2}$/.test(I.toISODate('not a date')) ? 'iso' : 'bad', 'iso');
}

console.log('\n== extractWONumber (DOM) ==');
{
  let api = load('<!doctype html><title>Work Order: 9723779</title><body></body>', 'https://www.amh.com/x');
  setText('Work Order # 9723779');
  eq('AMH 7-digit from title', api._internals.extractWONumber(), '9723779');

  api = load('<!doctype html><title>x</title><body></body>', 'https://www.amh.com/my-amh/vendor-user-orders/abc?tabId=general');
  setText('Work Order | 9698891706'); // concatenated nonce -> slice 7
  eq('AMH slices nonce to 7', api._internals.extractWONumber(), '9698891');

  api = load('<!doctype html><title>Work Order: 02761757</title><body></body>', 'https://amherst.my.site.com/partner/s/workorder/x');
  setText('');
  eq('MSR keeps leading zeros (5+)', api._internals.extractWONumber(), '02761757');

  api = load('<!doctype html><title>Nothing</title><body></body>', 'https://www.amh.com/x');
  setText('no numbers anywhere');
  eq('no WO -> empty', api._internals.extractWONumber(), '');
}

console.log('\n== amhIssues (DOM) HVAC + empty ==');
{
  let api = load('<!doctype html><body></body>', 'https://www.amh.com/my-amh/vendor-user-orders/x?tabId=condition-issues');
  setText('General\nCondition Issues\nAC not cooling\nHVAC\nUNSCHEDULED\nDescription\nUnit blowing warm air upstairs\nLocation\n-');
  const hvac = api.amhIssues();
  eq('amhIssues HVAC type', hvac.type, 'HVAC');
  truthy('amhIssues HVAC notes has complaint', hvac.notes.includes('warm air'));

  api = load('<!doctype html><body></body>', 'https://www.amh.com/x?tabId=condition-issues');
  setText('General\nCondition Issues\nnothing useful here');
  const empty = api.amhIssues();
  eq('amhIssues empty -> Other', empty.type, 'Other');
}

console.log('\n== msr (DOM) no line items ==');
{
  const api = load('<!doctype html><title>Work Order: 02000001</title><body></body>', 'https://amherst.my.site.com/partner/s/workorder/x');
  setText('Work Order\n02000001\nStatus\n\nOpen\nProperty\n9 Birch Way\nRaleigh, NC 27601');
  const out = api.msr([]);
  eq('msr woId', out.woId, '02000001');
  eq('msr type fallback Other (no cells)', out.type, 'Other');
  eq('msr status Open', out.status, 'Open');
  truthy('msr portalLink set', out.portalLink.includes('workorder'));
}

console.log('\n== detectPortal ==');
{
  eq('detect AMH', load('<body></body>', 'https://www.amh.com/x').detectPortal(), 'AMH');
  eq('detect MSR', load('<body></body>', 'https://amherst.my.site.com/partner/s/workorder/x').detectPortal(), 'MSR');
  eq('detect unknown', load('<body></body>', 'https://google.com/').detectPortal(), 'UNKNOWN');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURES'} (${pass} ok)`);
process.exit(fail === 0 ? 0 : 1);
