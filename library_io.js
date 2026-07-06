'use strict';
// Service-item library xlsx I/O. Pure exceljs (no Python).
//   - parseGeneral: seed the General tab from RazorSync_Invoice_Tracker.xlsx "Service Items".
//   - parseAmh:     seed the AMH tab from "AMH Premier Pricing All scopes.xlsx" (3 scope tabs).
//   - parseMsr:     seed the MSR tab from the embedded fixed HVAC price list (no file).
//   - parseRoundtrip: restore a previously exported Service Library.xlsx.
//   - exportLibrary: write Service Library.xlsx (one sheet per tab), re-importable by parseRoundtrip.
// Item shape everywhere: { name, desc, price, taxable }.

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

// ── AMH: AMH Premier Pricing All scopes.xlsx, scope tabs ──────────────────────
// Tabs imported: Plum Minor, Plum Major, HVAC. Row 1 = instructions, row 2 = header,
// data from row 3. Col A = name, Col D = price ("Premier Pricing"). Section-header
// rows (e.g. 'Clogs:') have no numeric price -> skipped. Prices are tax-inclusive.
const AMH_TABS = ['Plum Minor', 'Plum Major', 'HVAC'];
async function parseAmh(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const items = [];
  for (const tab of AMH_TABS) {
    const ws = wb.getWorksheet(tab);
    if (!ws) continue;
    ws.eachRow((row, n) => {
      if (n <= 2) return; // instructions + header
      const name = toStr(cellVal(row.getCell(1)));
      const price = toPrice(cellVal(row.getCell(4)));
      if (!name || price == null) return; // section header / blank
      items.push({ name, desc: tab, price, taxable: false });
    });
  }
  return items;
}

