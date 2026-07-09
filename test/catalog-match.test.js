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
const { resolveBidLine, bidItemsToInvoiceLines, invoiceHasServiceCall, categoryLabel, isPmListed } = loadEsm('src/orders-logic.js');

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
  // Sized to the live General catalog range so a lone rare token (capacitor) clears
  // MATCH_SOLO_IDF (4.0) exactly as it does against the real ~150-item library.
  ...filler(150),
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

test('KIND gate: material-wording bid does NOT match a labor/cleaning catalog item', () => {
  // "Material - drain line" is a physical thing; must not flag as the "Clean Drain..."
  // labor service (name leads with an action verb). Regression: live MSR invoice.
  const CLEAN = [{ name: 'Clean Drain Pan and Drain Line', desc: '', price: 145, taxable: true }, ...filler(150)];
  const l = resolveBidLine('Material - 1ft of drain line', 10, CLEAN, null, 'MSR');
  assert.strictEqual(l.priceFlag, undefined);
  assert.strictEqual(l.suspects, undefined);
  assert.strictEqual(l.name, 'Materials!');
});

test('lone COMMON shared token does not flag (air -> Air Handler noise)', () => {
  const HANDLERS = ['1.5', '2', '3', '4', '5'].map(t => (
    { name: t + ' Ton Air Handler', desc: '', price: 2000, taxable: true })).concat(filler(150));
  const l = resolveBidLine('Install new return air register', 300, HANDLERS, null, 'MSR');
  assert.strictEqual(l.priceFlag, undefined);   // shares only the common word "air"
  assert.strictEqual(l.suspects, undefined);
});

test('"drain" is a noun, not a verb: bare drain line/pan -> Materials!', () => {
  assert.strictEqual(resolveBidLine('1ft of drain line', 10, [], [], 'MSR').name, 'Materials!');
  assert.strictEqual(resolveBidLine('secondary drain pan', 40, [], [], 'AMH').name, 'Materials!');
  assert.strictEqual(resolveBidLine('clear the drain line', 90, [], [], 'AMH').name, 'Labor!'); // real verb -> unlisted labor sentinel
});

test('MSR sentinel labor -> Labor! and TAXABLE (custom service; divide-out, total-invariant)', () => {
  const l = resolveBidLine('Install half inch black pipe', 150, [], [], 'MSR');
  assert.strictEqual(l.name, 'Labor!');   // unlisted -> Labor!; MSR carried on agreement
  assert.strictEqual(l.agreement, 'MSR');
  assert.strictEqual(l.taxable, true);
});

test('AMH sentinel labor -> Labor! and NEVER taxed (Premier inclusive, core truth #2)', () => {
  const l = resolveBidLine('Install half inch black pipe', 150, [], [], 'AMH');
  assert.strictEqual(l.name, 'Labor!');   // unlisted -> Labor!; tax still non-taxable via AMH agreement
  assert.strictEqual(l.agreement, 'AMH');
  assert.strictEqual(l.taxable, false);
});

test('service call / diagnostic / emergency ALWAYS taxed on either PM (core truth #3)', () => {
  const sc = resolveBidLine('HVAC - Service Call', 90, [], [], 'AMH');
  assert.strictEqual(sc.name, 'Labor!');
  assert.strictEqual(sc.category, 'labor');
  assert.strictEqual(sc.taxable, true);
  assert.strictEqual(resolveBidLine('Emergency after-hours trip', 120, [], [], 'MSR').taxable, true);
  assert.strictEqual(resolveBidLine('Diagnostic Fee', 75, [], [], 'MSR').taxable, true);
});

test('weak keyword -> plain sentinel, no flag, no suspects', () => {
  const l = resolveBidLine('Labor to correct drainage setup', 90, AMH, GENERAL, 'AMH');
  assert.strictEqual(l.priceFlag, undefined);
  assert.strictEqual(l.suspects, undefined);
  assert.strictEqual(l.name, 'Labor!');                  // has verb "correct" -> unlisted labor sentinel
});

test('categoryLabel: confirmed PM item reads its client; unlisted/General reads labor/material', () => {
  // A confirmed AMH library item -> category label 'AMH' (derived from agreement, locked).
  const amhItem = { name: 'Replace contactor', agreement: 'AMH', category: 'labor' };
  assert.strictEqual(isPmListed(amhItem), true);
  assert.strictEqual(categoryLabel(amhItem), 'AMH');
  // Unlisted AMH line (Labor! sentinel) is NOT PM-listed -> labor/material.
  const unlisted = { name: 'Labor!', agreement: 'AMH', category: 'labor' };
  assert.strictEqual(isPmListed(unlisted), false);
  assert.strictEqual(categoryLabel(unlisted), 'labor');
  // Retired AMH! sentinel name still reads as unlisted (backward-compat).
  assert.strictEqual(isPmListed({ name: 'AMH!', agreement: 'AMH' }), false);
  // General confirmed item -> labor/material, never a client label.
  assert.strictEqual(categoryLabel({ name: 'Some Labor', agreement: 'General', category: 'material' }), 'material');
});

test('sentinel labels by action verb; verbless/Material- = material', () => {
  assert.strictEqual(resolveBidLine('Replaced flush handle', 20, [], [], 'AMH').name, 'Labor!'); // verb -> unlisted labor
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
