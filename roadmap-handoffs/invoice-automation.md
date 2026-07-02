# INVOICE AUTOMATION - line-item accuracy + remittance import + reconciliation

Blueprint for folding invoice data-gathering into the tracker. Supersedes the old
external scraper-to-spreadsheet handoff for the invoicing side. Do NOT push. Do NOT
publish. Commit in the slices at the end.

Repo: `C:\dev\Work-Order-Tracker`. Branch: `main`. Electron + esbuild-bundled
renderer from `src/` (`npm run build:renderer`). Done-gate: `npm run verify`
(build + tests) must pass before any "fixed" claim (CLAUDE.md 4a).

## Goal (user's words, distilled)
Gather invoice data from multiple sources into ONE invoice record per WO, then
reconcile the recorded total against what AMH actually paid. Flag mismatches for
review (I may have miscalculated and owe a PM a call, or must fix the entry).

## The one funnel (do NOT invent a parallel system)
[InvoiceEditor](../src/invoices.jsx:362) already reads ONE field, `order.bidItems`
(shape below), matches each to the service library, and writes `order.invoice =
{ number, date, lineItems }`. Totals via [computeInvoiceTotals](../src/invoices.jsx:27).
Every source normalizes INTO `bidItems`. Every total flows THROUGH computeInvoiceTotals.

```
SOURCE                        EXTRACTOR                NORMALIZED         SINK
AMH online (active WOs)     -> scrape_amh.py         ┐
Bid/pricing spreadsheet     -> exceljs reader (new)  ┼-> order.bidItems -> InvoiceEditor
Manual entry                -> InvoiceEditor         ┘                      (invoice.lineItems)
Remittance PDF (settlement) -> pdf-parse (new) ------> invoice #/date/paid + reconcile
```

Remittance is NOT a line-item source. It is settlement + reconciliation ON TOP.

