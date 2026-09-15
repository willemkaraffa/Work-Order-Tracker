'use strict';
// MSR tax accuracy, Slice 1: tax rides on the LABOR portion only.
// (roadmap-handoffs/msr-tax-accuracy.md, D1). An MSR price is tax-INCLUSIVE, so the
// face price never moves -- only the split between reported service and reported tax.
//   face  = material portion + labor portion
//   labor portion = pre-tax labor + embedded tax   (pre-tax labor = labor / 1.0725)
//   tax   = labor portion - pre-tax labor,  line total = face, ALWAYS
// Reference figures measured from the live MSR library: 3 Ton AC Condenser 2272.30
// (1772.30 material + 500.00 labor) -> 33.80 tax; Clean Condenser 150.00 labor-only
// -> 10.14; Diagnostic Fee 85.00 labor-only -> 5.75.
// SHIPPED code through the esbuild bridge. Exit: 0 pass / 1 fail.
const assert = require('assert');
const { loadEsm } = require('./_load.js');
const { computeInvoiceTotals, resolveBidLine, reconcileMsrRow, matchMsrRow, money,
  reconcileBlockToInvoice, recomputeInvoice, taxSplit } = loadEsm('src/orders-logic.js');
const fs = require('fs');
const path = require('path');
// HARNESS LIMITS, stated up front. src/invoices.jsx cannot be LOADED here: it imports
// app.jsx, which self-mounts the App on import and needs a DOM; and even under jsdom the
// esbuild bridge bundles its OWN React, so react-dom sees two React copies and the editor
// will not mount. No test below clicks Save or submits the item modal. The two
// editor-side contracts (the save map persists the split; the item modal submits NUMBERS)
// are pinned as source-shape assertions -- they fail LOUD if the fields are dropped again
// -- and their consequences are proven on the money core.
const SRC_INVOICES = fs.readFileSync(path.resolve(__dirname, '..', 'src/invoices.jsx'), 'utf8');

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e.message }); }
}
const inv = (lines) => ({ lineItems: lines });
const msr = (o) => ({ qty: 1, agreement: 'MSR', ...o });

/* ---------- (a) tax-inclusive: total == face, tax == the labor portion's ---------- */

test('(a) matched line: 2272.30 = 1772.30 material + 500 labor -> tax 33.80, total 2272.30', () => {
  const t = computeInvoiceTotals(inv([
    msr({ unitPrice: 2272.30, taxable: true, material: 1772.30, labor: 500.00 }),
  ]), 'MSR');
  assert.strictEqual(t.tax, 33.80);                  // 500 - 500/1.0725, NOT 153.61
  assert.strictEqual(t.taxableSubtotal, 466.20);     // pre-tax labor
  assert.strictEqual(t.nonTaxableSubtotal, 1772.30); // material passes through untaxed
  assert.strictEqual(t.grandTotal, 2272.30);         // face preserved to the cent
});

test('(a) unmatched LABOR-worded line: 100% labor, fully tax-bearing', () => {
  // No library counterpart -> the split comes from the wording convention (D6).
  const l = resolveBidLine('Labor to seal and repair ductwork', 265, [], [], 'MSR');
  assert.strictEqual(l.labor, 265);
  assert.strictEqual(l.material, 0);
  assert.strictEqual(l.taxable, true);
  const t = computeInvoiceTotals(inv([{ ...l, qty: 1 }]), 'MSR');
  assert.strictEqual(t.tax, 17.91);            // 265 - 265/1.0725
  assert.strictEqual(t.grandTotal, 265);
});

test('(a) unmatched MATERIAL-worded line: 100% material, untaxed', () => {
  const l = resolveBidLine('Material - new waterline section', 60, [], [], 'MSR');
  assert.strictEqual(l.material, 60);
  assert.strictEqual(l.labor, 0);
  assert.strictEqual(l.taxable, false);
  const t = computeInvoiceTotals(inv([{ ...l, qty: 1 }]), 'MSR');
  assert.strictEqual(t.tax, 0);
  assert.strictEqual(t.grandTotal, 60);
});

