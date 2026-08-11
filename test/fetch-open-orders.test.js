'use strict';
// scrape_amh.fetch_open_orders must paginate the live open-orders feed
// (POST Order/VendorAdminOrders {type:'AllOpen'}) and terminate correctly. The old
// GET Order/Query is retired (403s a valid token). Fixture-free: monkeypatches the
// SHIPPED scrape_amh.api_post with a fake serving canned pages by pageIndex, runs the
// real fetch_open_orders via python -c (no network). Exit 0 pass / 1 fail / 2 skip.
const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');
const REPO = path.join(__dirname, '..');

// The python program: patch api_post, run three scenarios, emit JSON the node side asserts.
const CODE = [
  'import json, sys',
  'sys.path.insert(0, sys.argv[1])',
  'import scrape_amh',
  '',
  '# Scenario 1: two pages, hasNextPage flips false on page 1.',
  'calls = []',
  'def fake_paginate(path, token, body):',
  '    calls.append({"path": path, "type": body["type"], "page": body["paging"]["pageIndex"]})',
  '    idx = body["paging"]["pageIndex"]',
  '    if idx == 0:',
  '        return {"orders": [{"order": {"name": "1"}}], "hasNextPage": True}',
  '    return {"orders": [{"order": {"name": "2"}}, {"order": {"name": "3"}}], "hasNextPage": False}',
  'scrape_amh.api_post = fake_paginate',
  'paginate_orders = scrape_amh.fetch_open_orders("T")',
  '',
  '# Scenario 2: empty-batch guard -- orders:[] stops even with hasNextPage true.',
  'empty_calls = []',
  'def fake_empty(path, token, body):',
  '    empty_calls.append(body["paging"]["pageIndex"])',
  '    idx = body["paging"]["pageIndex"]',
  '    if idx == 0:',
  '        return {"orders": [{"order": {"name": "10"}}], "hasNextPage": True}',
  '    return {"orders": [], "hasNextPage": True}',
  'scrape_amh.api_post = fake_empty',
  'empty_orders = scrape_amh.fetch_open_orders("T")',
  '',
  '# Scenario 3: max_pages guard -- every page hasNextPage true, must cap and not hang.',
  'cap_calls = []',
  'def fake_forever(path, token, body):',
  '    cap_calls.append(body["paging"]["pageIndex"])',
  '    return {"orders": [{"order": {"name": "x"}}], "hasNextPage": True}',
  'scrape_amh.api_post = fake_forever',
  'cap_orders = scrape_amh.fetch_open_orders("T", max_pages=3)',
  '',
  'print(json.dumps({',
  '    "paginate": {"count": len(paginate_orders), "calls": calls},',
  '    "empty": {"count": len(empty_orders), "callCount": len(empty_calls)},',
  '    "cap": {"count": len(cap_orders), "callCount": len(cap_calls)},',
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

check('pagination accumulates across pages (1 + 2 = 3 orders)', () => {
  assert.strictEqual(res.paginate.count, 3);
});
check('stops when hasNextPage flips false (exactly 2 api_post calls)', () => {
  assert.strictEqual(res.paginate.calls.length, 2);
});
check('hits the live open-orders endpoint with type AllOpen', () => {
  assert.strictEqual(res.paginate.calls[0].path, 'Order/VendorAdminOrders');
  assert.strictEqual(res.paginate.calls[0].type, 'AllOpen');
});
check('walks pageIndex 0 then 1', () => {
  assert.strictEqual(res.paginate.calls[0].page, 0);
  assert.strictEqual(res.paginate.calls[1].page, 1);
});
check('empty-batch guard: stops on orders:[] despite hasNextPage true', () => {
  assert.strictEqual(res.empty.callCount, 2); // page0 (1 order) + page1 (empty) then break
  assert.strictEqual(res.empty.count, 1);
});
check('max_pages guard: caps at max_pages, does not hang', () => {
  assert.strictEqual(res.cap.callCount, 3);
  assert.strictEqual(res.cap.count, 3);
});

console.log(fail ? ('\n' + fail + ' failed') : '\nall passed');
process.exit(fail ? 1 : 0);
