'use strict';
// S1a: isSectionHeader heuristic from library_io.js (CJS, require-able directly).
//   node test/library-io-sections.test.js  (exit 0 pass / 1 fail)
const assert = require('assert');
const { isSectionHeader } = require('../library_io.js');

let fails = 0;
function check(label, fn) {
  try { fn(); console.log('  ok   ' + label); }
  catch (e) { fails++; console.log('  FAIL ' + label + ': ' + e.message); }
}

console.log('library_io isSectionHeader');

check('no-price short name = header', () => {
  assert.ok(isSectionHeader('Water Heaters', null));
  assert.ok(isSectionHeader('Clogs:', null));
});
check('priced row = NOT header (item)', () => {
  assert.ok(!isSectionHeader('40 Gallon Water Heater', 1503.82));
  assert.ok(!isSectionHeader('Coil Cleaning', 0)); // 0 is a real price, not absent
});
check('no-price TOTAL/summary row rejected', () => {
  assert.ok(!isSectionHeader('SUBTOTAL', null));
  assert.ok(!isSectionHeader('Job Total', null));
});
check('no-price long prose (>48 chars) rejected', () => {
  const prose = 'INCURRED COSTS are billed at cost plus applicable markup per the agreement';
  assert.ok(prose.length > 48);
  assert.ok(!isSectionHeader(prose, null));
});
check('empty / blank name rejected', () => {
  assert.ok(!isSectionHeader('', null));
  assert.ok(!isSectionHeader(null, null));
});

console.log('');
console.log(fails ? (fails + ' FAILURES') : 'ALL PASS');
process.exit(fails ? 1 : 0);