test('(a) wording that fits NEITHER lead is flagged, not guessed', () => {
  // Verbless, no Material/Labor lead -> filed as material (untaxed, the conservative
  // direction on a tax record) AND surfaced on the existing priceFlag path.
  const l = resolveBidLine('Thermostat', 120, [], [], 'MSR');
  assert.strictEqual(l.priceFlag, 'yellow');
  assert.strictEqual(l.taxable, false);
  // An explicit "Material" lead is NOT ambiguous -> no flag.
  assert.strictEqual(resolveBidLine('Materials for silicon, paint, sealant', 45, [], [], 'MSR').priceFlag, undefined);
  // A verb lead is NOT ambiguous either.
  assert.strictEqual(resolveBidLine('Replace shower cartridge', 90, [], [], 'MSR').priceFlag, undefined);
});

/* ---------- (b) the split scales as a SHARE, never as absolute dollars ---------- */

test('(b) billed off list: keeps the 22.0% labor SHARE, total still equals the bid', () => {
  // Listed 1772.30 / 500.00 = 22.0041% labor. Billed 2500 -> labor 550.10.
  const t = computeInvoiceTotals(inv([
    msr({ unitPrice: 2500, taxable: true, material: 1772.30, labor: 500.00 }),
  ]), 'MSR');
  assert.strictEqual(t.grandTotal, 2500);            // the bid price is never rewritten
  assert.strictEqual(t.nonTaxableSubtotal, 1949.90); // 2500 - 550.10 labor portion
  assert.strictEqual(t.tax, 37.19);                  // 550.10 - 550.10/1.0725
  // Same share as the library item, to the cent.
  const listShare = 500 / 2272.30;
  const billedShare = (t.tax + t.taxableSubtotal) / 2500;
  assert.ok(Math.abs(listShare - billedShare) < 0.0001, 'labor share drifted: ' + billedShare);
});

/* ---------- (c) the 'Included' sentinel is BUNDLED, never a number ---------- */

test("(c) material 'Included' -> all labor, taxed (Clean Condenser 150 -> 10.14)", () => {
  const t = computeInvoiceTotals(inv([
    msr({ unitPrice: 150, taxable: true, material: 'Included', labor: 150 }),
  ]), 'MSR');
  assert.strictEqual(t.tax, 10.14);
  assert.strictEqual(t.taxableSubtotal, 139.86);
  assert.strictEqual(t.nonTaxableSubtotal, 0);
  assert.strictEqual(t.grandTotal, 150);
});

test("(c) labor 'Included' -> all material, untaxed (refrigerant)", () => {
  // The refrigerant rows are the material-only ones; they stay untaxed WITHOUT a name
  // test, purely because their labor cell reads 'Included'.
  const t = computeInvoiceTotals(inv([
    msr({ unitPrice: 145, taxable: true, material: 145, labor: 'Included' }),
  ]), 'MSR');
  assert.strictEqual(t.tax, 0);
  assert.strictEqual(t.nonTaxableSubtotal, 145);
  assert.strictEqual(t.grandTotal, 145);
});

test("(c) 'Included' is never coerced to a number (no NaN leaks)", () => {
  const t = computeInvoiceTotals(inv([
    msr({ unitPrice: 300, taxable: true, material: 'Included', labor: 'Included' }),
  ]), 'MSR');
  for (const v of [t.tax, t.taxableSubtotal, t.nonTaxableSubtotal, t.grandTotal]) {
    assert.ok(Number.isFinite(v), 'non-finite total: ' + v);
  }
  assert.strictEqual(t.grandTotal, 300);       // face preserved either way
  assert.strictEqual(t.rows[0].material, 'Included');   // sentinel survives the round trip
});

