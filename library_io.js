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
    let currentFamily = null;
    // Buffer the tab's rows first so we can look one row ahead: an HVAC equipment
    // FAMILY header (e.g. 'Evaporator Coil') is only recognizable because SIZE rows
    // ('1.5 Ton', '2 Ton') follow it. Its own col-D holds a SEER tier LABEL ('14 Seer'),
    // not a price, so it must not be emitted as an item.
    const rows = [];
    ws.eachRow((row, n) => {
      if (n < 2) return; // row 1 = fee prose; row 2 col-A is the first section
      const name = toStr(cellVal(row.getCell(1)));
      if (!name) return; // skip blank-name rows so nextNamed is always the next real row
      rows.push({
        name,
        price: toPrice(cellVal(row.getCell(4))), // col D = Premier Pricing / sell
        bRaw: cellVal(row.getCell(2)),           // col B = Material Cost (or SEER tier)
        cRaw: cellVal(row.getCell(3)),           // col C = Labor Cost (or SEER tier)
      });
    });
    const nextNamed = (i) => rows[i + 1] || null;
    for (let i = 0; i < rows.length; i++) {
      const { name, price, bRaw, cRaw } = rows[i];
      // Family header FIRST (before isSectionHeader): not itself a size, but the next
      // row IS a size -> its D is a tier label, not money. Set the family and do not
      // emit. Ordered ahead of the section check so a family whose D is blank/non-numeric
      // isn't miscaught as a section (which would clear currentFamily and de-prefix the
      // sizes). No real section header is directly followed by a size row.
      const nxt = nextNamed(i);
      if (!SIZE_RE.test(name) && nxt && SIZE_RE.test(nxt.name)) { currentFamily = name; continue; }
      if (isSectionHeader(name, price)) { currentSection = name; currentFamily = null; continue; }
      // Size row under a family (or bare): B/C are SEER cost tiers, NOT material/labor,
      // so use the 'Included' sentinel. Name = the size token ALONE (e.g. '1.5 Ton'):
      // the section header (subCategory=family) already carries the family context, so
      // prefixing it produced long redundant names (user 2026-07-29 item-name trim).
      if (SIZE_RE.test(name)) {
        items.push({
          name: name,
          desc: '', price: price == null ? 0 : price, page: tab,
          subCategory: currentFamily || currentSection,
          material: MATERIAL_INCLUDED, labor: MATERIAL_INCLUDED,
          taxable: SERVICE_ALWAYS_TAX_RE.test(name),
        });
        continue;
      }
      if (price == null) continue; // prose / banner rows w/ non-numeric D (keep family)
      // Normal upper-section item.
      currentFamily = null;
      const { material, labor } = splitFields(bRaw, cRaw);
      // AMH Premier items are tax-INCLUSIVE -> never taxed, EXCEPT service call /
      // diagnostic / emergency, which are ALWAYS taxed (core truth #2/#3).
      items.push({
        name, desc: '', price, page: tab, subCategory: currentSection,
        material, labor, taxable: SERVICE_ALWAYS_TAX_RE.test(name),
      });
    }
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
// A "size" row under an HVAC equipment family (e.g. '1.5 Ton', '2 Ton', '40 Gallon',
// '3 - 3.5 Ton'). Used only in parseAmh to detect family headers by look-ahead.
const SIZE_RE = /^\s*\d+(\.\d+)?(\s*-\s*\d+(\.\d+)?)?\s*(ton|gallon)s?\b/i;
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

