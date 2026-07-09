'use strict';
// Slice 5: recomputeInvoice re-derives a saved invoice against the CURRENT library.
// Auto-applies safe upgrades (sentinel line -> library canonical name; taxable
// correction), flags price-off suspects (no money rewrite), skips edited:true lines.
// Pure, fixture-free. Exit 0 pass / 1 fail.
const assert = require('assert');
const { loadEsm } = require('./_load.js');
const { recomputeInvoice, computeInvoiceTotals } = loadEsm('src/orders-logic.js');

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e.message }); }
}

// AMH catalog sized so IDF ranks distinctive tokens (contactor/reversing/valve)
// as identity-bearing -- a tiny catalog collapses every idf to ~0 and nothing
// confirms. Mirrors the real ~100-item library at unit scale.
const AMH_LIB = [
  { name: 'Replace contactor', price: 300, taxable: false },
  { name: 'Replace capacitor', price: 45, taxable: false },
  { name: 'Replace blower motor', price: 250, taxable: false },
  { name: 'Replace condenser fan motor', price: 240, taxable: false },
  { name: 'Replace TXV', price: 400, taxable: false },
  { name: 'Replace evaporator coil', price: 900, taxable: false },
  { name: 'Replace condensate pump', price: 180, taxable: false },
  { name: 'Install thermostat', price: 150, taxable: false },
  { name: 'Clean condenser coil', price: 120, taxable: false },
  { name: 'Replace transformer', price: 90, taxable: false },
  { name: 'Replace defrost board', price: 210, taxable: false },
  { name: 'Replace reversing valve', price: 500, taxable: false },
  { name: 'Replace igniter', price: 80, taxable: false },
  { name: 'Replace flame sensor', price: 70, taxable: false },
  { name: 'Replace draft inducer', price: 350, taxable: false },
];

test('sentinel line upgrades to library canonical name (safe auto-apply)', () => {
  const saved = { lineItems: [
    { name: 'AMH!', desc: 'Replace contactor', qty: 1, unitPrice: 300, taxable: false, agreement: 'AMH', category: 'labor' },
  ] };
  const { lines, changes } = recomputeInvoice(saved, AMH_LIB, null, 'AMH');
  assert.strictEqual(lines[0].name, 'Replace contactor');
  assert.ok(changes.some(c => c.field === 'name' && c.to === 'Replace contactor'));
});

test('taxable corrected on a service-call line (core truth #3)', () => {
  const saved = { lineItems: [
    { name: 'HVAC - Service Call', desc: 'HVAC - Service Call', qty: 1, unitPrice: 90, taxable: false, agreement: 'AMH', category: 'labor' },
  ] };
  const { lines, changes } = recomputeInvoice(saved, AMH_LIB, null, 'AMH');
  assert.strictEqual(lines[0].taxable, true);            // re-derived taxable
  assert.strictEqual(lines[0].name, 'HVAC - Service Call'); // sentinel name NOT clobbered
  assert.ok(changes.some(c => c.field === 'taxable' && c.to === true));
});

test('edited:true line is left untouched', () => {
  const saved = { lineItems: [
    { name: 'AMH!', desc: 'Replace contactor', qty: 1, unitPrice: 300, taxable: false, agreement: 'AMH', category: 'labor', edited: true },
  ] };
  const { lines, changes } = recomputeInvoice(saved, AMH_LIB, null, 'AMH');
  assert.strictEqual(lines[0].name, 'AMH!');
  assert.strictEqual(changes.length, 0);
});

test('price-off suspect is flagged, money not rewritten', () => {
  // Two distinctive shared tokens (reversing, valve) -> strong suspect even with the
  // price off; a single common token would be too weak to flag.
  const saved = { lineItems: [
    { name: 'AMH!', desc: 'Replace reversing valve', qty: 1, unitPrice: 999, taxable: false, agreement: 'AMH', category: 'labor' },
  ] };
  const { lines, changes } = recomputeInvoice(saved, AMH_LIB, null, 'AMH');
  assert.strictEqual(lines[0].unitPrice, 999);          // price untouched
  assert.strictEqual(lines[0].priceFlag, 'red');
  assert.ok(changes.some(c => c.field === 'priceFlag'));
});

