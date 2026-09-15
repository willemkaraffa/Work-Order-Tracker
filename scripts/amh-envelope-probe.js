'use strict';
// Live AMH envelope-shape probe. RUN THIS AFTER ANY AMH ENDPOINT CHANGE.
//
// Why it exists: on 2026-08-19 the bulk feed (POST Order/VendorAdminOrders) was found to
// return customers:[] for every order, while GET Order/{guid} on the SAME order returns
// the real customers with phone numbers. Bulk capture therefore wrote phone="" and
// contactName="" on every WO and still exited 0. No unit test can catch that: the fixture
// is hand-written, so it always contains the field the live API stopped sending.
//
// This probe calls BOTH endpoints on the same real WO and compares. It fails when a
// required field is empty on the DETAIL endpoint (the API shape moved) and reports which
// fields the LIST feed drops (those must be hydrated, see hydrate_customers).
//
// Needs a live AMH session in the persisted Playwright profile. Not part of `npm run
// verify` -- that gate must stay offline and deterministic. Run: npm run probe:amh
const { getAmhToken } = require('../amh-pw-token.js');

const API = 'https://app.amh.com/services-api/api';
const headers = (t) => ({
  Authorization: t, Accept: 'application/json', 'Content-Type': 'application/json',
  Origin: 'https://www.amh.com', Referer: 'https://www.amh.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
});

// Envelope keys scrape_amh.build_wo actually reads. Empty on the detail endpoint = the
// capture is silently degraded, which is the whole failure class this guards.
// Overridable so the probe's own failure path can be exercised (AMH_PROBE_REQUIRED=bogus
// must exit 1); a gate never seen to fail is decoration.
const REQUIRED = (process.env.AMH_PROBE_REQUIRED
  || 'customers,condititionIssueInstances,remedyInstances').split(',').map(s => s.trim()).filter(Boolean);
const count = (v) => (Array.isArray(v) ? v.length : (v ? 1 : 0));

(async () => {
  const token = await getAmhToken();
  const body = { type: 'AllOpen', paging: { pageIndex: 0, pageSize: 3, sortBy: 'status', sortAscending: false } };
  const lr = await fetch(API + '/Order/VendorAdminOrders', { method: 'POST', headers: headers(token), body: JSON.stringify(body) });
  if (!lr.ok) throw new Error('list feed HTTP ' + lr.status);
  const lj = await lr.json();
  const list = Array.isArray(lj) ? lj : (lj.orders || lj.items || lj.data || []);
  if (!list.length) throw new Error('list feed returned 0 orders (cannot probe shape)');

  const today = new Date().toISOString().slice(0, 10) + 'T04:00:00.000Z';
  const fails = [], drops = new Set();

  for (const env of list) {
    const o = env.order || env;
    const dr = await fetch(API + '/Order/' + o.id + '?today=' + encodeURIComponent(today), { headers: headers(token) });
    if (!dr.ok) { fails.push(`WO ${o.name}: detail HTTP ${dr.status}`); continue; }
    const det = await dr.json();
    const row = [];
    for (const k of REQUIRED) {
      const l = count(env[k]), d = count(det[k]);
      row.push(`${k} list=${l} detail=${d}`);
      if (!d) fails.push(`WO ${o.name}: ${k} EMPTY on detail endpoint (API shape moved)`);
      else if (!l) drops.add(k);
    }
    if (!((o.property || {}).address || {}).street) fails.push(`WO ${o.name}: no property.address.street`);
    console.log(`WO ${o.name}: ` + row.join(' | '));
  }

  if (drops.size) {
    console.log('\nLIST FEED DROPS (must be hydrated per-WO): ' + [...drops].join(', '));
    for (const k of drops) {
      if (k !== 'customers') fails.push(`${k} is dropped by the list feed and nothing hydrates it`);
    }
  }

  if (fails.length) { console.error('\nFAIL:\n  ' + fails.join('\n  ')); process.exit(1); }
  console.log('\nOK: every required field present on the detail endpoint; known drops are hydrated.');
})().catch((e) => { console.error('PROBE ERROR: ' + (e && e.message)); process.exit(1); });
