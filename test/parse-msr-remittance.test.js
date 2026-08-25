'use strict';
// Bug 2: parse_msr_remittance.parse_text must emit ONE row per invoice line, not one per
// property. A property block with a charge + a credit (netting to the subtotal) used to
// collapse to a single row on the FIRST invoice, dropping the credit. Fixture-free: feeds
// SYNTHETIC pdfplumber-shaped text to the SHIPPED parse_text via python -c (no PDF, so no
// real payment data in the repo, and pdfplumber need not be installed). Exit 0/1, 2 skip.
const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');
const REPO = path.join(__dirname, '..');

const TEXT = [
  'Vendor ACH Statement',
  '3797 (bf5rsv01) - Gamble Plumbing (v0050419) - 08/03/26 5416 Advantis p1702767 317.50 08/03/2026 PI000356909',
  '(08/26) Dr',
  'Invoice Notes : 03943623',
  'Total For p1702767 317.50',
  '2674 (rh2rsv01) - Gamble Plumbing (v0050419) - 08/03/26 306 Dell p1726269 230.68 08/03/2026 PI000356857',
  '(08/26) Meadows Pl',
  'Invoice Notes : 03913657',
  '2674 (rh2rsv01) - Gamble Plumbing (v0050419) - 08/03/26 306 Dell p1726269 -225.00 08/03/2026 PI000359585',
  '(08/26) Meadows Pl',
  'Invoice Notes : 03381381',
  'Total For p1726269 5.68',
  // Bug 3: a RazorSync GUID in Invoice Notes. The old (\d+) read its LEADING digit run and
  // emitted woId "3", which matched the minted order id WO-003 (315 W Barnes St) -- this
  // 110 Margaret Dr payment reconciled against the wrong WO with no verify flag.
  '3502 (bf2rsv03) - Gamble Plumbing (v0050419) - 08/13/26 110 Margaret p5036758 696.27 08/13/2026 PI000376562',
  '(08/26) Dr',
  'Invoice Notes : 3da7f30a-314e-41be-9203-d084ae85744b',
  'Total For p5036758 696.27',
  // Bug 4: a BARE-numeric property code (no p prefix) survived the p-code strip and stayed
  // wedged in the wrapped street -> "129 Awesome 10003006 Ridge" (live junk order
  // "82 | 19 Labradoodle 10002980 Court"), killing the address fallback.
  '1398 (mrmrsv11) - Gamble Plumbing (v0050419) - 08/13/26 129 Awesome 10003006 449.07 08/13/2026 PI000375096',
  '(08/26) Ridge',
  'Invoice Notes : 04063139',
  'Total For 10003006 449.07',
  'Statement Total 1468.52',
].join('\n');

let out;
try {
  const code = 'import json,sys; import parse_msr_remittance as m; ' +
    'rows,total=m.parse_text(sys.stdin.read()); print(json.dumps({"rows":rows,"total":total}))';
  out = execFileSync('python', ['-c', code], { input: TEXT, cwd: REPO, encoding: 'utf8' });
} catch (e) {
  console.log('SKIP parse-msr-remittance: ' + String((e && e.message) || e).split('\n')[0]);
  process.exit(2);
}
const res = JSON.parse(out);
const rows = res.rows || [];

let fail = 0;
const check = (name, fn) => { try { fn(); console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); } };

check('emits one row PER INVOICE LINE (5 rows, not 4 properties)', () => {
  assert.strictEqual(rows.length, 5);
});
check('p1726269 yields BOTH invoice lines, not one collapsed row', () => {
  assert.strictEqual(rows.filter(r => r.propCode === 'p1726269').length, 2);
});
check('the charge keeps its own amount 230.68 / WO 03913657', () => {
  const r = rows.find(x => x.invoiceNum === 'PI000356857');
  assert.ok(r, 'charge row missing');
  assert.strictEqual(r.amount, 230.68);
  assert.strictEqual(r.woId, '03913657');
});
check('the credit is preserved as -225.00 / WO 03381381', () => {
  const r = rows.find(x => x.invoiceNum === 'PI000359585');
  assert.ok(r, 'credit row missing');
  assert.strictEqual(r.amount, -225);
  assert.strictEqual(r.woId, '03381381');
});
check('a GUID Invoice Note yields NO woId, not its leading digit "3"', () => {
  const r = rows.find(x => x.invoiceNum === 'PI000376562');
  assert.ok(r, 'GUID-note row missing');
  assert.strictEqual(r.woId, '');
  assert.strictEqual(r.amount, 696.27);
});
check('the GUID row still parses its address 110 Margaret Dr', () => {
  const r = rows.find(x => x.invoiceNum === 'PI000376562');
  assert.strictEqual(r.addressRaw, '110 Margaret Dr');
});
check('a bare-numeric property code is stripped out of the address', () => {
  const r = rows.find(x => x.invoiceNum === 'PI000375096');
  assert.ok(r, 'bare-propCode row missing');
  assert.ok(!/10003006/.test(r.addressRaw), 'propCode leaked: ' + r.addressRaw);
  assert.strictEqual(r.addressRaw, '129 Awesome Ridge');
});
check('rows still reconcile to the statement total', () => {
  const s = rows.reduce((a, r) => a + r.amount, 0);
  assert.ok(Math.abs(s - res.total) < 0.005, 'rows ' + s + ' vs total ' + res.total);
});

console.log(fail ? ('\n' + fail + ' failed') : '\nall passed');
process.exit(fail ? 1 : 0);