test('totalFlag set when authoritative total mismatches', () => {
  const saved = { lineItems: [
    { name: 'Replace contactor', desc: 'Replace contactor', qty: 1, unitPrice: 300, taxable: false, agreement: 'AMH', category: 'labor' },
  ] };
  const { totalFlag } = recomputeInvoice(saved, AMH_LIB, null, 'AMH', 351.03);
  assert.ok(Math.abs(totalFlag - (300 - 351.03)) < 0.005);
});

test('legacy MSR! labor sentinel normalizes to Labor! (name migration)', () => {
  const saved = { lineItems: [
    { name: 'MSR!', desc: 'Labor to replace blower motor', qty: 1, unitPrice: 175, taxable: true, category: 'labor', agreement: 'MSR' },
  ] };
  const { lines, changes } = recomputeInvoice(saved, [], null, 'MSR');
  assert.strictEqual(lines[0].name, 'Labor!');
  assert.strictEqual(lines[0].taxable, true);          // MSR labor stays taxable (unchanged)
  assert.ok(changes.some(c => c.field === 'name' && c.to === 'Labor!'));
});

test('legacy material saved as labor is corrected to material category (R410A)', () => {
  const saved = { lineItems: [
    { name: 'Materials!', desc: 'Material - 0.5lbs R410A', qty: 1, unitPrice: 27.5, taxable: false, category: 'labor', agreement: 'MSR' },
  ] };
  const { lines, changes } = recomputeInvoice(saved, [], null, 'MSR');
  assert.strictEqual(lines[0].category, 'material');   // fixed from the mis-saved 'labor'
  assert.strictEqual(lines[0].taxable, false);         // material stays non-taxable
  assert.ok(changes.some(c => c.field === 'category' && c.to === 'material'));
});

test('price-flagged legacy material STILL gets its category fixed (R410A/float-switch class)', () => {
  // A material catalog item at a different price -> the line flags as a price suspect.
  // Regression: recompute used to return early on the flag and skip the category fix,
  // leaving a material mis-saved as 'labor'. Now the flag is surfaced AND the label fixed.
  const cat = [{ name: 'SS2 Float Switch', price: 60, taxable: false },
    ...Array.from({ length: 14 }, (_, i) => ({ name: 'zzq' + i + ' widget', price: i + 1, taxable: false }))];
  const saved = { lineItems: [
    { name: 'Materials!', desc: 'Material - SS2 float switch', qty: 1, unitPrice: 45, taxable: false, category: 'labor', agreement: 'MSR' },
  ] };
  const { lines } = recomputeInvoice(saved, cat, null, 'MSR');
  assert.strictEqual(lines[0].category, 'material');   // fixed despite the price flag
  assert.strictEqual(lines[0].priceFlag, 'red');       // flag still surfaced (MSR contract)
  assert.strictEqual(lines[0].unitPrice, 45);          // money untouched
});

test('confirmed real name is NOT clobbered by a sentinel when library item is gone', () => {
  // Empty catalog -> no confirm; a saved confirmed name must survive (not -> Labor!).
  const saved = { lineItems: [
    { name: 'Clean Evaporator Coil In Place', desc: 'Labor to clean coil', qty: 1, unitPrice: 145, taxable: true, category: 'labor', agreement: 'MSR' },
  ] };
  const { lines } = recomputeInvoice(saved, [], null, 'MSR');
  assert.strictEqual(lines[0].name, 'Clean Evaporator Coil In Place');
});

test('no changes when invoice already canonical', () => {
  const saved = { lineItems: [
    { name: 'Replace contactor', desc: 'Replace contactor', qty: 1, unitPrice: 300, taxable: false, agreement: 'AMH', category: 'labor' },
  ] };
  const { changes, totalDelta } = recomputeInvoice(saved, AMH_LIB, null, 'AMH');
  assert.strictEqual(changes.length, 0);
  assert.strictEqual(totalDelta, 0);
});

console.log('recompute-invoice test');
console.log('======================');
let pass = 0, fail = 0;
for (const r of results) {
  if (r.ok) { pass++; console.log('  OK  ' + r.name); }
  else { fail++; console.log('  XX  ' + r.name + '\n      ' + r.err); }
}
console.log('\nTotal: ' + (pass + fail) + ' | Pass: ' + pass + ' | Fail: ' + fail);
process.exit(fail ? 1 : 0);
