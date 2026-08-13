'use strict';
// scrape_amh open-orders enumeration. _fetch_bucket paginates ONE VendorAdminOrders tab
// (POST Order/VendorAdminOrders {type:<tab>}) and terminates correctly; fetch_open_orders
// queries the UNION of OPEN_BUCKETS and dedups by base WO number (first bucket wins). The
// old GET Order/Query is retired (403s a valid token). Fixture-free: monkeypatches the
// SHIPPED scrape_amh.api_post with a fake serving canned pages, runs the real functions
// via python -c (no network). Exit 0 pass / 1 fail / 2 skip.
const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');
const REPO = path.join(__dirname, '..');

// The python program: patch api_post, run scenarios, emit JSON the node side asserts.
const CODE = [
  'import json, sys',
  'sys.path.insert(0, sys.argv[1])',
  'import scrape_amh',
  '',
  '# Scenario 1: _fetch_bucket -- two pages, hasNextPage flips false on page 1.',
  'calls = []',
  'def fake_paginate(path, token, body):',
  '    calls.append({"path": path, "type": body["type"], "page": body["paging"]["pageIndex"]})',
  '    idx = body["paging"]["pageIndex"]',
  '    if idx == 0:',
  '        return {"orders": [{"order": {"name": "1"}}], "hasNextPage": True}',
  '    return {"orders": [{"order": {"name": "2"}}, {"order": {"name": "3"}}], "hasNextPage": False}',
  'scrape_amh.api_post = fake_paginate',
  'paginate_orders = scrape_amh._fetch_bucket("T", "AllOpen", 50, 40)',
  '',
  '# Scenario 2: _fetch_bucket empty-batch guard -- orders:[] stops even with hasNextPage true.',
  'empty_calls = []',
  'def fake_empty(path, token, body):',
  '    empty_calls.append(body["paging"]["pageIndex"])',
  '    idx = body["paging"]["pageIndex"]',
  '    if idx == 0:',
  '        return {"orders": [{"order": {"name": "10"}}], "hasNextPage": True}',
  '    return {"orders": [], "hasNextPage": True}',
  'scrape_amh.api_post = fake_empty',
  'empty_orders = scrape_amh._fetch_bucket("T", "AllOpen", 50, 40)',
  '',
  '# Scenario 3: _fetch_bucket max_pages guard -- every page hasNextPage true, must cap.',
  'cap_calls = []',
  'def fake_forever(path, token, body):',
  '    cap_calls.append(body["paging"]["pageIndex"])',
  '    return {"orders": [{"order": {"name": "x"}}], "hasNextPage": True}',
  'scrape_amh.api_post = fake_forever',
  'cap_orders = scrape_amh._fetch_bucket("T", "AllOpen", 50, 3)',
  '',
  '# Scenario 4: fetch_open_orders union + dedup. Each bucket returns a shared WO "S"',
  '# (marked with its bucket) plus a bucket-unique WO named after the bucket.',
  'seen_types = []',
  'def fake_union(path, token, body):',
  '    seen_types.append(body["type"])',
  '    if body["paging"]["pageIndex"] == 0:',
  '        return {"orders": [{"order": {"name": "S"}, "mark": body["type"]}, {"order": {"name": body["type"]}}], "hasNextPage": False}',
  '    return {"orders": [], "hasNextPage": False}',
  'scrape_amh.api_post = fake_union',
  'union_orders = scrape_amh.fetch_open_orders("T")',
  's_envs = [it for it in union_orders if (it.get("order") or {}).get("name") == "S"]',
  '',
  '# Scenario 5: base-number fold. "7746663" (AllOpen) and its split child "7746663-1"',
  '# (SchedulingRequired) share a base, so only the first survives.',
  'def fake_split(path, token, body):',
  '    t = body["type"]',
  '    if body["paging"]["pageIndex"] != 0:',
  '        return {"orders": [], "hasNextPage": False}',
  '    if t == "AllOpen":',
  '        return {"orders": [{"order": {"name": "7746663"}}], "hasNextPage": False}',
  '    if t == "SchedulingRequired":',
  '        return {"orders": [{"order": {"name": "7746663-1"}}], "hasNextPage": False}',
  '    return {"orders": [], "hasNextPage": False}',
  'scrape_amh.api_post = fake_split',
  'split_orders = scrape_amh.fetch_open_orders("T")',
  '',
  'print(json.dumps({',
  '    "paginate": {"count": len(paginate_orders), "calls": calls},',
  '    "empty": {"count": len(empty_orders), "callCount": len(empty_calls)},',
  '    "cap": {"count": len(cap_orders), "callCount": len(cap_calls)},',
  '    "buckets": scrape_amh.OPEN_BUCKETS,',
  '    "union": {',
  '        "types": seen_types,',
  '        "distinctTypes": sorted(set(seen_types)),',
  '        "total": len(union_orders),',
  '        "sCount": len(s_envs),',
  '        "sMark": (s_envs[0].get("mark") if s_envs else None),',
  '        "names": sorted((it.get("order") or {}).get("name") for it in union_orders),',
  '    },',
  '    "split": {"count": len(split_orders), "names": sorted((it.get("order") or {}).get("name") for it in split_orders)},',
  '}))',
].join('\n');