// ── MSR: fixed HVAC bid-sheet pricing (embedded, not a user file) ─────────────
// MSR (Main Street Renewal) issues a signed, fixed HVAC price list; effective
// 2026-07-02 (see roadmap-handoffs/msr-pricing-update.md). THIS ARRAY IS THE
// AUTHORITATIVE runtime source; roadmap-handoffs/msr-hvac-catalog.{json,csv} are a
// provenance snapshot only -- on a price revision, edit HERE. Unlike General/AMH,
// there is no local workbook to read -- the 98 line items are the FIRST bid-sheet
// table (Item -> Total Price), embedded here so Seed MSR is one click.
// taxable is per-item, set from each line's PDF description: items whose scope text
// states the price includes tax ("applicable taxes" / "tax") are tax-FINAL ->
// taxable:false (used as-is, no tax added or divided). Items with no tax mention
// (labor/diagnostic/cleaning) stay taxable:true, so the invoice MSR divide-out
// (invoices.jsx computeInvoiceTotals) breaks the embedded tax back out. A handful
// of materials with no explicit tax wording (refrigerants, thermostat, defrost
// board, filter, line set, distribution box) are left taxable:true for the user to
// adjust at their discretion. Descriptions dropped by request. Source name spellings
// kept verbatim ("Pacakaged") so invoice autofill matches MSR-scraped bid descriptions.
const MSR_ITEMS = [
  { name: 'Diagnostic Fee', desc: '', price: 85.0, taxable: true },
  { name: 'Emergency or After Hours Diagnostic Fee', desc: '', price: 135.0, taxable: true },
  { name: 'Clean Drain Pan and Drain Line', desc: '', price: 145.0, taxable: true },
  { name: 'Clean Evaporator Coil In Place', desc: '', price: 145.0, taxable: true },
  { name: 'Clean Condenser', desc: '', price: 150.0, taxable: true },
  { name: 'Distribution Box Replacement', desc: '', price: 225.0, taxable: true },
  { name: 'Filter Replacement', desc: '', price: 20.0, taxable: true },
  { name: 'Flex Duct Vent Replacement (per line)', desc: '', price: 225.0, taxable: false },
  { name: 'Evacuate Refrigerant System', desc: '', price: 99.0, taxable: true },
  { name: 'Leak Check', desc: '', price: 149.0, taxable: true },
  { name: 'Line Set Replacement (no refrigerant)', desc: '', price: 600.0, taxable: true },
  { name: 'R22', desc: '', price: 50.0, taxable: true },
  { name: 'R410a', desc: '', price: 50.0, taxable: true },
  { name: 'R32', desc: '', price: 50.0, taxable: true },
  { name: 'R454b', desc: '', price: 50.0, taxable: true },
  { name: '1.5 Ton Heat Pump System Full Replacement', desc: '', price: 4608.32, taxable: false },
  { name: '2.5 Ton Heat Pump System Full Replacement', desc: '', price: 4951.94, taxable: false },
  { name: '3 Ton Heat Pump System Full Replacement', desc: '', price: 5321.76, taxable: false },
  { name: '3.5 Ton Heat Pump System Full Replacement', desc: '', price: 5534.34, taxable: false },
  { name: '5 Ton Heat Pump System Full Replacement', desc: '', price: 6378.82, taxable: false },
  { name: '1.5 Ton Straight Cool System Full Replacement', desc: '', price: 4241.57, taxable: false },
  { name: '2.5 Ton Straight Cool System Full Replacement', desc: '', price: 4443.95, taxable: false },
  { name: '3 Ton Straight Cool System Full Replacement', desc: '', price: 4715.5, taxable: false },
  { name: '3.5 Ton Straight Cool System Full Replacement', desc: '', price: 4964.47, taxable: false },
  { name: '5 Ton Straight Cool System Full Replacement', desc: '', price: 5586.18, taxable: false },
  { name: '1.5 Ton Gas Split System Full Replacement', desc: '', price: 4578.22, taxable: false },
  { name: '2.5 Ton Gas Split System Full Replacement', desc: '', price: 4867.24, taxable: false },
  { name: '3 Ton Gas Split System Full Replacement', desc: '', price: 5079.09, taxable: false },
  { name: '4 Ton Gas Split System Full Replacement', desc: '', price: 5694.98, taxable: false },
  { name: '5 Ton Gas Split System Full Replacement', desc: '', price: 5968.7, taxable: false },
  { name: '2.5 Ton AC Pacakaged System - Downflow/Horizontal', desc: '', price: 5369.12, taxable: false },
  { name: '3 Ton AC Pacakaged System - Downflow/Horizontal', desc: '', price: 5416.44, taxable: false },
  { name: '3.5 Ton AC Pacakaged System - Downflow/Horizontal', desc: '', price: 5567.14, taxable: false },
  { name: '4 Ton AC Pacakaged System - Downflow/Horizontal', desc: '', price: 5778.26, taxable: false },
  { name: '2 Ton Heat Pump Pacakaged System - Downflow/Horizontal', desc: '', price: 4894.46, taxable: false },
  { name: '2.5 Ton Heat Pump Pacakaged System - Downflow/Horizontal', desc: '', price: 5234.44, taxable: false },
  { name: '3 Ton Heat Pump Pacakaged System - Downflow/Horizontal', desc: '', price: 6316.25, taxable: false },
  { name: '4 Ton Heat Pump Pacakaged System - Downflow/Horizontal', desc: '', price: 5599.17, taxable: false },
  { name: '5 Ton Heat Pump Pacakaged System - Downflow/Horizontal', desc: '', price: 6300.96, taxable: false },
  { name: '1.5 Ton Air Handler', desc: '', price: 1961.96, taxable: false },
  { name: '2.5 Ton Air Handler', desc: '', price: 2004.91, taxable: false },
  { name: '3 Ton Air Handler', desc: '', price: 2103.19, taxable: false },
  { name: '3.5 Ton Air Handler', desc: '', price: 2144.69, taxable: false },
  { name: '4 Ton Air Handler', desc: '', price: 2182.54, taxable: false },
  { name: '1.5 Ton 80% Furnace', desc: '', price: 1736.79, taxable: false },
  { name: '2 Ton 80% Furnace', desc: '', price: 1736.79, taxable: false },
  { name: '2.5 Ton 80% Furnace', desc: '', price: 1813.96, taxable: false },
  { name: '3.5 Ton 80% Furnace', desc: '', price: 1924.62, taxable: false },
  { name: '4 Ton 80% Furnace', desc: '', price: 1988.68, taxable: false },
  { name: '5 Ton 80% Furnace', desc: '', price: 1988.68, taxable: false },
  { name: '1.5 Ton 92% Furnace', desc: '', price: 2039.64, taxable: false },
  { name: '2.5 Ton 92% Furnace', desc: '', price: 2111.71, taxable: false },
  { name: '3 Ton 92% Furnace', desc: '', price: 2111.71, taxable: false },
  { name: '3.5 Ton 92% Furnace', desc: '', price: 2367.97, taxable: false },
  { name: '4 Ton 92% Furnace', desc: '', price: 2461.15, taxable: false },
  { name: '1.5 Ton Evaporator Coil', desc: '', price: 951.82, taxable: false },
  { name: '2 Ton Evaporator Coil', desc: '', price: 988.95, taxable: false },
  { name: '2.5 Ton Evaporator Coil', desc: '', price: 1004.24, taxable: false },
  { name: '3 Ton Evaporator Coil', desc: '', price: 1042.82, taxable: false },
  { name: '4 Ton Evaporator Coil', desc: '', price: 1131.64, taxable: false },
  { name: '5 Ton Evaporator Coil', desc: '', price: 1131.64, taxable: false },
  { name: '1.5 Ton AC Condenser', desc: '', price: 1939.61, taxable: false },
  { name: '2 Ton AC Condenser', desc: '', price: 2040.8, taxable: false },
  { name: '3 Ton AC Condenser', desc: '', price: 2272.3, taxable: false },
  { name: '3.5 Ton AC Condenser', desc: '', price: 2479.78, taxable: false },
  { name: '4 Ton AC Condenser', desc: '', price: 2624.66, taxable: false },
  { name: '1.5 Ton Heat Pump Condenser', desc: '', price: 2406.36, taxable: false },
  { name: '2 Ton Heat Pump Condenser', desc: '', price: 2458.78, taxable: false },
  { name: '2.5 Ton Heat Pump Condenser', desc: '', price: 2707.02, taxable: false },
  { name: '3.5 Ton Heat Pump Condenser', desc: '', price: 3149.65, taxable: false },
  { name: '4 Ton Heat Pump Condenser', desc: '', price: 3365.14, taxable: false },
  { name: '5 Ton Heat Pump Condenser', desc: '', price: 3791.02, taxable: false },
  { name: '1.5 Ton Heat Kit Replacement', desc: '', price: 409.14, taxable: false },
  { name: '2.5 Ton Heat Kit Replacement', desc: '', price: 423.3, taxable: false },
  { name: '3 Ton Heat Kit Replacement', desc: '', price: 428.85, taxable: false },
  { name: '3.5 Ton Heat Kit Replacement', desc: '', price: 428.85, taxable: false },
  { name: '4 Ton Heat Kit Replacement', desc: '', price: 512.01, taxable: false },
  { name: '5 Ton Heat Kit Replacement', desc: '', price: 534.8, taxable: false },
  { name: '1.5 Ton Condenser Fan Replacement', desc: '', price: 745.16, taxable: false },
  { name: '2 Ton Condenser Fan Replacement', desc: '', price: 745.16, taxable: false },
  { name: '2.5 Ton Condenser Fan Replacement', desc: '', price: 728.33, taxable: false },
  { name: '3 Ton Condenser Fan Replacement', desc: '', price: 801.78, taxable: false },
  { name: '4 Ton Condenser Fan Replacement', desc: '', price: 801.78, taxable: false },
  { name: '5 Ton Condenser Fan Replacement', desc: '', price: 801.78, taxable: false },
  { name: 'Air Handler Sequencer Replacement', desc: '', price: 125.82, taxable: false },
  { name: 'Blower Motor Replacement', desc: '', price: 554.35, taxable: false },
  { name: 'Capacitor Replacement', desc: '', price: 124.58, taxable: false },
  { name: 'Condenser Contactor Replacement', desc: '', price: 125.66, taxable: false },
  { name: 'Condenser Fan Motor Replacement', desc: '', price: 391.47, taxable: false },
  { name: 'Defrost Control Board Replacement', desc: '', price: 258.23, taxable: true },
  { name: 'Draft Inducer Replacement', desc: '', price: 450.39, taxable: false },
  { name: 'Flame Sensor Replacement', desc: '', price: 225.75, taxable: false },
  { name: 'Gas Valve Replacement', desc: '', price: 375.35, taxable: false },
  { name: 'Igniter Replacement', desc: '', price: 275.05, taxable: false },
  { name: 'Limit Switch Replacement', desc: '', price: 124.97, taxable: false },
  { name: 'Main Control Board Replacement', desc: '', price: 406.34, taxable: false },
  { name: 'Thermostat Replacement', desc: '', price: 134.5, taxable: true },
  { name: 'Crane Fee', desc: '', price: 500.0, taxable: true },
];
// Return a fresh copy each call so callers can't mutate the shared constant.
function parseMsr() { return MSR_ITEMS.map(it => ({ ...it })); }

// ── Round-trip restore: Service Library.xlsx (our own export) ─────────────────
// One sheet per tab, header row [Item Name, Description, Price, Taxable].
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
      items.push({ name, desc, price: price == null ? 0 : price, taxable });
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
    ];
    ws.getRow(1).font = { bold: true };
    for (const it of (items || [])) {
      ws.addRow({
        name: it.name || '',
        desc: it.desc || '',
        price: typeof it.price === 'number' ? it.price : (toPrice(it.price) || 0),
        taxable: it.taxable ? 'Yes' : 'No',
      });
    }
  }
  await wb.xlsx.writeFile(filePath);
}

module.exports = { parseGeneral, parseAmh, parseMsr, parseRoundtrip, exportLibrary };