test('(c) a line with NO split falls back to the old whole-price divide-out', () => {
  // Saved invoices predating the split must keep reporting exactly what they did.
  const t = computeInvoiceTotals(inv([msr({ unitPrice: 85, taxable: true })]), 'MSR');
  assert.strictEqual(t.taxableSubtotal, 79.25);
  assert.strictEqual(t.tax, 5.75);
  assert.strictEqual(t.grandTotal, 85);
  const t2 = computeInvoiceTotals(inv([msr({ unitPrice: 145, taxable: false })]), 'MSR');
  assert.strictEqual(t2.tax, 0);
  assert.strictEqual(t2.grandTotal, 145);
});

/* ---------- (d) REGRESSION LOCK: AMH / General are untouched ---------- */

test('(d) AMH + General totals are unchanged (tax added on top, never divided)', () => {
  const amh = computeInvoiceTotals(inv([{ unitPrice: 90, qty: 1, taxable: true, agreement: 'AMH' }]), 'AMH');
  assert.strictEqual(amh.taxableSubtotal, 90);
  assert.strictEqual(amh.tax, 6.53);
  assert.strictEqual(amh.grandTotal, 96.53);
  const amhFlat = computeInvoiceTotals(inv([{ unitPrice: 4608.32, qty: 1, taxable: false, agreement: 'AMH' }]), 'AMH');
  assert.strictEqual(amhFlat.tax, 0);
  assert.strictEqual(amhFlat.grandTotal, 4608.32);
  const gen = computeInvoiceTotals(inv([{ unitPrice: 100, qty: 1, taxable: true, agreement: 'General' }]), 'General');
  assert.strictEqual(gen.tax, 7.25);
  assert.strictEqual(gen.grandTotal, 107.25);
});

test('(d) the labor-only path CANNOT be reached by a non-inclusive agreement', () => {
  // AMH library material/labor are internal COST BASIS that do not sum to the sell price
  // (library_io.js ~92). Even when present on the line they must be ignored outright:
  // reading them as a tax basis would compute tax from our own cost (D7).
  const nonTax = computeInvoiceTotals(inv([
    { unitPrice: 300, qty: 1, taxable: false, agreement: 'AMH', material: 100, labor: 87.5 },
  ]), 'AMH');
  assert.strictEqual(nonTax.tax, 0);
  assert.strictEqual(nonTax.grandTotal, 300);        // NOT divided out
  const tax = computeInvoiceTotals(inv([
    { unitPrice: 90, qty: 1, taxable: true, agreement: 'AMH', material: 30, labor: 60 },
  ]), 'AMH');
  assert.strictEqual(tax.tax, 6.53);                 // added on top, as today
  assert.strictEqual(tax.grandTotal, 96.53);
  const gen = computeInvoiceTotals(inv([
    { unitPrice: 100, qty: 1, taxable: true, agreement: 'General', material: 50, labor: 50 },
  ]), 'General');
  assert.strictEqual(gen.grandTotal, 107.25);
});

test('(d) an AMH sentinel line is never given a split at all', () => {
  const amh = resolveBidLine('Labor to replace blower motor', 250, [], [], 'AMH');
  assert.strictEqual(amh.material, undefined);
  assert.strictEqual(amh.labor, undefined);
  assert.strictEqual(amh.taxable, false);            // AMH labor default, unchanged
  const gen = resolveBidLine('Labor to replace blower motor', 250, [], [], 'General');
  assert.strictEqual(gen.material, undefined);
  assert.strictEqual(gen.labor, undefined);
  assert.strictEqual(gen.taxable, true);
});

/* ---------- (e) the penny case: reconcile stays 'match', not 'off' ---------- */

const ORDERS = [{ id: 'WO-045', woId: '02045937', pm: 'MSR', address: '4102 Lady Slipper Ln', type: 'Plumbing' }];
const row = (o) => ({ woId: '', amount: 0, invoiceNum: '', propCode: '', addressRaw: '', ...o });

