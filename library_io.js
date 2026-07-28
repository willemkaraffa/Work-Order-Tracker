'use strict';
// Service-item library xlsx I/O. Pure exceljs (no Python).
//   - parseGeneral: seed the General tab from RazorSync_Invoice_Tracker.xlsx "Service Items".
//   - parseAmh:     seed the AMH tab from "AMH Premier Pricing All scopes.xlsx" (3 scope tabs).
//   - parseMsr:     seed the MSR tab from the embedded fixed HVAC price list (no file).
//   - parseRoundtrip: restore a previously exported Service Library.xlsx.
//   - exportLibrary: write Service Library.xlsx (one sheet per tab), re-importable by parseRoundtrip.
// Item shape everywhere: { name, desc, price, taxable, page, subCategory, material, labor }.

const ExcelJS = require('exceljs');

// exceljs cell values can be plain, or objects (formula result / rich text / hyperlink).
function cellVal(cell) {
  const v = cell ? cell.value : null;
  if (v == null) return null;
  if (typeof v === 'object') {
    if ('result' in v) return v.result;
    if ('text' in v) return v.text;
    if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join('');
    if ('hyperlink' in v && 'text' in v) return v.text;
  }
  return v;
}

function toStr(v) { return v == null ? '' : String(v).replace(/\s+/g, ' ').trim(); }

function toPrice(v) {
  let n = null;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string') {
    const m = v.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    if (m) n = parseFloat(m[0]);
  }
  if (n == null || Number.isNaN(n)) return null;
  return Math.round(n * 100) / 100; // money: kill float noise
}

// A no-price row is a SECTION HEADER (e.g. 'Water Heaters:', 'Condenser:'), not an
// item, when its name is short and not a TOTAL/summary line. Longer no-price rows are
// instruction prose and get dropped. Shared by parseAmh + parseMsr section recovery.
function isSectionHeader(name, price) {
  return price == null && name && String(name).trim().length <= 48 && !/total/i.test(name);
}

// Material/labor sentinel: a BLANK cost cell means the cost is bundled (into labor, or
// into material for refrigerants), NOT $0. Store the string so the UI shows "Included".
const MATERIAL_INCLUDED = 'Included';
function splitFields(matRaw, labRaw) {
  const m = toPrice(matRaw);
  const l = toPrice(labRaw);
  return {
    material: m == null ? MATERIAL_INCLUDED : m,
    labor:    l == null ? MATERIAL_INCLUDED : l,
  };
}

// Round-trip read of a material/labor cell: blank -> null (absent), 'Included' string
// preserved verbatim, numeric -> number. Keeps the sentinel lossless on re-import.
function matLabVal(v) {
  const s = toStr(v);
  if (!s) return null;
  const n = toPrice(s);
  return n == null ? s : n;
}

// ── General: RazorSync_Invoice_Tracker.xlsx, sheet "Service Items" ────────────
// Cols: A=Item Name, B=Description, C=Price, D=Taxable(Yes/No), E=PM (DROPPED).
// Skip header (row 1) and empty names. 'Labor!'/'Materials!' sentinels are KEPT
// as items: they are the fallback names used when a bid line cannot be matched
// to a catalog entry (see InvoiceEditor bid prefill in index.html).
async function parseGeneral(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.getWorksheet('Service Items');
  if (!ws) throw new Error('Sheet "Service Items" not found in ' + filePath);
  const items = [];
  ws.eachRow((row, n) => {
    if (n === 1) return; // header
    const name = toStr(cellVal(row.getCell(1)));
    if (!name) return;
    const desc = toStr(cellVal(row.getCell(2)));
    const price = toPrice(cellVal(row.getCell(3)));
    const taxable = /^y/i.test(toStr(cellVal(row.getCell(4))));
    items.push({ name, desc, price: price == null ? 0 : price, taxable });
  });
  return items;
}

