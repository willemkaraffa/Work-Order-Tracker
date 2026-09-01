'use strict';
// scrape_amh.choose_options_for_bid: the AMH wrong-amount capture.
//
// WO 9831067 captured $269.50; AMH paid $1714.50. Bid selection was NOT the bug --
// select_billed_bid already picked the invoiced, Paid bid 0092948. Inside that one bid sit
// two options: "Option 1" 1714.50 statusName Approved isPreferred FALSE, and "Option 2"
// 269.50 statusName Rejected isPreferred TRUE. Live option objects carry NO isApproved key
// at all (keys: isPreferred, canPerformNow, earliestWorkDate, created, updated, price,
// statusId, statusName, name, id, services), so the old isApproved filter was always empty
// and the isPreferred fallback returned the REJECTED option.
//
// THE FIXTURES BELOW ARE SHAPED FROM A REAL CAPTURE (live AMH payload, WO 9831067, pulled
// 2026-09-01). Names/ids/the amount split are invented and no customer data is copied; the
// SHAPE is the evidence -- above all the ABSENT isApproved key and the Rejected+isPreferred
// pairing. If you refresh these, re-pull a real payload; do not hand-edit them into whatever
// the code currently expects.
//
// Fixture-free (no network; build_wo is pure, so nothing needs monkeypatching): runs the
// SHIPPED scrape_amh via python -c. Exit 0 pass / 1 fail / 2 skip (python absent).
const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');
const REPO = path.join(__dirname, '..');

const CODE = [
  'import json, sys',
  'sys.path.insert(0, sys.argv[1])',
  'import scrape_amh',
  '',
  'def svc(name, price):',
  '    return {"remedyInstance": {"description": name}, "quantity": 1.0,',
  '            "unitPrice": price, "vendorTax": 0.0}',
  '',
  'def opt(name, price, status, preferred, services, **extra):',
  '    o = {"isPreferred": preferred, "canPerformNow": True, "earliestWorkDate": None,',
  '         "created": "2026-08-04T00:00:00Z", "updated": "2026-08-06T00:00:00Z",',
  '         "price": price, "statusId": "st-" + str(status).lower(), "statusName": status,',
  '         "name": name, "id": "opt-" + name.replace(" ", "-"), "services": services}',
  '    o.update(extra)',
  '    return o',
  '',
  'def env(bids):',
  '    return {"order": {"name": "9000001", "id": "11111111-2222-3333-4444-555555555555",',
  '                      "statusName": "Posted", "subStatusName": "Work Completed",',
  '                      "property": {"propertyNo": "NC00001",',
  '                                   "address": {"street": "1 Test St", "city": "Raleigh",',
  '                                               "state": "NC", "zipCode": "27601"}},',
  '                      "bids": bids},',
  '            "customers": [], "condititionIssueInstances": {}, "remedyInstances": {}}',
  '',
  '# 1. The real defect shape: invoiced bid, the Approved option is NOT preferred, the',
  '# Rejected one IS, and neither carries isApproved.',
  'real_bid = {"name": "0090001", "statusName": "Approved",',
  '            "invoices": [{"number": "W9000001B0090001"}],',
  '            "options": [opt("Option 1", 1714.50, "Approved", False,',
  '                            [svc("Replace water heater", 1500.00),',
  '                             svc("Replace drain pan", 214.50)]),',
  '                        opt("Option 2", 269.50, "Rejected", True,',
  '                            [svc("Diagnostic fee", 269.50)])]}',
  'built = scrape_amh.build_wo(env([real_bid]))',
  'fixture_keys = sorted(real_bid["options"][0].keys())',
  'picked = [o["name"] for o in scrape_amh.choose_options_for_bid(real_bid)]',
  'billed = scrape_amh.select_billed_bid(env([real_bid])["order"])',
  '',
  '# 2. A payload that DOES send isApproved keeps its old behaviour: isApproved wins.',
  'legacy_bid = {"name": "0090002", "statusName": "Approved",',
  '              "invoices": [{"number": "W9000001B0090002"}],',
  '              "options": [opt("Legacy approved", 100.00, "Pending", False,',
  '                              [svc("Legacy line", 100.00)], isApproved=True),',
  '                          opt("Status approved", 500.00, "Approved", True,',
  '                              [svc("Other line", 500.00)], isApproved=False)]}',
  'legacy = scrape_amh.build_wo(env([legacy_bid]))',
  'legacy_picked = [o["name"] for o in scrape_amh.choose_options_for_bid(legacy_bid)]',
  '',
  '# 3. Neither isApproved nor a usable statusName -> the isPreferred fallback still works.',
  'pending_bid = {"name": "0090003", "statusName": "Approved",',
  '               "invoices": [{"number": "W9000001B0090003"}],',
  '               "options": [opt("Preferred pending", 300.00, "Pending", True,',
  '                               [svc("Preferred line", 300.00)]),',
  '                           opt("Unpreferred blank", 700.00, "", False,',
  '                               [svc("Other pending line", 700.00)])]}',
  'pending = scrape_amh.build_wo(env([pending_bid]))',
  'pending_picked = [o["name"] for o in scrape_amh.choose_options_for_bid(pending_bid)]',
  '',
  '# 4. A LONE Rejected option (also isPreferred) is never returned by any branch.',
  'rejected_bid = {"name": "0090004", "statusName": "Approved",',
  '                "invoices": [{"number": "W9000001B0090004"}],',
  '                "options": [opt("Option 1", 269.50, "Rejected", True,',
  '                                [svc("Diagnostic fee", 269.50)])]}',
  'rejected = scrape_amh.build_wo(env([rejected_bid]))',
  'rejected_picked = [o["name"] for o in scrape_amh.choose_options_for_bid(rejected_bid)]',
  '',
  'def slim(b):',
  '    w = b["wo"]',
  '    return {"woId": w["woId"], "bidAmount": w["bidAmount"],',
  '            "items": [i["name"] for i in w["bidItems"]]}',
  '',
  'print(json.dumps({',
  '    "fixtureOptionKeys": fixture_keys,',
  '    "real": {"wo": slim(built), "picked": picked,',
  '             "billedBid": billed.get("name") if billed else None},',
  '    "legacy": {"wo": slim(legacy), "picked": legacy_picked},',
  '    "pending": {"wo": slim(pending), "picked": pending_picked},',
  '    "rejected": {"wo": slim(rejected), "picked": rejected_picked},',
  '}))',
].join('\n');