// ── MSR Plumbing: hand-transcribed price list (no source file) ────────────────
// pricesheet.pdf section 4, effective 7/10/2026, user-verified. No plumbing bid-sheet
// xlsx exists, so these 53 rows are the source of record (roadmap-handoffs/
// service-library-categories.md, S2). page:'Plumbing', taxable:false (fully burdened,
// tax included -- same as MSR HVAC). manual:true so a "Seed MSR" (HVAC) re-seed keeps
// them. price = Total = Material + Labour. 'Included' (7 rows) = material bundled into
// labour on the sheet, stored as the sentinel (NOT 0). Minimum Job Fee + Permit
// EXCLUDED. Table columns: [item, material, labor, total]; 'I' = Included sentinel.
const PLUMBING_TABLE = {
  'Water Heater Replacement': [
    ['40 Gallon Water Heater: Gas', 828.82, 675.00, 1503.82],
    ['40 Gallon Water Heater: Electric', 674.45, 625.00, 1299.45],
    ['50 Gallon Water Heater: Gas', 856.12, 675.00, 1531.12],
    ['50 Gallon Water Heater: Electric', 723.85, 625.00, 1348.85],
    ['Direct Vent Water Heater', 1627.02, 725.00, 2352.02],
  ],
  'Water Heater Repair/Service': [
    ['Expansion Tank', 38.97, 100.00, 138.97],
    ['3/4 inch Water Ball Valve', 22.07, 90.00, 112.07],
    ['Drain Pan', 25.97, 22.50, 48.47],
    ['Water Heater Tune-Up Kit: upper/lower thermostats and 2 elements', 45.47, 200.00, 245.47],
    ['T&P Valve', 27.91, 90.00, 117.91],
    ['Anode Rod', 45.47, 90.00, 135.47],
    ['Thermocouple', 15.57, 90.00, 105.57],
  ],
  'Sewer & Drain Lines': [
    ['Unclog Main Sewer Line with Power Auger', 'I', 300.00, 300.00],
    ['Unclog Drain Line Through Roof Vent', 'I', 350.00, 350.00],
    ['Unclog Drain Line Through Removing and Resetting Existing Toilet', 'I', 350.00, 350.00],
    ['Unclog Main Sewer Line with Hydrojet Machine', 'I', 500.00, 500.00],
    ['Scope Sewer Lines with Camera', 'I', 350.00, 350.00],
  ],
  'Toilet': [
    ['Toilet with Wax Ring and Bolts', 131.27, 180.00, 311.27],
    ['Wax Ring and Bolts', 9.07, 90.00, 99.07],
    ['Flange with Wax Ring and Bolts', 23.71, 175.00, 198.71],
    ['Full Tank Repair Kit with Supply Line and Angle Stop', 51.57, 130.00, 181.57],
    ['Toilet Seat', 16.86, 22.50, 39.36],
    ['Unclog Toilet Using Auger', 'I', 150.00, 150.00],
  ],
  'Tub & Shower': [
    ['Garden Tub / Roman Tub', 0.00, 900.00, 900.00],
    ['Tub Insert', 388.70, 350.00, 738.70],
    ['3-Piece Tub Surround', 492.70, 650.00, 1142.70],
    ['Tile Surround (per square foot)', 0.00, 5.00, 5.00],
    ['3-Piece Shower Surround', 544.70, 700.00, 1244.70],
    ['Shower Pan', 336.70, 600.00, 936.70],
    ['Mixing Valve', 103.97, 200.00, 303.97],
    ['Tub/Shower Trim Kit with Valve', 128.70, 200.00, 328.70],
    ['Bath Tub Handle', 15.87, 45.00, 60.87],
    ['Showerhead: 3 Spray', 12.97, 22.50, 35.47],
    ['Toe-Touch Drain Bath Tub Kit', 31.17, 45.00, 76.17],
    ['Shower Head Arm', 18.17, 22.50, 40.67],
    ['Shower/Tub Cartridge', 0.00, 90.00, 90.00],
  ],
  'Sinks': [
    ['Bathroom: Pedestal Sink / Free Standing Vanity', 141.38, 250.00, 391.38],
    ['Bathroom: Undermount Sink', 91.10, 200.00, 291.10],
    ['Bathroom: Sink Faucet', 38.97, 90.00, 128.97],
    ['Bathroom: Pop-Up Assembly', 16.32, 22.50, 38.82],
    ['Kitchen: Undermount Sink', 162.84, 200.00, 362.84],
    ['Kitchen: Faucet', 128.70, 90.00, 218.70],
    ['Kitchen: Sink Strainer and Drain Assembly', 6.34, 45.00, 51.34],
    ['P-trap', 6.42, 22.50, 28.92],
    ['Sink Cartridge', 14.74, 90.00, 104.74],
    ['Snake Kitchen/Bathroom Sink', 'I', 150.00, 150.00],
  ],
  'Miscellaneous': [
    ['Exterior Water Spigot / Hose Bibb', 15.31, 134.69, 150.00],
    ['1/2 inch Gas Ball Valve', 15.34, 90.00, 105.34],
    ['1/2 inch Angle Stop Shutoff Valve', 14.83, 45.00, 59.83],
    ['Washer Box and Valves', 29.56, 225.00, 254.56],
    ['Backflow Preventer / Pressure Vacuum Breaker', 0.00, 300.00, 300.00],
    ['Sump Pump', 0.00, 400.00, 400.00],
    ['Stainless Steel Supply Line', 9.46, 22.50, 31.96],
  ],
};
function plumbingSeedItems() {
  const items = [];
  for (const [section, rows] of Object.entries(PLUMBING_TABLE)) {
    for (const [name, mat, lab, total] of rows) {
      items.push({
        name, desc: '', price: total, taxable: false,
        page: 'Plumbing', subCategory: section, manual: true,
        material: mat === 'I' ? MATERIAL_INCLUDED : mat,
        labor: lab === 'I' ? MATERIAL_INCLUDED : lab,
      });
    }
  }
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

// ── Generic import: read an ARBITRARY xlsx into a raw grid ────────────────────
// Unlike parseRoundtrip (fixed export layout), this makes no assumption about the
// columns. Returns { sheets: [{ name, rows: [[cell,...],...] }] } so the renderer
// can show a preview + let the user map columns -> name/desc/price/taxable/page/
// section. Numbers stay numbers (price parsing), everything else -> trimmed string.
function gridCell(cell) {
  const v = cellVal(cell);
  if (v == null) return '';
  if (typeof v === 'number') return v;
  return toStr(v);
}
async function readGrid(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const sheets = [];
  wb.eachSheet((ws) => {
    const cols = ws.columnCount || 0;
    const rows = [];
    ws.eachRow((row) => {
      const arr = [];
      for (let c = 1; c <= cols; c++) arr.push(gridCell(row.getCell(c)));
      // Drop fully-blank rows so the preview isn't padded with empties.
      if (arr.some(x => x !== '' && x != null)) rows.push(arr);
    });
    sheets.push({ name: ws.name, cols, rows });
  });
  return { sheets };
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

module.exports = { parseGeneral, parseAmh, parseMsr, parseRoundtrip, readGrid, exportLibrary, isSectionHeader, splitFields, plumbingSeedItems, MATERIAL_INCLUDED };