test("(e) 3-line inclusive invoice reconciles to the paid amount -> status 'match'", () => {
  // 2272.30 + 150.00 + 400.00 = 2822.30. Dividing the WHOLE price produced 2822.31 (a
  // 1-cent gap), which flips reconcileMsrRow from 'match' to 'off' at its 0.005 tolerance.
  const r = row({ woId: '02045937', amount: 2822.30 });
  const items = [
    { desc: '3 Ton AC Condenser', name: '3 Ton AC Condenser', unitPrice: 2272.30, qty: 1, taxable: true, material: 1772.30, labor: 500.00 },
    { desc: 'Clean Condenser', name: 'Clean Condenser', unitPrice: 150, qty: 1, taxable: true, material: 'Included', labor: 150 },
    { desc: 'Sump Pump', name: 'Sump Pump', unitPrice: 400, qty: 1, taxable: true, material: 0, labor: 400 },
  ];
  const rep = reconcileMsrRow(r, matchMsrRow(r, ORDERS), items);
  assert.strictEqual(rep.computed, 2822.30);
  assert.strictEqual(rep.status, 'match');
  assert.strictEqual(rep.tax, 70.98);                       // 33.80 + 10.14 + 27.04
  assert.strictEqual(rep.preTax, 2751.32);                  // 2822.30 - 70.98
  assert.deepStrictEqual(rep.lines.map(l => l.tax), [33.80, 10.14, 27.04]);
  assert.deepStrictEqual(rep.lines.map(l => l.post), [2272.30, 150, 400]);
  // Every line: pre + tax == post, by construction.
  for (const l of rep.lines) assert.strictEqual(Math.round((l.pre + l.tax) * 100) / 100, l.post);
});

/* ---------- (f) the SAVE path: a dropped split reads as no split at all ---------- */

test('(f) saved -> reloaded MSR invoice reports the same per-line tax', () => {
  // The persistence boundary is JSON. Whatever the editor writes is what the reload
  // recomputes from, so a field the save map omits is gone by the time tax is derived.
  const lines = [
    { ...resolveBidLine('Labor to seal and repair ductwork', 265, [], [], 'MSR'), qty: 1 },
    { ...resolveBidLine('Material - new waterline section', 60, [], [], 'MSR'), qty: 1 },
    { name: '3 Ton AC Condenser', desc: '3 Ton AC Condenser', qty: 1, unitPrice: 2272.30,
      taxable: true, agreement: 'MSR', material: 1772.30, labor: 500.00 },
    { name: 'Clean Condenser', desc: 'Clean Condenser', qty: 1, unitPrice: 150,
      taxable: true, agreement: 'MSR', material: 'Included', labor: 150 },
  ];
  const before = computeInvoiceTotals(inv(lines), 'MSR');
  const reloaded = JSON.parse(JSON.stringify({ lineItems: lines }));
  const after = computeInvoiceTotals(reloaded, 'MSR');
  const taxOf = (t) => t.rows.map(r => money(money(r.unitPrice * r.qty) - r.lineSubtotal));
  assert.deepStrictEqual(taxOf(after), taxOf(before));
  assert.deepStrictEqual(taxOf(after), [17.91, 0, 33.80, 10.14]);
  assert.strictEqual(after.grandTotal, before.grandTotal);
  assert.strictEqual(after.grandTotal, 2747.30);
  // Same lines with the split STRIPPED (what a save map that omits it produces) report
  // different tax -- this is the drop the assertion above is guarding against.
  const stripped = lines.map((l) => { const c = { ...l }; delete c.material; delete c.labor; return c; });
  assert.notDeepStrictEqual(taxOf(computeInvoiceTotals(inv(stripped), 'MSR')), taxOf(before));
});