let out;
try {
  out = execFileSync('python', ['-c', CODE, REPO], { cwd: REPO, encoding: 'utf8' });
} catch (e) {
  console.log('SKIP amh-bid-option: ' + String((e && e.message) || e).split('\n')[0]);
  process.exit(2);
}
const res = JSON.parse(out);

let fail = 0;
const check = (name, fn) => { try { fn(); console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); } };

check('the fixture still encodes the trap: options carry NO isApproved key', () => {
  assert.ok(!res.fixtureOptionKeys.includes('isApproved'),
    'isApproved must be absent or this tests nothing: ' + res.fixtureOptionKeys.join(','));
  assert.ok(res.fixtureOptionKeys.includes('statusName'));
  assert.ok(res.fixtureOptionKeys.includes('isPreferred'));
});
check('bid selection was never the bug: the invoiced bid is still picked', () => {
  assert.strictEqual(res.real.billedBid, '0090001');
});
check('the APPROVED option is captured, not the preferred REJECTED one', () => {
  assert.deepStrictEqual(res.real.picked, ['Option 1']);
  assert.strictEqual(res.real.wo.bidAmount, '1714.50');
});
check('the rejected option contributes no line items', () => {
  assert.deepStrictEqual(res.real.wo.items, ['Replace water heater', 'Replace drain pan']);
});
check('a payload that DOES carry isApproved behaves as before', () => {
  assert.deepStrictEqual(res.legacy.picked, ['Legacy approved']);
  assert.strictEqual(res.legacy.wo.bidAmount, '100.00');
});
check('no isApproved and no usable statusName -> isPreferred fallback', () => {
  assert.deepStrictEqual(res.pending.picked, ['Preferred pending']);
  assert.strictEqual(res.pending.wo.bidAmount, '300.00');
});
check('a lone Rejected option is never returned, even though it is preferred', () => {
  assert.deepStrictEqual(res.rejected.picked, []);
  assert.strictEqual(res.rejected.wo.bidAmount, '');
  assert.deepStrictEqual(res.rejected.wo.items, []);
});

console.log(fail ? ('\n' + fail + ' failed') : '\nall passed');
process.exit(fail ? 1 : 0);
