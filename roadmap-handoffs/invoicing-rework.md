# INVOICING REWORK - in-app invoices + service-item library + module launcher

Retire the workbook-export pipeline. Move invoice recording INTO the tracker. Turn the
workbook into an in-app, multi-agreement service-item library (seeded once, editable in-app,
exportable as a backup spreadsheet). Add a header module launcher (full-screen overlay) that
switches between Work Orders / Invoices / Service Items.

Large, multi-part feature. Commit in coherent slices (sequence at the end). Do NOT push. Do NOT publish.

Repo: `C:\dev\Work-Order-Tracker`. Branch: `main`. App version 3.1.0 (`package.json`).
Electron + React via Babel-standalone, no build step (JSX compiled at runtime,
`index.html:32` `data-presets="env,react"`). Dev: `npm start` (quit the installed-app tray
instance first - single-instance lock), reload with Ctrl+R. Verify syntax by reading; user reloads to test.

## Rules (from CLAUDE.md - obey exactly)
- Read existing files before writing. Don't re-read unless changed.
- No emojis or em-dashes.
- Do not guess APIs, versions, flags, SHAs, or package names. Verify by reading code/docs.
- Work silently; chat only after the task is complete; minimal wording.
- Before implementing, search for existing working code and prefer wrapping it.
- When porting from a working reference, port the MECHANISM (stack/tool/technique), not just selectors/constants.
- On the second failed attempt at the same problem, stop and re-examine the approach before a third try.
- When you flag a risk in static review, either mitigate it or design a live test for it before proceeding.
- Commit each discrete slice separately. Do NOT push. Do NOT publish.
- (Memory) When something "still" looks wrong after a fix, grep the user-visible string and confirm WHICH
  component renders it before editing. This repo has DUPLICATE components sharing labels
  (e.g. launch `FullScreenLanding` index.html:~3568 vs in-pane `Landing` ~:2534). Two prior fixes were wasted on the wrong one.
- UI must never clip: bound the container and give it an internal scroll region
  (`flex:1; minHeight:0; overflowY:auto`) with a pinned `flexShrink:0` footer. Do NOT use Electron zoom (reverted, commit a229503).

## Confirmed scope (user decisions - do not re-litigate)

### Pipeline retirement
- The RazorSync export chain is DEAD: RazorSync has no API, and other invoicing apps gate
  spreadsheet import behind top-tier pricing. So uploading data to the workbook produced nothing usable.
- RETIRE (remove LAST, after invoices replace them - see sequence): `sync_to_lookup.py`,
  `preflight_qa.py`, `rebuild_invoice_import_sheet.py`, and the IPC handlers `sync-workbook`
  (`main.js:380`), `preflight-check` (`main.js:431`), `choose-workbook` (`main.js:468`), plus
  `resolveWorkbookPath` (`main.js:365`) and the Settings UI that drives them (grep "RazorSync"/"Workbook").
- Scraper: OUT OF SCOPE here. `scraper.js` is parked pending a separate redesign. Do NOT touch it.

### Service-item library = fully in-app, generic source of truth, exportable
- ONE generic library (source of truth). NO sorting by PM. Item shape: { name, desc, price, taxable }.
- Store in `userData/service-items.json` (same dir as `wo-data.json`, `main.js:27`).
- Library page has TABS, but tabs are SOURCE-SCOPED, not PM agreements:
  - **General** tab: seeded ONCE from `RazorSync_Invoice_Tracker.xlsx` "Service Items" sheet.
    VERIFIED columns: A=Item Name, B=Description, C=Price, D=Taxable(Yes/No), E=PM. DROP col E (PM).
    Keep Taxable. (Sentinel rows 'Materials!'/'Labor!' present - decide keep or skip.)
  - **AMH** tab: seeded from a SEPARATE file (below).
- In-app add / edit / delete. Dropdown/autocomplete entry on invoice lines (name -> auto-fill price; manual override allowed).
- Export = round-trip `.xlsx` named `Service Library.xlsx`, one sheet per tab, re-importable.

### AMH seed source (VERIFIED)
- File: `C:\Users\<user>\OneDrive\Desktop\excel\MSR Excel\AMH Premier Pricing All scopes.xlsx`.
- Import ONLY these 3 tabs (ignore all others): `Plum Minor`, `Plum Major`, `HVAC`.
- Per-tab layout: row 1 = instructions blob (skip), row 2 = header row (skip), data from row 3.
  Col A = item name/description. Col D = price ("Premier Pricing"). Cols B/C = Material/Labor cost (ignore).
  SECTION-HEADER rows (e.g. 'Clogs:', 'Faucets and Fixtures:') have empty B/C/D - SKIP them.
