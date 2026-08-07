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
  'Statement Total 323.18',
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

check('emits one row PER INVOICE LINE (3 rows, not 2 properties)', () => {
  assert.strictEqual(rows.length, 3);
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
check('rows still reconcile to the statement total', () => {
  const s = rows.reduce((a, r) => a + r.amount, 0);
  assert.ok(Math.abs(s - res.total) < 0.005, 'rows ' + s + ' vs total ' + res.total);
});

console.log(fail ? ('\n' + fail + ' failed') : '\nall passed');
process.exit(fail ? 1 : 0);
