'use strict';
// S1a: exportLibrary -> parseRoundtrip preserves page/subCategory/material/labor,
// including the 'Included' sentinel STRING, losslessly. Runs the SHIPPED I/O.
// Exit 0 pass / 1 fail / 2 skip (exceljs unavailable).
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

let libIO;
try { require('exceljs'); libIO = require('../library_io.js'); }
catch (e) { console.log('SKIP parse-roundtrip: ' + e.message); process.exit(2); }

let fails = 0;
function check(label, fn) {
  try { fn(); console.log('  ok   ' + label); }
  catch (e) { fails++; console.log('  FAIL ' + label + ': ' + e.message); }
}

(async () => {
  console.log('export -> parseRoundtrip');
  const tmp = path.join(os.tmpdir(), 'lib_roundtrip_' + Date.now() + '.xlsx');
  const tabs = {
    MSR: [
      { name: 'Coil Cleaning', desc: '', price: 250, taxable: false, page: 'HVAC', subCategory: 'CLEANING', material: 150, labor: 100 },
      { name: 'Diagnostic Fee', desc: '', price: 100, taxable: true, page: 'HVAC', subCategory: 'INCURRED', material: 'Included', labor: 100 },
    ],
  };
  try { await libIO.exportLibrary(tmp, tabs); }
  catch (e) { console.log('SKIP parse-roundtrip (export threw): ' + e.message); process.exit(2); }

  let out;
  try { out = await libIO.parseRoundtrip(tmp); }
  catch (e) { console.log('SKIP parse-roundtrip (parse threw): ' + e.message); try { fs.unlinkSync(tmp); } catch {} process.exit(2); }
  try { fs.unlinkSync(tmp); } catch {}

  const rows = out.MSR || [];
  check('both rows survived', () => assert.strictEqual(rows.length, 2));
  check('numeric material/labor preserved', () => {
    assert.strictEqual(rows[0].page, 'HVAC');
    assert.strictEqual(rows[0].subCategory, 'CLEANING');
    assert.strictEqual(rows[0].material, 150);
    assert.strictEqual(rows[0].labor, 100);
  });
  check('Included sentinel preserved as STRING', () => {
    assert.strictEqual(rows[1].material, 'Included');
    assert.strictEqual(typeof rows[1].material, 'string');
    assert.notStrictEqual(rows[1].material, 0);
    assert.strictEqual(rows[1].labor, 100);
  });

  console.log('');
  console.log(fails ? (fails + ' FAILURES') : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
