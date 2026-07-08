'use strict';
// AMH remittance reconcile (invoice-generation Slice 2): matchAmhRow + reconcileAmhRow.
// Pure, fixture-free. Row shape from parse_amh_remittance.py (W<wo>B<bid> format, proven
// vs real ACHVendor PDF). Core Truth #2: AMH inclusive line amount = qty*unitPrice +
// vendorTax, taxable:false EXCEPT service/diagnostic/emergency (#3). Exit 0 pass / 1 fail.
const assert = require('assert');
const { loadEsm } = require('./_load.js');
const { matchAmhRow, reconcileAmhRow } = loadEsm('src/orders-logic.js');

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e.message }); }
}

const ORDERS = [
  { id: 'WO-201', woId: '9692517', pm: 'AMH', address: '10 Oak St', type: 'Plumbing' },
  { id: 'WO-202', woId: '9698891', pm: 'AMH', address: '22 Pine Ave', type: 'HVAC' },
];
const row = (o) => ({ woId: '', invoiceNum: '', bidNum: '', revisit: '', amount: 0, date: '', ...o });

test('matchAmhRow matches by WO number (digits between W and B)', () => {
  const m = matchAmhRow(row({ woId: '9692517' }), ORDERS);
  assert.strictEqual(m.matchBy, 'woId');
  assert.strictEqual(m.order.id, 'WO-201');
});

test('inclusive line amount = qty*unitPrice + vendorTax; sums to paid -> match', () => {
  const r = row({ woId: '9692517', invoiceNum: 'W9692517B0042838', bidNum: '0042838', amount: 351.03 });
  const m = matchAmhRow(r, ORDERS);
  // 300 + 21.75 (7.25% vendorTax) + 29.28 material(vendorTax 0) = 351.03
  const rep = reconcileAmhRow(r, m, [
    { name: 'Replace contactor', unitPrice: 300, vendorTax: 21.75, qty: 1 },
    { name: 'Capacitor', unitPrice: 29.28, vendorTax: 0, qty: 1 },
  ]);
  assert.strictEqual(rep.computed, 351.03);
  assert.strictEqual(rep.status, 'match');
  assert.strictEqual(rep.lines[0].amount, 321.75);
});

test('AMH Premier lines are non-taxable; service call forced taxable (truths #2/#3)', () => {
  const r = row({ woId: '9692517', amount: 100 });
  const rep = reconcileAmhRow(r, matchAmhRow(r, ORDERS), [
    { name: 'HVAC - Service Call', unitPrice: 90, vendorTax: 0, qty: 1 },
    { name: 'Replace blower motor', unitPrice: 10, vendorTax: 0, qty: 1 },
  ]);
  assert.strictEqual(rep.lines[0].taxable, true);   // service call -> taxable
  assert.strictEqual(rep.lines[1].taxable, false);  // Premier labor -> inclusive, not taxed
});

test('aged-out WO (matched, no API items) -> unavailable, not error', () => {
  const r = row({ woId: '9698891', amount: 214.50 });
  const rep = reconcileAmhRow(r, matchAmhRow(r, ORDERS), []);
  assert.strictEqual(rep.status, 'unavailable');
  assert.ok(/aged out/i.test(rep.flags[0]));
});

test('no WO found -> unmatched', () => {
  const r = row({ woId: '9999999', amount: 50 });
  const rep = reconcileAmhRow(r, matchAmhRow(r, ORDERS), []);
  assert.strictEqual(rep.status, 'unmatched');
  assert.strictEqual(rep.orderId, null);
});

test('computed != paid -> off, flagged', () => {
  const r = row({ woId: '9692517', amount: 400 });
  const rep = reconcileAmhRow(r, matchAmhRow(r, ORDERS), [{ name: 'Labor', unitPrice: 300, vendorTax: 21.75, qty: 1 }]);
  assert.strictEqual(rep.status, 'off');
  assert.strictEqual(rep.delta, -78.25);
});

console.log('reconcile-amh test');
console.log('==================');
let pass = 0, fail = 0;
for (const r of results) {
  if (r.ok) { pass++; console.log('  OK  ' + r.name); }
  else { fail++; console.log('  XX  ' + r.name + '\n      ' + r.err); }
}
console.log('\nTotal: ' + (pass + fail) + ' | Pass: ' + pass + ' | Fail: ' + fail);
process.exit(fail ? 1 : 0);