// ── AMH: New Structure xlsx, trade tabs ───────────────────────────────────────
// Tabs imported: Plum Minor, Plum Major, HVAC. Row 1 = fee/instruction prose (skip).
// Row 2 is BOTH the column-label row AND the first section name in col A (e.g.
// 'Clogs:'/'Condenser:') -- so headers/sections start at row 2, not 3. Cols: A=name,
// B=Material Cost, C=Labor Cost, D=Premier Pricing (=price/sell). E/F are an
// overhead/profit slider legend (E holds 'Overhead'/'Profit'/blank, F holds 0.2/0.4),
// NOT per-item columns -- IGNORED. Section headers = no-price col-A rows
// (isSectionHeader) -> set currentSection, do not emit. page = the tab; subCategory =
// the current section. AMH is COST BASIS: material (B) + labor (C) are internal costs
// and deliberately do NOT sum to price (D, a single burdened sell number ~= (B+C)x1.6).
// Do NOT "fix" this to make them add up. Prices are tax-inclusive.
const AMH_TABS = ['Plum Minor', 'Plum Major', 'HVAC'];
async function parseAmh(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const items = [];
  for (const tab of AMH_TABS) {
    const ws = wb.getWorksheet(tab);
    if (!ws) continue;
    let currentSection = '';
    ws.eachRow((row, n) => {
      if (n < 2) return; // row 1 = fee prose; row 2 col-A is the first section
      const name = toStr(cellVal(row.getCell(1)));
      if (!name) return;
      const price = toPrice(cellVal(row.getCell(4))); // col D = Premier Pricing
      if (isSectionHeader(name, price)) { currentSection = name; return; }
      if (price == null) return; // no-price prose that is not a section header
      const { material, labor } = splitFields(cellVal(row.getCell(2)), cellVal(row.getCell(3)));
      // AMH Premier items are tax-INCLUSIVE -> never taxed, EXCEPT service call /
      // diagnostic / emergency, which are ALWAYS taxed (core truth #2/#3).
      items.push({
        name, desc: '', price, page: tab, subCategory: currentSection,
        material, labor, taxable: SERVICE_ALWAYS_TAX_RE.test(name),
      });
    });
  }
  return items;
}

// ── MSR: HVAC bid-sheet pricing (read from the live MSR bid sheet) ────────────
// MSR (Main Street Renewal) requires all bids on THEIR designated Excel bid sheet,
// which they revise over time. That same sheet is our WO-folder automation skeleton
// (main.js BID_SKELETON.HVAC) AND the price source, so parseMsr reads it directly:
// re-seeding the MSR catalog picks up MSR's latest prices with zero hand edits (the
// old embedded array had drifted -- 98 items vs the sheet's 120, missing several
// tonnages). Catalog = the first table on the 'Vendor HVAC Bid Sheet' tab: col B =
// Item, col G = Total Price (fully burdened / tax-INCLUSIVE per the master agreement).
// Rows with no numeric Total Price are section headers or the trailing OTHER
// placeholder -> skipped. Per-item taxable is READ from the col C scope prose ("Item
// Description"), not hardcoded (core truth #4, roadmap-handoffs/invoice-generation.md):
// prose that states the price includes tax ("...applicable taxes...") -> tax-included
// -> taxable:false; a material (refrigerant R22/R410a) -> false; a service call /
// diagnostic / emergency -> ALWAYS true; otherwise a taxable service. MSR stays a
// divide-out (CATALOG_TAX.MSR.taxableInclusive), so grand = face = paid either way.
// Source name spellings kept verbatim ("Pacakaged") so invoice autofill matches the
// MSR-scraped bid descriptions. Per-item split (sell-side, VERIFIED E+F==G on 104/104
// data rows): col E = Material Price, F = Labor Price, G = Total Price. Labor-only
// services leave E blank (-> material='Included'); refrigerants (R22/R410a/R32/R454b)
// leave F blank (-> labor='Included'). Section headers recovered via isSectionHeader;
// page stamped 'HVAC'.
const MSR_SHEET = 'Vendor HVAC Bid Sheet';
// Refrigerants (R22, R-410A, R407c, R134a) and other physical materials are never taxed.
const REFRIGERANT_RE = /^\s*R-?\d{2,3}[a-z]?\b/i;
const SERVICE_ALWAYS_TAX_RE = /\b(service\s*call|diagnostic|emergency|trip\s*(fee|charge))\b/i;
function msrTaxable(name, prose) {
  if (REFRIGERANT_RE.test(name)) return false;               // material
  if (SERVICE_ALWAYS_TAX_RE.test(name)) return true;         // core truth #3
  if (/\btax/i.test(prose)) return false;                    // prose says price includes tax
  return true;                                               // taxable service
}
async function parseMsr(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.getWorksheet(MSR_SHEET);
  if (!ws) throw new Error(`Sheet "${MSR_SHEET}" not found in ${filePath}`);
  const items = [];
  let currentSection = '';
  ws.eachRow((row, n) => {
    if (n <= 13) return; // title + instructions + header (Item header = row 13)
    const name = toStr(cellVal(row.getCell(2)));    // col B = Item
    if (!name) return;
    const price = toPrice(cellVal(row.getCell(7)));  // col G = Total Price
    if (isSectionHeader(name, price)) { currentSection = name; return; }
    if (price == null) return;                       // OTHER placeholder / summary prose
    const prose = toStr(cellVal(row.getCell(3)));    // col C = Item Description (scope prose)
    const { material, labor } = splitFields(cellVal(row.getCell(5)), cellVal(row.getCell(6))); // E, F
    items.push({ name, desc: '', price, page: 'HVAC', subCategory: currentSection, material, labor, taxable: msrTaxable(name, prose) });
  });
  return items;
}