test('(f) the InvoiceEditor save map persists material + labor (source contract)', () => {
  // SHAPE assertion on the shipped source, not an execution: the editor cannot be
  // mounted under this bridge (two React copies), and the drop it guards against is
  // invisible to every behavioural test because the reload path simply sees no split.
  const map = SRC_INVOICES.slice(SRC_INVOICES.indexOf('const clean = lines'));
  const body = map.slice(0, map.indexOf('if (!clean.length)'));
  // Match the FIELD, not the bare word: this block carries a comment naming both
  // fields, and a word match would stay green with the fields themselves deleted.
  assert.ok(/material:\s*l\.material/.test(body), 'save map drops `material` -- the tax base is lost on reload');
  assert.ok(/labor:\s*l\.labor/.test(body), 'save map drops `labor` -- the tax base is lost on reload');
});

/* ---------- (g) a HAND-ENTERED split must equal a library-sourced one ---------- */

test('(g) the item modal submits the split as a NUMBER (source contract)', () => {
  // A trimmed STRING here reads as "no split" downstream (see the two tests below), so
  // the conversion has to sit on the submit path, not in the money core.
  const sub = SRC_INVOICES.slice(SRC_INVOICES.indexOf('const submit = ()'));
  const body = sub.slice(0, sub.indexOf('const onEnter'));
  assert.ok(/material:\s*splitVal\(material\)/.test(body), 'item modal submits material unconverted');
  assert.ok(/labor:\s*splitVal\(labor\)/.test(body), 'item modal submits labor unconverted');
  // ... and the conversion keeps the sentinel a STRING rather than NaN-ing it.
  const conv = SRC_INVOICES.slice(SRC_INVOICES.indexOf('function splitVal'), SRC_INVOICES.indexOf('function ServiceItemModal'));
  assert.ok(/Number\.isFinite\(n\)\s*\?\s*n\s*:\s*s/.test(conv), 'splitVal no longer preserves the string sentinel');
});

test('(g) hand-entered split reports the SAME tax as the library-sourced split', () => {
  // material/labor as the modal now submits them: numbers, not trimmed strings.
  const hand = { unitPrice: 2272.30, qty: 1, taxable: true, agreement: 'MSR',
    material: 1772.30, labor: 500 };
  const fromLibrary = msr({ unitPrice: 2272.30, taxable: true, material: 1772.30, labor: 500.00 });
  const a = computeInvoiceTotals(inv([hand]), 'MSR');
  const b = computeInvoiceTotals(inv([fromLibrary]), 'MSR');
  assert.strictEqual(a.tax, b.tax);
  assert.strictEqual(a.tax, 33.80);
  assert.strictEqual(a.grandTotal, 2272.30);
  // ... and the same via the 'Included' sentinel, hand-entered.
  const handInc = { unitPrice: 150, qty: 1, taxable: true, agreement: 'MSR',
    material: 'Included', labor: 150 };
  assert.strictEqual(computeInvoiceTotals(inv([handInc]), 'MSR').tax, 10.14);
});

test('(g) a STRING split still reads as ABSENT (why the modal must convert)', () => {
  // laborShare checks typeof === 'number' strictly, and that strictness is deliberate:
  // it stops a malformed value being coerced into a tax figure. So the conversion has to
  // happen at the modal, not by loosening the money core -- an unconverted split falls
  // back to the whole-price divide-out (2272.30 -> 153.61 of tax instead of 33.80).
  const t = computeInvoiceTotals(inv([
    { unitPrice: 2272.30, qty: 1, taxable: true, agreement: 'MSR', material: '1772.30', labor: '500' },
  ]), 'MSR');
  assert.strictEqual(t.tax, 153.61);
  assert.strictEqual(t.grandTotal, 2272.30);   // face still preserved either way
});

/* ---------- (h) remittance block -> BILLED invoice keeps the same tax ---------- */

// A distinctive-token catalog so the matcher confirms on name + exact price. Filler keeps
// the IDF scorer honest (a 1-item catalog makes every token look rare).
const FILLER = Array.from({ length: 20 }, (_, i) => ({ name: 'Zzq' + i + ' Wodget' + i, desc: '', price: 1000 + i, taxable: false }));
const MSR_CAT = [
  { name: '3 Ton AC Condenser', desc: '', price: 2272.30, taxable: true, material: 1772.30, labor: 500.00 },
  { name: 'Clean Condenser', desc: '', price: 150, taxable: true, material: 'Included', labor: 150 },
  ...FILLER,
];

