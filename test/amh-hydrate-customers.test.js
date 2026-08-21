'use strict';
// scrape_amh.hydrate_customers: the AMH contact-capture hole (fixed de86cb9).
//
// The POST Order/VendorAdminOrders LIST feed carries the `customers` KEY but it is an
// EMPTY array on every envelope; GET Order/{guid} returns it populated. extract_contacts
// was correct the whole time, its input was empty, so both bulk paths wrote phone="" and
// contactName="" while the single-WO GUID path stayed right. See overseer-casestudies/Case4.md.
//
// THE FIXTURES BELOW ARE SHAPED FROM A REAL CAPTURE (live probe 2026-08-21, WO 9845462:
// list customers=arr0, detail customers=arr2, every other sub-collection identical).
// Values are redacted; the SHAPE is the evidence. The predecessor test for this migration
// (fetch-open-orders) used invented envelopes with no fields, which is exactly why it could
// not see a field going empty. If you refresh these fixtures, re-probe -- do not hand-edit
// them into whatever the code currently expects.
//
// Fixture-free (no network): monkeypatches the SHIPPED scrape_amh.api_get and runs the real
// hydrate_customers + build_wo via python -c. Exit 0 pass / 1 fail / 2 skip.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const REPO = path.join(__dirname, '..');

const CODE = [
  'import json, sys',
  'sys.path.insert(0, sys.argv[1])',
  'import scrape_amh',
  '',
  '# A LIST-feed envelope, real key set, customers present but EMPTY (the trap).',
  'def list_env():',
  '    return {',
  '        "order": {"name": "9845462", "id": "dcbffefc-0a5d-7d75-8000-019fecda0d0e",',
  '                  "statusName": "Open", "subStatusName": "Scheduled",',
  '                  "property": {"propertyNo": "NC18135",',
  '                               "address": {"street": "1 Test St", "city": "Raleigh",',
  '                                           "state": "NC", "zipCode": "27601"}}},',
  '        "customers": [],',
  '        "properties": None,',
  '        "condititionIssueInstances": {"g1": {"conditionIssueName": "Water heater leaking",',
  '                                             "conditionIssueCategoryName": "Minor Plumbing",',
  '                                             "notes": "Plumbing - Other - leak at the tank"}},',
  '        "scoping": {}, "files": {}, "locations": {}, "assets": {},',
  '        "inventory": {}, "remedyInstances": {},',
  '    }',
  '',
  '# The DETAIL envelope for the same WO. Primary is SECOND on purpose: extract_contacts',
  '# must sort it to contacts[0]. Field names are the live ones.',
  'DETAIL_CUSTOMERS = [',
  '    {"firstName": "Ada", "lastName": "Byron", "email": "ada@example.invalid",',
  '     "phone": "5550001111", "homePhone": None, "otherPhone": None,',
  '     "isPrimary": False, "id": "c1"},',
  '    {"firstName": "Grace", "lastName": "Hopper", "email": "grace@example.invalid",',
  '     "phone": "5552223333", "homePhone": None, "otherPhone": None,',
  '     "isPrimary": True, "id": "c2"},',
  ']',
  '',
  'calls = []',
  'def fake_detail(path, token, params=None):',
  '    calls.append({"path": path, "params": params})',
  '    return {"order": {"name": "9845462"}, "customers": DETAIL_CUSTOMERS}',
  '',
  '# Scenario 1: empty customers -> hydrate refetches the detail envelope and build_wo',
  '# lands the PRIMARY contact.',
  'scrape_amh.api_get = fake_detail',
  'env = list_env()',
  'fixture_had_customers_key = "customers" in env',
  'fixture_customers_empty = env["customers"] == []',
  'built = scrape_amh.build_wo(scrape_amh.hydrate_customers("T", env))',
  '# Snapshot now: `calls` keeps accumulating through the later scenarios.',
  'calls_after_1 = list(calls)',
  '',
  '# Scenario 2: already populated -> NO extra fetch (do not pay a GET per WO for nothing).',
  'calls_before = len(calls)',
  'env2 = list_env()',
  'env2["customers"] = [dict(DETAIL_CUSTOMERS[1])]',
  'built2 = scrape_amh.build_wo(scrape_amh.hydrate_customers("T", env2))',
  'skipped_fetch = (len(calls) == calls_before)',
  '',
  '# Scenario 3: the detail call FAILS -> the WO still imports, just without a contact.',
  'def boom(path, token, params=None):',
  '    raise RuntimeError("503 Service Unavailable")',
  'scrape_amh.api_get = boom',
  'built3 = scrape_amh.build_wo(scrape_amh.hydrate_customers("T", list_env()))',
  '',
  '# Scenario 4: no order.id -> nothing to fetch, no call, no crash.',
  'scrape_amh.api_get = fake_detail',
  'calls_before4 = len(calls)',
  'env4 = list_env()',
  'env4["order"].pop("id")',
  'built4 = scrape_amh.build_wo(scrape_amh.hydrate_customers("T", env4))',
  'no_id_fetch = (len(calls) == calls_before4)',
  '',
  '# Scenario 5: detail ALSO returns an empty list -> degrade quietly, do not blow up.',
  'def empty_detail(path, token, params=None):',
  '    calls.append({"path": path, "params": params})',
  '    return {"customers": []}',
  'scrape_amh.api_get = empty_detail',
  'built5 = scrape_amh.build_wo(scrape_amh.hydrate_customers("T", list_env()))',
  '',
  'def slim(w):',
  '    return {"woId": w["woId"], "phone": w["phone"], "contactName": w["contactName"],',
  '            "contacts": w["contacts"], "type": w["type"], "notes": w["notes"]}',
  '',
  'print(json.dumps({',
  '    "fixture": {"hasKey": fixture_had_customers_key, "isEmpty": fixture_customers_empty},',
  '    "hydrated": slim(built["wo"]),',
  '    "calls": calls_after_1,',
  '    "populated": {"wo": slim(built2["wo"]), "skippedFetch": skipped_fetch},',
  '    "failed": slim(built3["wo"]),',
  '    "noId": {"wo": slim(built4["wo"]), "skippedFetch": no_id_fetch},',
  '    "emptyDetail": slim(built5["wo"]),',
  '}))',
].join('\n');

