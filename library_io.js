'use strict';
// Service-item library xlsx I/O. Pure exceljs (no Python).
//   - parseGeneral: seed the General tab from RazorSync_Invoice_Tracker.xlsx "Service Items".
//   - parseAmh:     seed the AMH tab from "AMH Premier Pricing All scopes.xlsx" (3 scope tabs).
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

module.exports = { parseGeneral, parseAmh, parseRoundtrip, exportLibrary };
