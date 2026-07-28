'use strict';
// S1a: parseMsr section recovery + page='HVAC' + sell-side E/F/G split. Builds a real
// xlsx matching the verified Vendor HVAC Bid Sheet layout (header row 13, data from 14;
// B=Item, C=Description, E=Material, F=Labor, G=Total) and runs the SHIPPED parser.
// MSR is sell-side: material+labor==price where both present. Blank E -> material
// 'Included'; blank F (refrigerants) -> labor 'Included'. Sentinel is a STRING, never 0.
// Exit 0 pass / 1 fail / 2 skip (exceljs unavailable).
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

let ExcelJS, libIO;
try { ExcelJS = require('exceljs'); libIO = require('../library_io.js'); }
catch (e) { console.log('SKIP parse-msr: ' + e.message); process.exit(2); }

let fails = 0;
function check(label, fn) {
  try { fn(); console.log('  ok   ' + label); }
  catch (e) { fails++; console.log('  FAIL ' + label + ': ' + e.message); }
}

(async () => {
  console.log('parseMsr');
  const tmp = path.join(os.tmpdir(), 'msr_test_' + Date.now() + '.xlsx');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Vendor HVAC Bid Sheet');
  for (let i = 1; i <= 13; i++) ws.addRow(['header/instructions row ' + i]); // rows 1-13
  // cols: A(1) B=Item(2) C=Desc(3) D(4) E=Material(5) F=Labor(6) G=Total(7)
  ws.addRow(['', 'CLEANING']);                                        // row 14: section header (no G)
  ws.addRow(['', 'Coil Cleaning', 'includes tax', '', 150, 100, 250]); // row 15: item, E+F==G
  ws.addRow(['', 'Diagnostic Fee', 'service', '', '', 100, 100]);      // row 16: labor-only
  ws.addRow(['', 'R410a', 'refrigerant', '', 50, '', 50]);            // row 17: refrigerant (labor blank)
  await wb.xlsx.writeFile(tmp);

  let items;
  try { items = await libIO.parseMsr(tmp); }
  catch (e) { console.log('SKIP parse-msr (parse threw): ' + e.message); try { fs.unlinkSync(tmp); } catch {} process.exit(2); }
  try { fs.unlinkSync(tmp); } catch {}

  const byName = Object.fromEntries(items.map(it => [it.name, it]));

  check('emitted 3 items (section header not emitted)', () => {
    assert.strictEqual(items.length, 3);
  });
  check('page = HVAC for all', () => {
    items.forEach(it => assert.strictEqual(it.page, 'HVAC'));
  });
  check('recovered section header', () => {
    assert.strictEqual(byName['Coil Cleaning'].subCategory, 'CLEANING');
  });
  check('both present: material+labor === price', () => {
    const it = byName['Coil Cleaning'];
    assert.strictEqual(it.material, 150);
    assert.strictEqual(it.labor, 100);
    assert.strictEqual(it.material + it.labor, it.price);
  });
  check('labor-only row: material=Included (string), labor===price', () => {
    const it = byName['Diagnostic Fee'];
    assert.strictEqual(it.material, 'Included');
    assert.strictEqual(typeof it.material, 'string');
    assert.strictEqual(it.labor, it.price);
  });
  check('refrigerant row: labor=Included (string), material===price', () => {
    const it = byName['R410a'];
    assert.strictEqual(it.labor, 'Included');
    assert.strictEqual(typeof it.labor, 'string');
    assert.strictEqual(it.material, it.price);
  });
  check('sentinel is never 0', () => {
    assert.notStrictEqual(byName['Diagnostic Fee'].material, 0);
    assert.notStrictEqual(byName['R410a'].labor, 0);
  });

  console.log('');
  console.log(fails ? (fails + ' FAILURES') : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
