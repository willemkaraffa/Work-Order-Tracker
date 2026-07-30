'use strict';
// Runs the SHIPPED remittance parsers over REAL statements and checks the arithmetic.
//
// WHY THIS EXISTS. The two existing remittance tests are fixture-free: they assert the
// MATCHER against rows written by hand to mirror a real remittance. That tests the
// matcher, and it cannot catch a wrong assumption about the document, because the same
// assumption wrote the fixture. The PDF parsers themselves had NO test at all, so
// everything known about their accuracy came from one person running them once.
//
// FIXTURES ARE NOT IN THIS REPO and must never be: remittances carry payment amounts,
// addresses and EFT numbers. They are read from Downloads (or REMIT_DIR) and this test
// SKIPs with exit 2 when none are present, exactly like test/msr-extract.test.js.
//
//   node test/remittance-parsers.test.js
//   REMIT_DIR=D:/statements node test/remittance-parsers.test.js
//
// WHAT IT PINS
//   1. Rows sum to the stated total, per file. 310 rows across 37 real statements did
//      when this was written.
//   2. A file holding SEVERAL concatenated remittances totals ALL of them. Keeping only
//      the first reported a $2,732.97 payment as $75.00 (3 of 31 real AMH files).
//   3. An unrecognized document is REFUSED, not reported as an empty success. A real
//      $320 Payout Report from a third payer used to parse as ok:true with zero rows.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const DIR = process.env.REMIT_DIR || path.join(os.homedir(), 'Downloads');

let names = [];
try { names = fs.readdirSync(DIR); } catch { names = []; }
const amh = names.filter(n => /^ACHVendor.*\.pdf$/i.test(n));
const msr = names.filter(n => /(SSRS|Payment_Detail).*\.pdf$/i.test(n));

if (!amh.length && !msr.length) {
  console.log('SKIP remittance-parsers: no statements in ' + DIR + ' (set REMIT_DIR)');
  process.exit(2);
}

function run(script, file) {
  try {
    const out = execFileSync('python', [path.join(REPO, script), path.join(DIR, file)],
      { encoding: 'utf8', maxBuffer: 40 * 1024 * 1024, cwd: REPO });
    return JSON.parse(out);
  } catch (e) {
    // A refused document exits non-zero WITH json on stdout; that is a valid answer,
    // not a crash. Recover it so the refusal assertions can read it.
    const out = (e && e.stdout) ? String(e.stdout).trim() : '';
    if (out.startsWith('{')) { try { return JSON.parse(out); } catch { /* fall through */ } }
    return { ok: false, error: 'RUN FAILED: ' + String((e && e.message) || e).slice(0, 200) };
  }
}

let fail = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
};

console.log('remittance-parsers: ' + amh.length + ' AMH, ' + msr.length + ' MSR from ' + DIR);

// ---- 1 + 2: every statement reconciles, multi-statement files included -------------
const bad = [];
let totalRows = 0, multi = 0;

for (const f of amh) {
  const r = run('parse_amh_remittance.py', f);
  if (!r.ok) { bad.push(f + ': refused (' + String(r.error).slice(0, 60) + ')'); continue; }
  const rows = r.rows || [];
  totalRows += rows.length;
  if ((r.statementCount || 1) > 1) multi++;
  const sum = rows.reduce((a, x) => a + (x.amount || 0), 0);
  if (!rows.length) continue;                      // an empty-but-recognized statement is legal
  if (r.paymentTotal == null) { bad.push(f + ': rows but no paymentTotal'); continue; }
  if (Math.abs(sum - r.paymentTotal) >= 0.02) {
    bad.push(f + ': rows ' + sum.toFixed(2) + ' vs total ' + Number(r.paymentTotal).toFixed(2));
  }
}

for (const f of msr) {
  const r = run('parse_msr_remittance.py', f);
  if (!r.ok) { bad.push(f + ': refused (' + String(r.error).slice(0, 60) + ')'); continue; }
  const rows = r.rows || [];
  totalRows += rows.length;
  const sum = rows.reduce((a, x) => a + (x.amount || 0), 0);
  if (!rows.length) continue;
  if (r.statementTotal == null) { bad.push(f + ': rows but no statementTotal'); continue; }
  if (Math.abs(sum - r.statementTotal) >= 0.02) {
    bad.push(f + ': rows ' + sum.toFixed(2) + ' vs total ' + Number(r.statementTotal).toFixed(2));
  }
}

check('every statement reconciles: rows sum to the stated total', () => {
  if (bad.length) throw new Error(bad.length + ' file(s) disagree:\n       ' + bad.join('\n       '));
});

console.log('       (' + totalRows + ' rows across ' + (amh.length + msr.length) +
  ' statements; ' + multi + ' file(s) held more than one remittance)');

// ---- 3: an unrecognized document is refused, never an empty success ----------------
// Built here rather than shipped: a text-only PDF proves the marker gate without
// putting a real third-party statement in the repo.
// Must be a REAL pdf that is not an AMH or MSR remittance, or the assertion proves
// nothing: a .txt would be refused at PDF-open, never reaching the marker gate, and
// would pass for the wrong reason. Any pdf in DIR that neither filename pattern claims
// will do; the known case is a third payer's PO#-keyed Payout Report.
const foreign = names.filter(n => /\.pdf$/i.test(n) && !amh.includes(n) && !msr.includes(n));
if (!foreign.length) {
  console.log('  skip refusal check: no non-AMH/MSR pdf in ' + DIR + ' to test the marker gate');
} else {
  check('an unrecognized document is REFUSED, not reported as an empty success', () => {
    const f = foreign[0];
    for (const s of ['parse_amh_remittance.py', 'parse_msr_remittance.py']) {
      const r = run(s, f);
      if (r.ok && (r.rows || []).length === 0) {
        throw new Error(s + ' returned ok:true with zero rows for ' + f +
          ' -- silent success is the defect this guards');
      }
      if (r.ok) continue;   // it recognized it and found rows: fine, not a foreign doc
      if (!/unrecognized/i.test(String(r.error || ''))) {
        throw new Error(s + ' refused ' + f + ' for the wrong reason: ' + String(r.error).slice(0, 120));
      }
    }
  });
}

console.log(fail ? `\n${fail} failed` : '\nall passed');
process.exit(fail ? 1 : 0);
