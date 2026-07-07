'use strict';
// resolveBidLine: fallback-chain matcher (client lib -> General -> sentinel). PRICE
// is a CONFIRMER, not a gate -- the invoice price is ALWAYS the bid price; price only
// decides confidence. Confirmed keyword+price -> library name. Strong keyword but price
// off -> sentinel + suspects + a flag (red for AMH/MSR contract, yellow for General).
//
// Slice-1b scoring is IDF-weighted (rare tokens count, generic/boilerplate ~0) with a
// distinctive-token COVERAGE gate. IDF is corpus-relative, so the fixtures must be
// realistically SIZED -- a 2-item catalog makes every shared token appear in every
// item (idf 0) and nothing matches. We seed a handful of real items + inert filler so
// a single distinctive token (contactor/capacitor) clears the absolute floor exactly
// as it does against the 250-item live AMH library. SHIPPED code via the esbuild
// bridge. Exit 0 pass / 1 fail.
const assert = require('assert');
const { loadEsm } = require('./_load.js');
const { resolveBidLine, bidItemsToInvoiceLines, invoiceHasServiceCall } = loadEsm('src/orders-logic.js');

// Inert filler: unique throwaway tokens, never shared with any test wording, purely to
// grow N so IDF(distinctive single token) reaches the live-catalog range.
const filler = (n) => Array.from({ length: n }, (_, i) => (
  { name: `Zzq${i} Wodget${i}`, desc: '', price: 1000 + i, taxable: false }));

// Tonnage variants share heat/pump/ton; price is the only separator (per the money rule).
const AMH = [
  { name: 'Heat Pump - 3 Ton', desc: 'HVAC', price: 5321.76, taxable: false },
  { name: 'Heat Pump Condenser - 3 Ton', desc: 'HVAC', price: 2272.30, taxable: false },
  { name: 'Capacitor Replacement', desc: 'HVAC', price: 12.58, taxable: false },
  { name: 'Contactor Replacement', desc: 'HVAC', price: 125, taxable: false },
  { name: 'Toilet Flapper Replacement', desc: 'Plum Minor', price: 20, taxable: false },
  { name: 'Clean Condenser Coil', desc: 'HVAC', price: 55, taxable: false },
  { name: 'Blower Motor Replacement', desc: 'HVAC', price: 300, taxable: false },
  ...filler(24),
];
const GENERAL = [
  { name: 'Capacitor Replacement', desc: '', price: 12.58, taxable: false },
  { name: 'Kitchen Faucet Replacement', desc: '', price: 215, taxable: true },
  { name: 'Toilet Fill Valve Replacement', desc: '', price: 35, taxable: true },
  { name: 'Water Heater Replacement', desc: '', price: 950, taxable: true },
  { name: 'Shower Cartridge Replacement', desc: '', price: 95, taxable: true },
  ...filler(24),
];

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e.message }); }
}

test('confirmed: price matches -> library name, bid price, no flag', () => {
  const l = resolveBidLine('install 3 ton heat pump system', 5321.76, AMH, GENERAL, 'AMH');
  assert.strictEqual(l.name, 'Heat Pump - 3 Ton');
  assert.strictEqual(l.unitPrice, 5321.76);
  assert.strictEqual(l.priceFlag, undefined);
});

test('price disambiguates keyword-equal variants (condenser)', () => {
  const l = resolveBidLine('install 3 ton heat pump', 2272.30, AMH, GENERAL, 'AMH');
  assert.strictEqual(l.name, 'Heat Pump Condenser - 3 Ton');
});

test('AMH client keyword hit but price OFF -> RED flag + suspect, bid price kept', () => {
  const l = resolveBidLine('3 ton heat pump full system', 5400, AMH, GENERAL, 'AMH');
  assert.strictEqual(l.priceFlag, 'red');
  assert.strictEqual(l.unitPrice, 5400);                 // bid price, NOT library
  assert.ok(/Labor!|Materials!/.test(l.name));           // sentinel name until confirmed
  assert.strictEqual(l.suspects[0].name, 'Heat Pump - 3 Ton');
  assert.strictEqual(l.suspects[0].price, 5321.76);
});

test('single distinctive token confirms on price (contactor)', () => {
  const l = resolveBidLine('Replace bad contactor', 125, AMH, GENERAL, 'AMH');
  assert.strictEqual(l.name, 'Contactor Replacement');
  assert.strictEqual(l.priceFlag, undefined);
});

