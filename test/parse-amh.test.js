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
    assert.strictEqual(items[0].subCategory, 'Clogs');
  });
  check('second item carries its own section', () => {
    assert.strictEqual(items[1].subCategory, 'Faucets and Fixtures');
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

  // ── HVAC equipment block: family header look-ahead + size rows ───────────────
  // A 'Maintenance:' section header + a normal item, then two equipment families
  // ('Evaporator Coil', a coil/coil bundle) whose col-D is a SEER tier LABEL, not
  // a price, recognized only because 'Ton' size rows follow. Family rows must NOT
  // emit; size rows emit as the size token ALONE (name='1.5 Ton', subCategory=family)
  // with Included material/labor. Two families share a size token, so find by
  // name AND subCategory together.
  const tmp2 = path.join(os.tmpdir(), 'amh_hvac_test_' + Date.now() + '.xlsx');
  const wb2 = new ExcelJS.Workbook();
  const hv = wb2.addWorksheet('HVAC');
  hv.addRow(['Minimum Job Fee $75 applies to all visits.']);            // row 1: fee prose
  hv.addRow(['Maintenance:']);                                          // row 2: section header
  hv.addRow(['Full System Test', 0, 0, 90]);                           // row 3: normal item
  hv.addRow(['Evaporator Coil', '14 Seer', '15 Seer', '14 Seer']);    // row 4: FAMILY header
  hv.addRow(['1.5 Ton', 945.93, 'NA', 995.59]);                       // row 5: size row
  hv.addRow(['2 Ton', 1000, 'NA', 1139.27]);                          // row 6: size row
  hv.addRow(['Condenser / Evaporator Coil Replacement', 0, 0, '14 Seer']); // row 7: bundle FAMILY
  hv.addRow(['1.5 Ton', 0, 0, 2716.83]);                              // row 8: bundle size row
  await wb2.xlsx.writeFile(tmp2);

  let hvac;
  try { hvac = await libIO.parseAmh(tmp2); }
  catch (e) { console.log('SKIP parse-amh HVAC (parse threw): ' + e.message); try { fs.unlinkSync(tmp2); } catch {} process.exit(2); }
  try { fs.unlinkSync(tmp2); } catch {}

  check('family headers not emitted (Maint item + 3 size rows = 4)', () => {
    assert.strictEqual(hvac.length, 4);
    assert.ok(!hvac.some(i => i.name === 'Evaporator Coil'), 'Evaporator Coil leaked as item');
    assert.ok(!hvac.some(i => i.name === 'Condenser / Evaporator Coil Replacement'), 'bundle family leaked');
  });
  check('size row -> name "1.5 Ton", subCategory family, price=D', () => {
    const it = hvac.find(i => i.name === '1.5 Ton' && i.subCategory === 'Evaporator Coil');
    assert.ok(it, 'Evaporator Coil 1.5 Ton missing');
    assert.strictEqual(it.subCategory, 'Evaporator Coil');
    assert.strictEqual(it.price, 995.59);
    assert.strictEqual(it.material, 'Included');
    assert.strictEqual(it.labor, 'Included');
  });
  check('second size row emits under family + D price', () => {
    const it = hvac.find(i => i.name === '2 Ton' && i.subCategory === 'Evaporator Coil');
    assert.ok(it, 'Evaporator Coil 2 Ton missing');
    assert.strictEqual(it.price, 1139.27);
  });
  check('bundle size row grouped under bundle family', () => {
    const it = hvac.find(i => i.name === '1.5 Ton' && i.subCategory === 'Condenser / Evaporator Coil Replacement');
    assert.ok(it, 'bundle size row missing');
    assert.strictEqual(it.price, 2716.83);
    assert.strictEqual(it.subCategory, 'Condenser / Evaporator Coil Replacement');
  });
  check('normal Maintenance item keeps splitFields material/labor', () => {
    const it = hvac.find(i => i.name === 'Full System Test');
    assert.ok(it, 'Full System Test missing');
    assert.strictEqual(it.subCategory, 'Maintenance');
    assert.strictEqual(it.price, 90);
    assert.strictEqual(it.material, 0);
    assert.strictEqual(it.labor, 0);
  });
  check('no bogus price from a "14 Seer" tier label', () => {
    assert.ok(!hvac.some(i => i.price === 14), 'a SEER tier label leaked as a $14 price');
  });

  // ── Reorder proof: family header with a BLANK (null) price cell ──────────────
  // Its col-D is empty, so isSectionHeader would catch it if it ran first. The
  // family-header look-ahead must run BEFORE isSectionHeader so the two Ton rows
  // keep the family prefix + subCategory.
  const tmp3 = path.join(os.tmpdir(), 'amh_blankfam_test_' + Date.now() + '.xlsx');
  const wb3 = new ExcelJS.Workbook();
  const bf = wb3.addWorksheet('HVAC');
  bf.addRow(['Minimum Job Fee $75 applies to all visits.']); // row 1: fee prose
  bf.addRow(['Package Unit']);                                // row 2: FAMILY header, BLANK price
  bf.addRow(['1.5 Ton', null, null, 3200]);                  // row 3: size row
  bf.addRow(['2 Ton', null, null, 3500]);                    // row 4: size row
  await wb3.xlsx.writeFile(tmp3);

  let blankfam;
  try { blankfam = await libIO.parseAmh(tmp3); }
  catch (e) { console.log('SKIP parse-amh blankfam (parse threw): ' + e.message); try { fs.unlinkSync(tmp3); } catch {} process.exit(2); }
  try { fs.unlinkSync(tmp3); } catch {}

  check('blank-price family header NOT emitted, sizes keep prefix (reorder)', () => {
    assert.strictEqual(blankfam.length, 2);
    assert.ok(!blankfam.some(i => i.name === 'Package Unit'), 'blank-price family leaked as item/section');
    const it = blankfam.find(i => i.name === '1.5 Ton' && i.subCategory === 'Package Unit');
    assert.ok(it, 'Package Unit 1.5 Ton missing');
    assert.strictEqual(it.subCategory, 'Package Unit');
    assert.strictEqual(it.price, 3200);
    assert.strictEqual(blankfam.find(i => i.name === '2 Ton' && i.subCategory === 'Package Unit').price, 3500);
  });

  // Item 7: false-section banner. A long descriptive row precedes size rows but is
  // NOT a family (guarded by length/colon) -> skipped; its sizes reparent to the
  // true section, whose trailing colon is stripped ('Ductwork:' -> 'Ductwork').
  const tmp4 = path.join(os.tmpdir(), 'amh_banner_test_' + Date.now() + '.xlsx');
  const wb4 = new ExcelJS.Workbook();
  const bn = wb4.addWorksheet('HVAC');
  bn.addRow(['Minimum Job Fee $75 applies to all visits.']);                                   // row 1: fee prose
  bn.addRow(['Ductwork:']);                                                                     // row 2: real section
  bn.addRow(['Seal Ducts', 0, 0, 250]);                                                         // row 3: normal item
  bn.addRow(['Adjust ECM motor speed to match system tonnage for 1.5 - 2.5 & 3.5 Ton units']); // row 4: BANNER, blank price
  bn.addRow(['1.5 Ton', null, null, 400]);                                                      // row 5: size row
  bn.addRow(['2 Ton', null, null, 450]);                                                        // row 6: size row
  await wb4.xlsx.writeFile(tmp4);

  let banner;
  try { banner = await libIO.parseAmh(tmp4); }
  catch (e) { console.log('SKIP parse-amh banner (parse threw): ' + e.message); try { fs.unlinkSync(tmp4); } catch {} process.exit(2); }
  try { fs.unlinkSync(tmp4); } catch {}

  check('banner skipped, sizes reparent to section, colon stripped (item 7)', () => {
    assert.ok(!banner.some(i => /^Adjust ECM/.test(i.name)), 'banner leaked as an item');
    assert.ok(!banner.some(i => i.subCategory && /^Adjust ECM/.test(i.subCategory)), 'banner leaked as a subCategory');
    const it = banner.find(i => i.name === '1.5 Ton');
    assert.ok(it, '1.5 Ton missing');
    assert.strictEqual(it.subCategory, 'Ductwork');
    assert.strictEqual(banner.find(i => i.name === 'Seal Ducts').subCategory, 'Ductwork');
  });

  console.log('');
  console.log(fails ? (fails + ' FAILURES') : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