test('(h) billing a reconciled MSR block keeps the per-line tax the report showed', () => {
  // remittance report -> "Bill this" -> saved invoice. The saved invoice is the artifact
  // that matters, so its tax must equal what the report displayed a moment earlier.
  const r = row({ woId: '02045937', amount: 2422.30 });
  const items = [
    { desc: '3 Ton AC Condenser', name: '3 Ton AC Condenser', unitPrice: 2272.30, qty: 1, taxable: true, material: 1772.30, labor: 500.00 },
    { desc: 'Clean Condenser', name: 'Clean Condenser', unitPrice: 150, qty: 1, taxable: true, material: 'Included', labor: 150 },
  ];
  const block = reconcileMsrRow(r, matchMsrRow(r, ORDERS), items);
  assert.strictEqual(block.status, 'match');
  const blockTax = block.lines.map(l => l.tax);
  assert.deepStrictEqual(blockTax, [33.80, 10.14]);

  const invoice = reconcileBlockToInvoice(block, 'msr', '2026-08-28');
  const t = computeInvoiceTotals(invoice, 'MSR');
  const billedTax = t.rows.map(rw => money(money(rw.unitPrice * rw.qty) - rw.lineSubtotal));
  assert.deepStrictEqual(billedTax, blockTax);
  assert.strictEqual(t.grandTotal, 2422.30);
  assert.strictEqual(t.missingSplit, 0);          // choke-point signal: nothing was dropped

  // NEGATIVE CONTROL: the same billed invoice with the split removed reports different
  // tax (153.61 + 10.14), which is exactly the drop this test exists to catch.
  const stripped = { lineItems: invoice.lineItems.map((l) => { const c = { ...l }; delete c.material; delete c.labor; return c; }) };
  const st = computeInvoiceTotals(stripped, 'MSR');
  assert.notDeepStrictEqual(st.rows.map(rw => money(money(rw.unitPrice * rw.qty) - rw.lineSubtotal)), blockTax);
  assert.strictEqual(st.missingSplit, 2);         // and the core SAYS so instead of hiding it
});

test('(h) an AMH block is still billed with NO split (D7 lock)', () => {
  const block = { invoiceNum: 'A-1', lines: [
    { name: 'Replace contactor', desc: 'Replace contactor', qty: 1, unitPrice: 300, vendorTax: 21.75, post: 321.75, material: 100, labor: 87.5 },
  ] };
  const invoice = reconcileBlockToInvoice(block, 'amh', '2026-08-28');
  assert.strictEqual(invoice.lineItems[0].material, undefined);
  assert.strictEqual(invoice.lineItems[0].labor, undefined);
  assert.strictEqual(invoice.lineItems[0].taxable, false);
  assert.strictEqual(computeInvoiceTotals(invoice, 'AMH').grandTotal, 321.75);
});

/* ---------- (i) recompute REPAIRS a saved invoice that has no split ---------- */

test('(i) recompute restores the split on a split-less saved line and reports it', () => {
  // D3: saved invoices recompute. Before this, a pre-existing invoice stayed split-less
  // forever and kept reporting the whole-price tax (153.61 instead of 33.80).
  const saved = { lineItems: [
    { name: '3 Ton AC Condenser', desc: '3 Ton AC Condenser', qty: 1, unitPrice: 2272.30, taxable: true, category: 'labor', agreement: 'MSR' },
  ] };
  assert.strictEqual(computeInvoiceTotals(saved, 'MSR').tax, 153.61);        // the old, wrong figure
  assert.strictEqual(computeInvoiceTotals(saved, 'MSR').missingSplit, 1);    // and the core flags it

  const { lines, changes, totalDelta } = recomputeInvoice(saved, MSR_CAT, null, 'MSR');
  assert.strictEqual(lines[0].material, 1772.30);
  assert.strictEqual(lines[0].labor, 500);
  assert.ok(changes.some(c => c.field === 'material' && c.to === 1772.30), 'material repair not reported');
  assert.ok(changes.some(c => c.field === 'labor' && c.to === 500), 'labor repair not reported');
  const after = computeInvoiceTotals({ lineItems: lines }, 'MSR');
  assert.strictEqual(after.tax, 33.80);
  assert.strictEqual(after.missingSplit, 0);
  assert.strictEqual(after.grandTotal, 2272.30);
  assert.strictEqual(lines[0].unitPrice, 2272.30);   // money never rewritten
  assert.strictEqual(totalDelta, 0);                 // an inclusive total cannot move
});