test('General WO: keyword hit but price OFF -> YELLOW flag (drift expected)', () => {
  const l = resolveBidLine('Material - Capacitor', 15, GENERAL, null, 'General');
  assert.strictEqual(l.priceFlag, 'yellow');
  assert.strictEqual(l.unitPrice, 15);
  assert.strictEqual(l.suspects[0].name, 'Capacitor Replacement');
});

test('client miss -> falls back to General; confirmed there', () => {
  const l = resolveBidLine('replace kitchen faucet', 215, AMH, GENERAL, 'AMH');
  assert.strictEqual(l.name, 'Kitchen Faucet Replacement');
  assert.strictEqual(l.priceFlag, undefined);
});

test('General fallback keyword hit price off -> yellow even on an AMH WO', () => {
  const l = resolveBidLine('replace kitchen faucet', 240, AMH, GENERAL, 'AMH');
  assert.strictEqual(l.priceFlag, 'yellow');
  assert.strictEqual(l.suspects[0].name, 'Kitchen Faucet Replacement');
});

test('generic/boilerplate tokens alone do NOT match (no false suspect)', () => {
  // "Labor" + "replace" are boilerplate; "fee"/"diagnostic" carry no catalog identity
  // here -> plain sentinel, no flag. (Live: killed the 43% false-red "Diagnostic fee".)
  const l = resolveBidLine('Diagnostic fee', 75, AMH, GENERAL, 'AMH');
  assert.strictEqual(l.priceFlag, undefined);
  assert.strictEqual(l.suspects, undefined);
});

test('bare-number token does not manufacture a match', () => {
  // "9 lbs" must not latch onto the "3 Ton" rows via a digit; no HVAC nouns shared.
  const l = resolveBidLine('9 lbs R410A refrigerant', 315, AMH, GENERAL, 'AMH');
  assert.strictEqual(l.priceFlag, undefined);
  assert.strictEqual(l.name, 'Materials!');              // no action verb -> material
});

test('weak keyword -> plain sentinel, no flag, no suspects', () => {
  const l = resolveBidLine('Labor to correct drainage setup', 90, AMH, GENERAL, 'AMH');
  assert.strictEqual(l.priceFlag, undefined);
  assert.strictEqual(l.suspects, undefined);
  assert.strictEqual(l.name, 'Labor!');                  // has verb "correct"
});

test('sentinel labels by action verb; verbless/Material- = material', () => {
  assert.strictEqual(resolveBidLine('Replaced flush handle', 20, [], [], 'AMH').name, 'Labor!');
  assert.strictEqual(resolveBidLine('9 lbs R410A', 315, [], [], 'AMH').name, 'Materials!');
  assert.strictEqual(resolveBidLine('Material - new TXV valve', 250, [], [], 'AMH').name, 'Materials!');
});

test('bidItemsToInvoiceLines wires the chain + qty; general as 4th arg', () => {
  const lines = bidItemsToInvoiceLines(
    [{ name: 'install 3 ton heat pump system', qty: 2, price: 5321.76 }], AMH, 'AMH', GENERAL);
  assert.strictEqual(lines[0].name, 'Heat Pump - 3 Ton');
  assert.strictEqual(lines[0].qty, 2);
  assert.strictEqual(lines[0].unitPrice, 5321.76);
});

test('invoiceHasServiceCall detects diagnostic/service-call lines', () => {
  assert.strictEqual(invoiceHasServiceCall([{ name: 'Labor!', desc: 'HVAC Diagnostic fee' }]), true);
  assert.strictEqual(invoiceHasServiceCall([{ name: 'Diagnostic Fee', desc: '' }]), true);
  assert.strictEqual(invoiceHasServiceCall([{ name: 'Materials!', desc: '9 lbs R410A' }]), false);
  assert.strictEqual(invoiceHasServiceCall([]), false);
});

console.log('catalog-match test');
console.log('==================');
let pass = 0, fail = 0;
for (const r of results) {
  if (r.ok) { pass++; console.log('  OK  ' + r.name); }
  else { fail++; console.log('  XX  ' + r.name + '\n      ' + r.err); }
}
console.log('\nTotal: ' + (pass + fail) + ' | Pass: ' + pass + ' | Fail: ' + fail);
process.exit(fail ? 1 : 0);
