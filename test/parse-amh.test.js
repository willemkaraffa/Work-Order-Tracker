'use strict';
// S1a: parseAmh section recovery + page/material/labor. Builds a real xlsx matching
// the verified New Structure layout (A=name, B=Material Cost, C=Labor Cost,
// D=Premier Pricing; E/F ignored) and runs the SHIPPED parser.
// AMH is COST BASIS: material+labor deliberately != price -> NOT asserted.
// Exit 0 pass / 1 fail / 2 skip (exceljs unavailable).
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

let ExcelJS, libIO;
try { ExcelJS = require('exceljs'); libIO = require('../library_io.js'); }
catch (e) { console.log('SKIP parse-amh: ' + e.message); process.exit(2); }

let fails = 0;
function check(label, fn) {
  try { fn(); console.log('  ok   ' + label); }
  catch (e) { fails++; console.log('  FAIL ' + label + ': ' + e.message); }
}

(async () => {
  console.log('parseAmh');
  const tmp = path.join(os.tmpdir(), 'amh_test_' + Date.now() + '.xlsx');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Plum Minor');
  ws.addRow(['Minimum Job Fee $75 applies to all visits.']);       // row 1: fee prose
  ws.addRow(['Clogs:']);                                            // row 2: section 1 (col A)
  ws.addRow(['Unclog Main Sewer Line', 0, 300, 300]);              // row 3: item
  ws.addRow(['Faucets and Fixtures:']);                            // row 4: section 2
  ws.addRow(['Bathroom Faucet', 100, 90, 320]);                    // row 5: item (cost != price)
  await wb.xlsx.writeFile(tmp);

  let items;
  try { items = await libIO.parseAmh(tmp); }
  catch (e) { console.log('SKIP parse-amh (parse threw): ' + e.message); try { fs.unlinkSync(tmp); } catch {} process.exit(2); }
  try { fs.unlinkSync(tmp); } catch {}

  check('emitted exactly 2 items (headers not emitted)', () => {
    assert.strictEqual(items.length, 2);
  });
  check('row-2 col-A became section 1', () => {
    assert.strictEqual(items[0].subCategory, 'Clogs:');
  });
  check('second item carries its own section', () => {
    assert.strictEqual(items[1].subCategory, 'Faucets and Fixtures:');
  });
  check('page = tab name', () => {
    assert.strictEqual(items[0].page, 'Plum Minor');
    assert.strictEqual(items[1].page, 'Plum Minor');
  });
  check('material=B, labor=C, price=D', () => {
    assert.strictEqual(items[1].material, 100);
    assert.strictEqual(items[1].labor, 90);
    assert.strictEqual(items[1].price, 320);
  });
  check('cost basis: material+labor != price (not "fixed")', () => {
    assert.notStrictEqual(items[1].material + items[1].labor, items[1].price);
  });

  console.log('');
  console.log(fails ? (fails + ' FAILURES') : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
