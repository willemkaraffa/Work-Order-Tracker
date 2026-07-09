# Remittance / invoicing enhancements — 2026-07-09

Source of truth for this batch (user request). Procedure: spec -> implement -> `npm run verify`.

## R1 — Property ID on remittance blocks (needed for invoicing)
AMH remittance PDF has NO property ID; it comes from the matched order (`order.propertyId`,
set by the scraper). `reconcileAmhRow` and `reconcileMsrRow` now carry `propertyId =
match.order.propertyId` (MSR falls back to `row.propCode`). ReportBlock header shows it.

## R2 — Typography
WO#, Invoice#, Property ID: mid weight (600) + slightly larger, still below the Address
(700/15px). Readable at a glance without competing with the address.

## R3 — Copy-on-click
WO#, Invoice#, Property ID render as click-to-copy spans (`navigator.clipboard.writeText`
+ toast "Copied"). Read-only report, no editing surface -> riskless. Cursor:pointer + title
"Click to copy". (Double-click-to-select still works as a fallback.)

## R4 — Export -> .xlsx in Downloads
Replace the markdown-to-clipboard export. New main IPC `export-remittance-xlsx(report)`:
exceljs (already a dep, used in main.js) writes a FLAT sheet to `app.getPath('downloads')`
named `[CLIENT]_[YYYY-MM-DD]_Invoice.xlsx` (CLIENT = AMH|MSR from report.source; DATE =
today). Columns: WO | Property ID | Invoice # | Address | Item | Description | Qty | Pre-tax
| Tax | Post-tax. One row per line item; a bold WO subtotal row (Paid / computed / status)
after each WO. Returns the written path; module toasts it. preload `window.remittance.exportXlsx`.
NOTE (memory lesson_xlsx_surgical_patch): that warns against exceljs re-serializing a COMPLEX
TEMPLATE; this is a BRAND-NEW simple workbook, so exceljs writeFile is fine.

## R5 — Auto-update the Invoice record for verified-accurate WOs
After `run()` builds blocks, AUTO-write invoice records for `status==='match'` blocks —
but ONLY onto WOs with NO existing saved invoice (fill-empty, silent/safe: never clobber a
hand-edited invoice on a re-parse). Skips off / unavailable / no-items / unmatched, and AMH
`taxFromBidAmount` (per-line tax missing -> Fetch first). Suspect LINES still carry their
`priceFlag`/`suspects` so the WO's editor shows the ▲ warning icon -> FlagResolveModal to
edit ("only suspicious entries flagged for review"). The explicit **Bill matched** button
keeps its fill+OVERWRITE behavior (user-initiated force-sync). Toast reports how many
auto-billed. Reuses `billInvoices` (add a fillEmptyOnly flag).
DECISION: auto = fill-empty-only (safe); button = overwrite. Rationale: "automatically
update" should populate records without silently discarding manual edits; overwrite stays
an explicit choice.

## R6 — Button tooltips
`title` on every remittance action: Fetch all AMH items, Bill matched ("Write the verified
line items onto each matched WO's invoice + stamp the invoice #"), Export, Save to WO,
Fetch AMH items.

## Verify
`npm run verify` (build + tests). Add/extend a pure test for the propertyId carry-through.
Live: user drops a remittance -> checks Property ID shows, copy-on-click, xlsx in Downloads,
matched WOs auto-appear in Invoices module, tooltips.