let out;
try {
  out = execFileSync('python', ['-c', CODE, REPO], { cwd: REPO, encoding: 'utf8' });
} catch (e) {
  console.log('SKIP fetch-open-orders: ' + String((e && e.message) || e).split('\n')[0]);
  process.exit(2);
}
const res = JSON.parse(out);

let fail = 0;
const check = (name, fn) => { try { fn(); console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); } };

check('_fetch_bucket pagination accumulates across pages (1 + 2 = 3 orders)', () => {
  assert.strictEqual(res.paginate.count, 3);
});
check('_fetch_bucket stops when hasNextPage flips false (exactly 2 api_post calls)', () => {
  assert.strictEqual(res.paginate.calls.length, 2);
});
check('_fetch_bucket hits the live open-orders endpoint with the given bucket type', () => {
  assert.strictEqual(res.paginate.calls[0].path, 'Order/VendorAdminOrders');
  assert.strictEqual(res.paginate.calls[0].type, 'AllOpen');
});
check('_fetch_bucket walks pageIndex 0 then 1', () => {
  assert.strictEqual(res.paginate.calls[0].page, 0);
  assert.strictEqual(res.paginate.calls[1].page, 1);
});
check('_fetch_bucket empty-batch guard: stops on orders:[] despite hasNextPage true', () => {
  assert.strictEqual(res.empty.callCount, 2); // page0 (1 order) + page1 (empty) then break
  assert.strictEqual(res.empty.count, 1);
});
check('_fetch_bucket max_pages guard: caps at max_pages, does not hang', () => {
  assert.strictEqual(res.cap.callCount, 3);
  assert.strictEqual(res.cap.count, 3);
});
check('fetch_open_orders queries every open bucket and excludes Posted', () => {
  assert.deepStrictEqual(res.union.distinctTypes, [...res.buckets].sort());
  assert.ok(!res.union.types.includes('Posted'), 'Posted must not be queried');
});
check('fetch_open_orders dedups a WO seen in multiple buckets, first bucket wins', () => {
  assert.strictEqual(res.union.sCount, 1);
  assert.strictEqual(res.union.sMark, 'AllOpen');
  assert.strictEqual(res.union.total, res.buckets.length + 1); // shared S + one unique per bucket
  assert.deepStrictEqual(res.union.names, ['S', ...res.buckets].sort());
});
check('fetch_open_orders folds a split -N WO to its base and keeps one', () => {
  assert.strictEqual(res.split.count, 1);
  assert.deepStrictEqual(res.split.names, ['7746663']);
});

console.log(fail ? ('\n' + fail + ' failed') : '\nall passed');
process.exit(fail ? 1 : 0);