let out;
try {
  out = execFileSync('python', ['-c', CODE, REPO], { cwd: REPO, encoding: 'utf8' });
} catch (e) {
  console.log('SKIP amh-hydrate-customers: ' + String((e && e.message) || e).split('\n')[0]);
  process.exit(2);
}
const res = JSON.parse(out);

let fail = 0;
const check = (name, fn) => { try { fn(); console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); } };

check('the fixture still encodes the trap: list feed HAS a customers key and it is empty', () => {
  assert.strictEqual(res.fixture.hasKey, true, 'customers key must be present, not absent');
  assert.strictEqual(res.fixture.isEmpty, true, 'customers must be empty or this tests nothing');
});
check('empty customers are refilled from GET Order/{guid}', () => {
  assert.strictEqual(res.calls.length, 1);
  assert.strictEqual(res.calls[0].path, 'Order/dcbffefc-0a5d-7d75-8000-019fecda0d0e');
  assert.ok(res.calls[0].params && res.calls[0].params.today, 'detail endpoint needs today=');
});
check('the PRIMARY contact lands in phone + contactName (not merely the first row)', () => {
  assert.strictEqual(res.hydrated.phone, '5552223333');
  assert.strictEqual(res.hydrated.contactName, 'Grace Hopper');
  assert.strictEqual(res.hydrated.contacts.length, 2);
  assert.strictEqual(res.hydrated.contacts[0].primary, true);
});
check('the rest of the envelope still extracts (trade + notes survive hydration)', () => {
  assert.strictEqual(res.hydrated.woId, '9845462');
  assert.strictEqual(res.hydrated.type, 'Plumbing');
  assert.ok(res.hydrated.notes.includes('leak at the tank'), res.hydrated.notes);
});
check('an envelope that already has customers pays no extra GET', () => {
  assert.strictEqual(res.populated.skippedFetch, true);
  assert.strictEqual(res.populated.wo.phone, '5552223333');
});
check('a failed detail fetch still imports the WO, minus the contact', () => {
  assert.strictEqual(res.failed.woId, '9845462');
  assert.strictEqual(res.failed.phone, '');
  assert.strictEqual(res.failed.contactName, '');
});
check('an envelope with no order.id makes no call and does not crash', () => {
  assert.strictEqual(res.noId.skippedFetch, true);
  assert.strictEqual(res.noId.wo.phone, '');
});
check('a detail response that is also empty degrades quietly', () => {
  assert.strictEqual(res.emptyDetail.phone, '');
  assert.strictEqual(res.emptyDetail.woId, '9845462');
});

// Wiring guard. The defect was never in extract_contacts, it was that the bulk paths fed it
// an empty list, so a green unit test on the helper alone would repeat the original mistake:
// proving the part while the paths stay unwired. Both bulk call sites (the all-open loop and
// the WO-number loop) must route through hydrate_customers. The GUID path is deliberately
// NOT wrapped: it already hits the detail endpoint.
check('both bulk capture paths call hydrate_customers before build_wo', () => {
  const src = fs.readFileSync(path.join(REPO, 'scrape_amh.py'), 'utf8');
  const wired = (src.match(/build_wo\(hydrate_customers\(token, item\)\)/g) || []).length;
  assert.strictEqual(wired, 2, 'expected exactly 2 wired bulk call sites, found ' + wired);
});

console.log(fail ? ('\n' + fail + ' failed') : '\nall passed');
process.exit(fail ? 1 : 0);