- AMH note: prices are "inclusive of LABOR, MATERIAL, TAX AND HAUL-AWAY" -> tax-inclusive.
  Seed AMH items as taxable=false (do NOT re-add tax). Confirm in slice 2.

### Tax model (apply on invoice line entry, slice 2)
- Tax rate constant: 1.0725 (7.25%). Define once, named.
- Taxable flag comes from the library item's `taxable` field (from the Taxable column).
- MSR is NOT a library tab. MSR is a PER-INVOICE CALC: if the WO's PM = MSR, when adding a
  taxable line item, divide its price by 1.0725 to get the pre-tax amount (MSR library/quoted
  prices are tax-inclusive). Non-MSR WOs: use price as-is.
- Invoice shows line items, taxable subtotal, tax, grand total.
- LIVE-VERIFY on first MSR invoice: price/1.0725 then +7.25% reproduces the quoted price.

### xlsx engine (DECIDED)
- Use **exceljs** (npm). Pure-JS read+write in MAIN process. Removes the Python dependency.
  Used for BOTH seed-read (workbook + AMH file) and export-write (Service Library.xlsx).

### Invoice record (stored on the WO order object in wo-data.json)
- Fields: Invoice # , Date, plus line items, plus computed totals/tax (above). Customer/address/PM
  come from the WO itself (don't duplicate). Memo mirrors old layout if useful (`sync_to_lookup.py:18-25`: 'WO #######' / 'WO ####### | NCXXXX').
- Each line item: { name, desc, qty, unitPrice, category: 'labor'|'material', agreement }.

### Module launcher
- Header icon (style TBD with user - NOT necessarily a waffle) -> FULL-SCREEN OVERLAY module picker.
- Modules: Work Orders, Invoices, Service Items. Leave room for future modules.
- PORT the existing view-switch mechanism, do NOT invent routing: `currentView` state lives at
  `index.html:4334` (`React.useState('active')`). Find `VIEW_BUILDERS` and the sidebar view
  selection to see how views are resolved/rendered, and add the new top-level modules alongside.

## Verified investigation (read/confirm before coding)
- Data load/save: `main.js:33` (`loadStore`/read), `main.js:62` (write `wo-data.json`), path `main.js:27`.
- Renderer persistence pattern to PORT for new state: `window.storage.set('wo_data', JSON.stringify(next))`
  (e.g. `index.html:983-984`, and the preset handlers around `:1054-1087`). New library state should
  use the SAME envelope/persist mechanism (either extend the wo_data envelope or add a sibling
  storage key + IPC; decide and state the reason).
- File-dialog IPC to reuse for export: `choose-workbook` (`main.js:468`) uses `dialog.showOpenDialog`;
  mirror with `showSaveDialog` for the `.xlsx` export. CSV export precedent: `export-csv` (`main.js:483`).
- xlsx writing: today done in Python via openpyxl. DECIDE: keep a tiny Python writer for the round-trip
  export, OR add a JS xlsx lib. Prefer the lowest-new-dependency path; state the reason. (Goal is to
  remove the Python runtime dependency, so a JS-side writer is preferred if a vetted lib is acceptable.)

## Open questions to settle live (do not assume)
- Launcher icon glyph/placement.
- Whether the AMH new pricesheet is a fresh seed file or an edit of the existing Service Items sheet.
- Export library writer: JS lib vs retained minimal Python. (Leans JS to kill the Python dep.)
- One-time seed source: confirm the path to the current workbook to read Service Items from on first run.

## Suggested build sequence (each a separate commit)
1. Service-item library: one-time importer (workbook "Service Items" -> `service-items.json`),
   in-app library page with per-agreement TABS (MSR/AMH/default), add/edit/delete, and round-trip
   `.xlsx` export ("Service Library.xlsx"). No invoice yet.
2. Invoice editor on a WO: line items via library dropdown (agreement = WO's PM), labor/material
   category per line, tax model + totals. Persist on the WO record. Live-verify the MSR 1.0725 rule.
3. Module launcher: header icon -> full-screen overlay switching Work Orders / Invoices / Service Items.
4. Remove dead code LAST: Python scripts + workbook IPC + Settings workbook UI, once invoices fully replace them.

## Footer
Commit each slice separately. Do NOT push. Do NOT publish. Verify JSX by reading; user reloads (Ctrl+R) to test.
Scraper redesign is a SEPARATE handoff - do not touch `scraper.js` here.