// ── Round-trip restore: Service Library.xlsx (our own export) ─────────────────
// One sheet per tab, header row [Item Name, Description, Price, Taxable, Page,
// Section, Material, Labor]. Page/Section/Material/Labor read back into
// page/subCategory/material/labor (the 'Included' sentinel preserved as a string).
// Returns { [tabName]: items[] }.
async function parseRoundtrip(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const out = {};
  wb.eachSheet((ws) => {
    const items = [];
    ws.eachRow((row, n) => {
      if (n === 1) return; // header
      const name = toStr(cellVal(row.getCell(1)));
      if (!name) return;
      const desc = toStr(cellVal(row.getCell(2)));
      const price = toPrice(cellVal(row.getCell(3)));
      const taxable = /^y/i.test(toStr(cellVal(row.getCell(4))));
      const page = toStr(cellVal(row.getCell(5)));
      const subCategory = toStr(cellVal(row.getCell(6)));
      const material = matLabVal(cellVal(row.getCell(7)));
      const labor = matLabVal(cellVal(row.getCell(8)));
      const it = { name, desc, price: price == null ? 0 : price, taxable };
      if (page) it.page = page;
      if (subCategory) it.subCategory = subCategory;
      if (material != null) it.material = material;
      if (labor != null) it.labor = labor;
      items.push(it);
    });
    out[ws.name] = items;
  });
  return out;
}

// ── Export: write Service Library.xlsx, one sheet per tab ─────────────────────
// tabs = { [tabName]: items[] }. Re-importable via parseRoundtrip.
async function exportLibrary(filePath, tabs) {
  const wb = new ExcelJS.Workbook();
  for (const [tabName, items] of Object.entries(tabs)) {
    const ws = wb.addWorksheet(tabName || 'Sheet1');
    ws.columns = [
      { header: 'Item Name', key: 'name', width: 50 },
      { header: 'Description', key: 'desc', width: 40 },
      { header: 'Price', key: 'price', width: 12 },
      { header: 'Taxable', key: 'taxable', width: 10 },
      { header: 'Page', key: 'page', width: 16 },
      { header: 'Section', key: 'subCategory', width: 24 },
      { header: 'Material', key: 'material', width: 12 },
      { header: 'Labor', key: 'labor', width: 12 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const it of (items || [])) {
      ws.addRow({
        name: it.name || '',
        desc: it.desc || '',
        price: typeof it.price === 'number' ? it.price : (toPrice(it.price) || 0),
        taxable: it.taxable ? 'Yes' : 'No',
        page: it.page || '',
        subCategory: it.subCategory || '',
        // Preserve the 'Included' STRING and numeric 0 verbatim; blank/absent -> ''.
        material: it.material == null ? '' : it.material,
        labor: it.labor == null ? '' : it.labor,
      });
    }
  }
  await wb.xlsx.writeFile(filePath);
}

module.exports = { parseGeneral, parseAmh, parseMsr, parseRoundtrip, exportLibrary, isSectionHeader, splitFields, MATERIAL_INCLUDED };