test('(i) recompute repairs an unmatched line from its wording, and leaves AMH alone', () => {
  const savedMsr = { lineItems: [
    { name: 'Labor!', desc: 'Labor to seal and repair ductwork', qty: 1, unitPrice: 265, taxable: true, category: 'labor', agreement: 'MSR' },
  ] };
  const msrOut = recomputeInvoice(savedMsr, MSR_CAT, null, 'MSR');
  assert.strictEqual(msrOut.lines[0].labor, 265);
  assert.strictEqual(msrOut.lines[0].material, 0);
  assert.strictEqual(computeInvoiceTotals({ lineItems: msrOut.lines }, 'MSR').missingSplit, 0);
  // AMH: re-resolve carries no split, so nothing is adopted and no change is logged.
  const savedAmh = { lineItems: [
    { name: 'Labor!', desc: 'Labor to replace blower motor', qty: 1, unitPrice: 250, taxable: false, category: 'labor', agreement: 'AMH' },
  ] };
  const amhOut = recomputeInvoice(savedAmh, [], null, 'AMH');
  assert.strictEqual(amhOut.lines[0].material, undefined);
  assert.strictEqual(amhOut.lines[0].labor, undefined);
  assert.ok(!amhOut.changes.some(c => c.field === 'material' || c.field === 'labor'));
});

test('(i) an edited line is left alone, split and all (manual-edit protection)', () => {
  const saved = { lineItems: [
    { name: '3 Ton AC Condenser', desc: '3 Ton AC Condenser', qty: 1, unitPrice: 2272.30, taxable: true, category: 'labor', agreement: 'MSR', edited: true },
  ] };
  const { lines, changes } = recomputeInvoice(saved, MSR_CAT, null, 'MSR');
  assert.strictEqual(lines[0].material, undefined);
  assert.strictEqual(changes.length, 0);
});

/* ---------- the choke point itself ---------- */

test('taxSplit copies the split verbatim, or nothing at all', () => {
  assert.deepStrictEqual(taxSplit({ material: 1772.30, labor: 500 }), { material: 1772.30, labor: 500 });
  assert.deepStrictEqual(taxSplit({ material: 'Included', labor: 150 }), { material: 'Included', labor: 150 });
  assert.deepStrictEqual(taxSplit({ material: 0, labor: 400 }), { material: 0, labor: 400 });   // 0 is a real figure
  assert.deepStrictEqual(taxSplit({ name: 'no split here' }), {});
  assert.deepStrictEqual(taxSplit(null), {});
  assert.deepStrictEqual(taxSplit(undefined), {});
  // Spreading {} onto a line is a no-op, so every boundary can spread it unconditionally.
  assert.deepStrictEqual({ a: 1, ...taxSplit(null) }, { a: 1 });
});

console.log('msr-tax-accuracy test');
console.log('=====================');
let pass = 0, fail = 0;
for (const r of results) {
  if (r.ok) { pass++; console.log('  OK  ' + r.name); }
  else { fail++; console.log('  XX  ' + r.name + '\n      ' + r.err); }
}
console.log('\nTotal: ' + (pass + fail) + ' | Pass: ' + pass + ' | Fail: ' + fail);
process.exit(fail ? 1 : 0);
