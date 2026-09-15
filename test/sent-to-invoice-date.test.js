'use strict';
// sentToInvoiceIso: the Invoices "Sent" column shows when a WO ORIGINALLY hit the
// billing queue, so it must take the FIRST 'sent to billing' entry (a reopen +
// resend must not move it) and must not throw on sparse/hand-edited records.
// SHIPPED code via the esbuild bridge. Exit 0 pass / 1 fail.
const assert = require('assert');
const { loadEsm } = require('./_load.js');
const { sentToInvoiceIso } = loadEsm('src/orders-logic.js');

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e.message }); }
}

const at = (y, m, d, h) => new Date(y, m - 1, d, h == null ? 12 : h).getTime();

test('takes the FIRST sent-to-billing entry, not the most recent', () => {
  const o = { history: [
    { ts: at(2026, 1, 5),  action: 'marked complete' },
    { ts: at(2026, 2, 10), action: 'sent to billing queue' },
    { ts: at(2026, 3, 1),  action: 'reopened' },
    { ts: at(2026, 4, 20), action: 'sent to billing queue (bulk)' },
  ] };
  assert.strictEqual(sentToInvoiceIso(o), '2026-02-10');
});

test('matches the bulk variant too', () => {
  const o = { history: [{ ts: at(2026, 7, 4), action: 'sent to billing queue (bulk)' }] };
  assert.strictEqual(sentToInvoiceIso(o), '2026-07-04');
});

test('late-evening send reports the LOCAL date, not tomorrow in UTC', () => {
  const o = { history: [{ ts: at(2026, 6, 30, 23), action: 'sent to billing queue' }] };
  assert.strictEqual(sentToInvoiceIso(o), '2026-06-30');
});

test('no entry / sparse / bad ts returns empty string, never throws', () => {
  assert.strictEqual(sentToInvoiceIso({}), '');
  assert.strictEqual(sentToInvoiceIso(null), '');
  assert.strictEqual(sentToInvoiceIso({ history: null }), '');
  assert.strictEqual(sentToInvoiceIso({ history: [{ action: 'sent to billing queue' }] }), '');
  assert.strictEqual(sentToInvoiceIso({ history: [{ ts: NaN, action: 'sent to billing queue' }] }), '');
  assert.strictEqual(sentToInvoiceIso({ history: [{ ts: at(2026, 1, 1), action: 'marked complete' }] }), '');
});

let fail = 0;
for (const r of results) {
  if (r.ok) console.log('  PASS ' + r.name);
  else { fail++; console.log('  FAIL ' + r.name + ' :: ' + r.err); }
}
console.log((results.length - fail) + '/' + results.length + ' passed');
process.exit(fail ? 1 : 0);