## AS-BUILT 2026-07-02: MSR bid-sheet line-item capture (the spreadsheet source)
MSR line items live in the bid xlsx OTHER section, NOT order.bidItems (=AMH API), so
MSR invoices auto-filled blank. KEY structure (verified across ~10 real bids): each
OTHER row's Item Description cell PACKS several sub-items, newline-separated, each
"$<amount> <description>" (e.g. "$85 Service Call\n$145 Labor to clean coil"). And
bids are DELTAS -> line items are spread across every bid/CO sheet in the WO. Built:
- main.js `parseOtherCell(text)`: split newlines, regex `^\$?\s*([\d,.]+)\s+(.+)$`
  -> [{desc, unitPrice}]. The $amount is the price (the Total Price column formula
  excludes the HVAC service call, so parse amounts, don't read that column).
- `readSheetOtherItems(file, sheet)`: OTHER header + "Item Description" column by
  label (Plumbing +1 col vs HVAC), flatMap parseOtherCell over the rows.
- `allBidCoSheets(root)`: recursive list of every bid/CO xlsx in the WO tree.
- IPC `read-bid-lineitems`: read OTHER items from ALL sheets, dedup exact
  (desc+price). preload `woFolder.readBidLineItems`.
- InvoiceEditor: on open of an un-invoiced NON-AMH WO with empty bidItems, async
  read + pre-fill ONE LINE PER SUB-ITEM, routed through bidItemsToInvoiceLines so
  material vs labor is inferred from the desc (materials non-taxable, labor/service
  taxable) and any service-library match applies.
- Validated in node vs real WO 03307717 tree: 9 distinct line items across 5 sheets.
SERVICE CALL (corrected): it IS a legit billed line (dedicated qty-1 cell on the
sheet; also listed in the OTHER text, which is what we parse). The HVAC vs Plumbing
difference is ONLY whether the service call feeds the sheet's internal LABOR-HOURS
formula (Plumbing yes, HVAC no) -- it does NOT change that the service call is
billed. So capturing it as a line is correct; no total discrepancy. (Earlier
"HVAC over by service call" caveat was a misread of the OTHER-only total cell.)
KNOWN GAPS (the "mapping" still deferred, flagged to user):
- Near-duplicate items (case/space diffs e.g. "0.5 lbs" vs "0.5lbs") not deduped.
- Library mapping (parsed item -> service-library item) still TODO. AMH remedy->
  service-item mapping also TODO.
Runtime needs an Electron RESTART (main.js + preload changed).

## VERIFIED data facts (read before coding; do not re-derive)
- Data file: `%APPDATA%\work-order-tracker\wo-data.json`, key `wo_data` is a
  JSON string; parse it to get `{ orders, pms, ... }`. Path const `main.js:27`.
- WO record has these already (REUSE, do not add new fields): `id`, `pm`, `type`,
  `address`, `city`, `propertyId` (e.g. `NC15880`), `bidAmount` (portal bid total,
  string), `bidItems`, `invoice`, `history`, `tab`. Confirmed on WO 9767507.
- `bidItems` canonical shape (BOTH scrapers, `scrape_amh.py:219`,
  `scrape_amh_bids.py:408`): `{ name, qty, price }`.
  **`name` holds the human description.** There is NO `desc` field.
  Example (WO 9767507): `{name:"Clear condensate drain line", qty:1, price:90}`.
- `invoice` record shape: `{ number, date, lineItems:[{name,desc,qty,unitPrice,
  category,taxable,agreement}] }`. `null` when not yet invoiced.
- Tax logic ALREADY CORRECT ([computeInvoiceTotals](../src/invoices.jsx:38)) -
  do NOT touch. `TAX_RATE = 1.0725`. RESOLVED MODEL (verified against a real MSR
  invoice paying $1,120.00):
  - A line's `unitPrice` = the SERVICE LIBRARY price AS STORED. For MSR that value
    is POST-tax (tax-inclusive, e.g. $85 / $275 / $75 - clean round numbers). For
    every other client (AMH non-premier, service calls, etc.) the library price is
    PRE-tax. "Do NOT store pre-tax items" - keep library values as-is; never convert
    at seed. The divide happens per-invoice, not at storage.
  - MSR + taxable: pre-tax entry = `unit / 1.0725`, THEN add tax on top -> nets the
    face value. Non-MSR + taxable: `unit` is pre-tax, add tax on top (no divide).
    Non-taxable (AMH premier, materials): `unit` as-is, no tax line.
  - Worked example (the screenshot WO): MSR library {85,275,75} taxable -> divide to
    {79.25,256.41,69.93} = taxable subtotal 405.59 -> +7.25% = 29.41 -> taxable 435 +
    non-taxable 685 = 1120.00 = amount paid. CORRECT.
  - COMMON MISTAKE (do not repeat): do NOT feed the DISPLAYED pre-tax values
    (79.25...) back into computeInvoiceTotals - it divides again and understates by
    the tax (yields 1090.59). Input is always the library value.
  - UNIVERSAL (non-blocking future): the divide is gated on hardcoded `pm==='MSR'`.
    Generalize later to a per-client setting `pricesTaxInclusive` (MSR = the only
    true case today) so the app is not AMH/MSR-specific. Behavior unchanged now.

## ============ BUILD A: line-item accuracy (descriptions bug) ============
### Root cause (CONFIRMED, not a guess)
[InvoiceEditor autofill](../src/invoices.jsx:391-428) reads `b.desc` for BOTH the
catalog match and the line description. Scraped `bidItems` have no `desc`; the
description is in `b.name`. So `bidDesc` is always `''`, catalog never matches, and
every line falls back to `name:'Labor!'` + empty desc, keeping only `b.price`.
Result: "prices but no descriptions" (user's WO 9767507 report). The autofill was
written against the OLD parked `scraper.js` shape (`{name:remedy, desc:description}`)
and never updated to the live scraper shape (`{name:description}`).

### Fix (surgical, in InvoiceEditor autofill only)
Treat `b.name` as the description source:
- Catalog match on `b.name` (case-insensitive vs library item `name` OR `desc`).
- On hit: `line.name = hit.name`, `line.desc = b.name`, price/taxable from library.
- On miss: `line.desc = b.name` (so the real description shows), price = `b.price`,
  name = sentinel (`Labor!`/`Materials!`) chosen by a `Material`/`Labor` keyword in
  `b.name` if cheap to infer, else default `Labor!`.
- Fix the stale comment at `invoices.jsx:388-390`.

### Class-not-example check (memory: fix the class)
Grep every reader of `bidItems`/`b.desc` and every writer of the shape before
editing: `scrape_amh.py`, `scrape_amh_bids.py`, `src/data.js` (merge at :365/:438),
`src/invoices.jsx`, `src/detail.jsx`, `src/app.jsx`. Canonical shape stays
`{name, qty, price}`; only the CONSUMER (InvoiceEditor) is wrong. Do not "fix" by
adding a `desc` to the scrapers unless a reader needs remedy+desc split (it does not).

### Verify
Add a logic test in `test/` importing the shipped normalization: given the 9767507
bidItems, assert produced lines have non-empty `desc` and correct `unitPrice`.
Then live-check WO 9767507 in the app: open its invoice, every line has a description.

## ============ BUILD B: remittance PDF import + reconciliation ============
### Sample (verified with pypdf against `ACHVendor_v0037747_0_5 (3).pdf`)
ACH payment remittance from American Homes 4 Rent. Header: vendor block, pay date,
`EFT No: <n>`, grand `Total: $<n>`. Then rows:
```
06/18/2026 W9759794B0065953 $100.44
06/22/2026 W9746663-1B0062543 $107.26
```
Token = `W<woNumber>B<invoiceNumber>`. Per-row parse:
`^(\d{2}/\d{2}/\d{4})\s+W(.+?)B(\d+)\s+\$([\d,]+\.\d{2})$`
-> `{ date, woNumber(group2, KEEP suffix e.g. 9746663-1), invoiceNumber(group3),
   amount(paid) }`. Sum(rows.amount) must equal header Total (checksum).
NO line items in this document.

### WO match rule (user decision)
Exact, INCLUDING suffix: `9746663-1` != `9746663`. Match `woNumber` against WO
`id` (strip leading `WO-`). Confirm during build how suffixed ids are stored.

### PDF extractor decision (stated reason)
Use JS `pdf-parse` in the MAIN process (IPC + preload), NOT a Python subprocess.
Reason: invoicing-rework deliberately moved to pure-JS (exceljs) to shed the Python
runtime; remittance parse is trivial text+regex; the packaged embeddable Python does
not ship pypdf. `pdf-parse` keeps the bundle unchanged. (Python subprocess mechanism
exists at `amh-runner.js` if a future doc needs OCR; not needed here.)
`parseRemittance(path)` -> `{ vendor, payDate, eft, total, rows[] }`. Pure, tested
against the sample fixture in `test/`.

### What the importer WRITES per matched WO (user spec)
Onto `order.invoice` (reuse existing record; add ONLY `paid`):
- `invoice.number` = remittance `invoiceNumber` (the B-number).
- `invoice.date`   = remittance `date`.
- `invoice.paid`   = remittance `amount` (NEW field - the actual paid amount;
  distinct from computed grandTotal. Grep confirmed no existing paid field).
- Street Address + Property ID for the listing/memo come from the WO
  (`order.address`, `order.propertyId`) - do NOT store copies on the invoice.
- Memo string (derived, for QuickBooks paste): PROPOSE
  `WO <id> | <invoiceNumber> | <propertyId> | <address>`  (CONFIRM order/format).

### Reconciliation (user spec)
Three totals:
1. `paid` - remittance amount (source of truth for what hit the bank).
2. `computed` = `computeInvoiceTotals(invoice, pm).grandTotal` (from line items).
3. `bidAmount` - portal bid total (secondary reference; note it can differ from
   the bidItems sum, e.g. 9767507 bidAmount 738.72 vs items sum 705).
Rule: if `abs(computed - paid) > TOLERANCE`, FLAG for review but STILL populate
(never skip). `TOLERANCE = 0.05` (user: 499.99 vs 500.00 is fine; a few cents OK).
When invoice has no line items yet, computed = 0 -> flagged as "awaiting lines".

### Reconcile UI
- Import modal: pick PDF -> table of rows (WO found/not-found, existing invoice#,
  paid, computed, delta, flag). Apply writes the fields above.
- [InvoicesModule](../src/invoices.jsx:627) row: show paid vs computed; red badge
  when `|delta| > TOLERANCE`.

## Sequencing
Build A first (descriptions bug) so B's reconcile has a real computed total to
check. A is small and independently shippable. Then B slices.

## Slices (each a separate commit; verify per slice)
A1. Fix InvoiceEditor autofill to use `b.name` as description + catalog key;
    fix comment; add logic test; live-verify WO 9767507.
B1. `pdf-parse` dep + main-process `parseRemittance` + IPC + preload; fixture test.
B2. Import modal (pick PDF, matched-row table, apply) writing invoice #/date/paid.
B3. Reconciliation flag in InvoicesModule + memo string.
(Spreadsheet line-item source = SEPARATE later slice; funnels into bidItems too.)

## Open questions (settle before the affected slice)
- Memo exact format/field order (proposed above).
- `pdf-parse` vs `pdfjs-dist` - confirm `pdf-parse` handles this text-layer PDF
  cleanly (test in B1 before building the UI).
- Where the importer is launched from (Invoices module header button? Settings?).
- Multi-WO remittance: one PDF pays many WOs (14 in the sample) - import is batch.

## Footer
Read files before writing (CLAUDE.md). No emojis/em-dashes. Surgical edits. Grep
for an existing field before adding one (only `invoice.paid` is justified new).
`npm run verify` green before "done". Commit per slice; do NOT push; do NOT publish.
