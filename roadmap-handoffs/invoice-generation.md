# Invoice / Remittance Report Generation — Implementation Handoff

Date: 2026-07-08
Goal: fold the external remittance parsers (Python + scratch scripts) INTO the app so
the user can drop the two PM remittance PDFs (AMH + MSR) and get a clean, 100%-accurate,
readable per-WO report of service items + prices + tax + computed-vs-paid total, for
manual entry into RazorSync. Replaces the fragile external handoff (memory pref: prefer
in-app over external). RazorSync itself stays manual entry (their portal, no API access).

Proven end-to-end this session against 2 real AMH + 2 real MSR remittances — the logic
below is validated, not theoretical. Reference implementations live in the session
scratchpad (msr_reconcile.js) and the user's external parser (see Reuse inventory).

## What a remittance actually contains (the hard-won facts)

- **AMH** (`ACHVendor_*.pdf`): rows of `Invoice Date | Invoice Number | Amount`. Invoice
  number = `W<woNumber>B<bidNumber>` (e.g. `W9759794B0065953` -> WO 9759794, bid 0065953);
  a `-N` suffix (`W9746663-1B...`) is a revisit/2nd invoice. **No line items** — only the
  paid total per WO. Header carries EFT No + remittance date + payment total.
- **MSR** (`Vendor_ACH_Payment_Detail_*.pdf`): per-property block with amount + `Invoice#`
  (PI…) + **`Invoice Notes : <number>`**. The Invoice Notes number = the app WO id (the
  reliable join key; the PI number is the RazorSync-side invoice #). Address is present but
  MESSY (wraps across lines) — do not rely on it as a key. **No line items** — only the
  paid total per WO.

So "service items" are NEVER in the remittance. They come from:
- **AMH -> the AMH portal API** (per WO's approved bid options).
- **MSR -> the bid/CO xlsx sheets on disk** under the property folder.

## AMH pipeline (source: the portal API)

Mechanism (proven by the user's `amh_remittance_scraper.py`):
1. Parse the AMH PDF: regex `(\d{2}/\d{2}/\d{4})\s+(W\d+(?:-\d+)?B\d+)\s+\$?([\d,]+\.\d{2})`;
   WO = digits between `W` and `B`.
2. AMH login + Bearer-token capture -> `GET services-api/api/Order/Query?today=<iso>&loadFiles=false`.
   THE APP ALREADY DOES THIS (scrape_amh.py / amh-runner.js). Extend that path to return
   the full order/bid/option/service tree (or add a remittance mode), instead of re-login.
3. Per WO: pick the bid matching the invoice number (approved > exact-invoice > approved-any),
   take its approved (else preferred) option, iterate `services[]`. Each service:
   - name = `remedyInstance.name` (fallback serviceId); description = `remedyInstance.description`
     (fallback name); `unitPrice`; `vendorTax`. The remittance pays the INCLUSIVE amount, so the
     reconcile LINE AMOUNT = qty*unitPrice + vendorTax (this is the figure that sums to the paid
     total). `vendorTax` is used ONLY to reach that inclusive amount.
   - TAX FLAG — **Core Truth #2 GOVERNS** over any earlier "vendorTax authoritative / labor taxed"
     wording (that was the reverted mistake): AMH Premier lines are tax-INCLUSIVE, so present them
     as `taxable:false` at the inclusive amount; do NOT add tax again in-app. EXCEPTION: service
     call / diagnostic / emergency -> `taxable:true` (Core Truth #3). Materials have vendorTax 0.
4. Reconcile: sum(inclusive line amounts) vs remittance amount (match to the penny when WO found).

**HARD LIMITATION (confirmed, not a bug):** `Order/Query` returns only the **100 most-recent**
orders and IGNORES every paging/filter param (take/pageSize/skip/status/includeCompleted all
ignored); no per-WO endpoint (Order/{id}=400, /Query/{id}=404). Old paid WOs age out -> "NOT
FOUND". On the last two batches: 2/13 and 4/6 retrievable. User has contacted AMH for a
history/completed feed; until then, aged-out WOs can only be reported as WO#/address/invoice#/
paid-amount (no items). Design the UI to show these as "unavailable — needs AMH history access",
not as an error.

## MSR pipeline (source: bid sheets on disk) — ALREADY MOSTLY IN-APP

1. Parse the MSR PDF: `Invoice Notes\s*:\s*(\d+)` (=WO id), `Total For \S+\s+([\d,]+\.\d{2})`
   (=amount), `(PI\d+)` (=invoice #), in block order (counts align 1:1). Address extraction is
   fragile — prefer the folder's own address once matched by WO id.
2. Locate the WO folder: **WO id first** (a `WO <id>` folder anywhere under
   `WORK ORDERS/aMain Street Renewal`). resolveWoFolder (main.js) handles the NEW structure.
   Old/pre-system WOs have NO `WO <id>` subfolder (bid sits directly in the address folder)
   and folder NAMES have typos (e.g. remittance "412 Sarazen Dr" vs folder "Sarazen Dr 512").
   -> WO-id match is the only reliable key; address fallback must be FLAGGED "verify".
3. Read the bid + all CO sheets (allBidCoSheets, recursive; dedup exact desc+price across COs)
   via **readSheetOtherItems (main.js) — JUST FIXED 2026-07-08** to read BOTH:
   - the MAIN fixed-catalog table (rows with Quantity>0, priced by Line Item Price = Qty x
     Total Price) — big-ticket selected items live here (e.g. "50 Gallon Water Heater - Gas"
     $1123). Columns found by HEADER LABEL (HVAC vs Plumbing differ). EXCLUDES the HVAC
     service call/diagnostic (left out of the HVAC total + re-entered in OTHER -> would double).
   - the OTHER section (packed "$amount desc" custom lines; parseOtherCell now splits multi-$
     lines like "$20 Labor/$20Material").
   Prior behavior (OTHER only) UNDER-COUNTED any sheet with a selected catalog item — this was
   the Kilburn $1358 vs $235 bug.
4. Reconcile: sum(items) vs remittance amount; cross-check against the sheet's own
   `BID TOTAL COST`. Tax: MSR prices are tax-INCLUSIVE, so computed total = paid, no separate
   tax line needed (or show the isMSR divide-out per computeInvoiceTotals).
5. Edge cases seen (need per-WO handling / user prompt, NOT silent guessing):
   - **service-call-only**: paid $85, no bid sheet (a correction — tech forgot the service call
     on the bid). Report a single "Service Call $85" line.
   - **multi-visit address folder**: one address folder holds >1 visit's bids with no WO-id
     split -> ambiguous; flag for the user.
   - **paid > sheet**: the saved bid doesn't reflect what was paid -> flag "bid on file
     incomplete" (was a red herring last batch — the real cause was the main-table read bug,
     now fixed; but keep the flag for genuine cases).

## Output / report format (user-specified)

Per WO, one readable block (NOT necessarily a spreadsheet; readability > format):
Address · WO# · Property ID (AMH only) · Invoice # (as on the remittance) · then each service
item on its OWN line (newlined) with its DESCRIPTION (fall back to name if no description) +
price + tax-per-PM-rules, then the **computed total** with a MATCH / OFF-by-$X flag vs the
remittance amount. User is the FINAL ARBITRATOR on the computed total — every line + total must
be editable. See the two delivered reports in the 2026-07-08 session for the exact target shape.

## Reuse inventory (rule B3 — wrap/port, don't rebuild)

- `amh_remittance_scraper.py` (`~/OneDrive/Desktop/AI_Daily_Report/Invoice Parser/`) — the
  PROVEN AMH pipeline (PDF parse + API match + itemize + vendorTax + xlsx). Either wrap as a
  subprocess (read its `*_Debug.json`) OR port its match/itemize functions and drive them off
  the app's existing token capture.
- `scrape_amh.py` + `amh-runner.js` — the app's AMH login + Order/Query token capture. Extend
  to expose the full order tree for remittance itemizing (avoid a 2nd login).
- `main.js`: `readSheetOtherItems` / `parseOtherCell` (MSR items, FIXED), `resolveWoFolder`,
  `allBidCoSheets`, `latestBidOrCoSheet`, `read-bid-lineitems` IPC.
- `orders-logic.js`: `computeInvoiceTotals`, `catalogTax`, `bidItemsToInvoiceLines`,
  `resolveBidLine` (matcher), `invoiceHasServiceCall`.
- `invoices.jsx`: `InvoiceEditor`, `blankLine`, `FlagResolveModal`, tax model — the invoice
  data model + editing UI to reuse for storing/displaying the reconciled lines.
- Session scratchpad `msr_reconcile.js` — reference MSR implementation (PDF rows -> folder ->
  main+OTHER read -> reconcile -> newlined report), including address-fallback + service-call
  handling. `msr_rows.json` shows the parsed-row shape.
- A python PDF-text step (pdfplumber) parsed both remittances cleanly; for in-app, either a
  node PDF lib (pdf-parse) in main, or a small python helper (the app already ships python).

## Suggested architecture + slices

New "Remittances" (or "Invoicing") module. Main-process does PDF parse + AMH API + sheet read;
renderer shows the reconciled report + edit + export. Key DECISION for the fresh session:
**wrap the external AMH parser as a subprocess vs fold into scrape_amh.py.** Recommend folding
(one login, one Python surface) but wrapping is faster to ship. Discuss first.

- **Slice 1 — MSR end-to-end. DONE 2026-07-08 (uncommitted).** Shipped: `parse_msr_remittance.py`
  (pdfplumber; validated vs real Vendor_ACH_Payment_Detail = 6 rows/stmt 1851.25), `remittance-runner.js`
  (spawn: JSON path stdin -> JSON out), main IPC `parse-msr-remittance`, preload `window.remittance.parseMsr`,
  pure `normWoNum`/`normAddress`/`matchMsrRow`/`reconcileMsrRow` (orders-logic.js, tested reconcile-msr.test.js),
  `src/remittances.jsx` module (nav id `remittances`, read-only report + statement cross-check). Match key =
  Invoice Notes number == `order.woId`. NOT live-GUI-run yet.
- **Slice 2 — AMH end-to-end. ACTIVE (next).** DECIDED: FOLD into scrape_amh.py (one login), PDF parse in
  PYTHON. MIRROR Slice 1: (a) `parse_amh_remittance.py` — parse ACHVendor_*.pdf rows
  (`(\d{2}/\d{2}/\d{4})\s+(W\d+(?:-\d+)?B\d+)\s+\$?([\d,]+\.\d{2})`; WO=digits between W and B; keep the
  `-N` revisit suffix; validate vs the real ACHVendor PDFs in ~/OneDrive/Desktop/AI_Daily_Report/Invoice Parser/
  + ~/Downloads); reuse remittance-runner (add an `amh` mode or a second spawn fn). (b) pure `matchAmhRow`
  (row.woId digits vs order.woId/id) + `reconcileAmhRow` (itemize -> INCLUSIVE line amounts per the tax note
  above -> reconcile) in orders-logic.js + tests. (c) itemize source = the AMH portal API: extend scrape_amh.py
  to emit the full order/bid/option/service tree (port match/itemize from the proven external
  amh_remittance_scraper.py) — THIS PART needs a live AMH login to verify, so it is the live-gated remainder;
  the PDF parse + pure reconcile are testable offline first. (d) surface the 100-window "aged out" state as
  "unavailable — needs AMH history access" (Core: Order/Query = 100 most-recent only). Wire into RemittancesModule.
- **Slice 3 — persistence + stamping.** Write matched invoice #s (W…B… / PI…) onto the WO
  records (the user asked for this), and optionally populate `order.invoice.lineItems` so the
  reconciled invoice lives in the app + shows in InvoiceEditor.
- **Slice 4 — export + arbitration UI.** Editable lines/totals (user is final arbitrator),
  export to md/xlsx/print, MATCH/OFF flags, verify-badges on address-matched + ambiguous WOs.

- **Slice 5 — Recompute / Refresh invoices (user request 2026-07-08).** A saved
  `order.invoice.lineItems` freezes its taxable/name/match at autofill time; re-seeding the
  library or fixing the tax rules does NOT retroactively update saved invoices. Slice 5 adds a
  RECOMPUTE that re-runs the derive pipeline against the CURRENT library + bidItems/sheet and
  reports/repairs drift. Four checks (all reuse existing code):
  1. **Service-item accuracy** — re-run `resolveBidLine` per bid line; a sentinel that now matches
     a library item (e.g. after a re-seed) upgrades to the confirmed item.
  2. **Service-item NAME accuracy** — snap a confirmed line's `name`/`desc` to the library canonical
     (fix drift/typos) while keeping the bid price.
  3. **Taxable check** — re-derive `taxable` per the current core truths (prose/sentinel/service-call).
  4. **Total-price validation** — `computeInvoiceTotals(lines)` vs the authoritative total (MSR: the
     sheet `BID TOTAL COST` / remittance paid; AMH: the bid/remittance). Flag OFF > $0.005.
  - Single-WO action in InvoiceEditor + a BULK "Refresh all invoices" in the Invoices module (the
    latter deferred until Slices 2-4 land, per user). Bulk AMH recompute needs Slice 2 (fresh API
    bidItems); MSR recompute works off the on-disk sheet today.
  - PURE core: `recomputeInvoice(savedInvoice, bidItems/sheetItems, library, agreement) ->
    { lines, changes:[{field, from, to, lineIdx}], totalDelta }` in orders-logic.js (testable).
  - DECISIONS (user, 2026-07-08): (a) APPLY MODE = **auto-apply safe upgrades** (sentinel->confirmed,
    taxable correction, name/desc snap to library canonical) + **FLAG risky ones** (price/total
    mismatch, OFF > $0.005) for review — do not silently rewrite the money. (b) MANUAL-EDIT PROTECTION
    = **per-line `edited:true` marker**, set on any manual field change in `InvoiceEditor.setLine`;
    recompute SKIPS edited lines and only refreshes untouched autofilled ones. `edited` is a NEW
    per-line field (none exists today) — set it in setLine, persist it through save, honor it in
    recomputeInvoice. Reuse it as the same concept as the library `manual:true` flag (curated = keep).

## Open questions for the fresh session

1. DECIDED: FOLD the AMH parser into `scrape_amh.py` (one login, single Python surface).
2. Store reconciled lines on the WO (`order.invoice.lineItems`) or keep the report standalone? (Slice 3)
3. AMH old-WO source — pending AMH's reply on a completed/history feed; design for "unavailable"
   in the meantime.
4. Report output: on-screen only, or also export (md/xlsx/pdf) + stamp invoice #s onto WOs? (Slice 3/4)
5. DECIDED: in-app PDF parsing = PYTHON helper (pdfplumber; already shipped + proven in Slice 1).

## Tax CORE TRUTHS (2026-07-08, user-confirmed -- do NOT re-derive or renege)

These are authoritative. An earlier pass wrongly flipped AMH labor to taxable; that was reverted.

1. **MSR prices are DIVIDE-OUTS.** `CATALOG_TAX.MSR.taxableInclusive = true`. Tax is NEVER added on
   top for MSR. A taxable MSR line divides the embedded 7.25% back out; a non-taxable MSR line is
   face. EITHER WAY the MSR grand total = face = paid (the flag is total-invariant under divide-out).
   So the MSR `taxable` flag is about correct REPORTING, not matching the total.
2. **AMH Premier-listed items are NEVER taxed** -- their price is labor + material + tax INCLUSIVE.
   `AMH!` is the sentinel/category for exactly this: AMH-priced, non-taxable, face. So
   `CATALOG_TAX.AMH.defaultLaborTaxable = false`.
3. **Service Call / Diagnostic Fee / Emergency are ALWAYS taxed** (both PMs). The user manually added
   these to the PM libraries as `taxable:true`. So a matched service-call/diagnostic/emergency line
   is taxable; an UNMATCHED one (sentinel) must be forced taxable too (override the PM default).
4. **MSR taxable comes from TWO sources, by whether the line matches the catalog:**
   a. MATCHED catalog item -> its library `taxable`, which parseMsr read from the Col C scope prose
      ("Item Description"): prose states the price INCLUDES tax (e.g. "...standard installation
      materials, applicable taxes, permit costs...") -> `false` (the big installs C39-C82); prose
      does NOT mention tax (Clean Drain C22, Diagnostic C17) -> `true`; material (refrigerant
      R22/R410a) -> `false`.
   b. UNMATCHED custom OTHER line (free-text, no catalog match) -> default by KIND
      (isMaterialWording): a line LEADING with "Material"/"Materials" -> `Materials!` `false`
      (whatever follows); a line leading "Labor" -> labor; else action-verb = labor, no verb =
      material. LABOR/service -> `taxable:true` (`CATALOG_TAX.MSR.defaultLaborTaxable = true`).
   Divide-out (#1) makes this total-invariant -- it only fixes the reported tax split.
   ACCEPTED TRADEOFF (user): a single OTHER cell COMBINING labor + material under a "Material ..."
   description is taxed wholly as material (the bundled labor loses its tax). Rare; fixed at
   invoicing. The leading-"Material" rule's forward benefit outweighs it. `taxable` is a code-level
   line field ONLY -- it drives the Tax column, NOT shown in the visible item name.
5. **Manually-added library items must NOT be overwritten by re-seeding.** Re-seed merges: keep the
   user's manual items, refresh only the sheet-sourced ones.
6. **Manual picker must allow cross-category fallback.** Auto-match already falls PM -> General
   (`resolveBidLine` gets the General catalog). The manual picker (datalist + `pickName`) must ALSO
   offer General items on an AMH/MSR WO. A General-picked line carries `agreement:'General'` so its
   tax follows General, not the PM. (Increases match accuracy.)

Implementation of the above:
- **constants.js**: `AMH.defaultLaborTaxable:false` (Premier inclusive). `MSR.defaultLaborTaxable:true`
  (custom labor is a taxable service; divide-out keeps the total). `MSR.taxableInclusive:true` unchanged.
- **orders-logic.js `resolveBidLine`**: sentinels `AMH!`/`MSR!`/`Labor!` by agreement; taxable =
  catalog default (AMH false; MSR/General true), BUT service-call/diagnostic/emergency wording forces
  `taxable:true` (truth #3). Material wording -> `Materials!` `taxable:false`. `isMaterialWording`
  treats a leading "Labor" as labor, "Material -/:" as material.
- **library_io.js `parseMsr`**: set each item's `taxable` from its Col C prose (truth #4) and carry
  the prose as `desc`; material (refrigerant) names -> false.
- **app.jsx `useLibraryTools`**: re-seed MERGES (keep `manual:true` items) instead of `replaceTab`.
  `AddServiceItemModal` tags added items `manual:true`.
- **invoices.jsx**: datalist + `catalogByName` include General for AMH/MSR WOs; `pickName` sets the
  line's `agreement` from the source catalog of the picked item (General item -> `'General'`).

## Status of the fix that motivated this doc

`main.js readSheetOtherItems`/`parseOtherCell` now read main-table catalog items + multi-$
packed OTHER lines. `npm run verify` green (7 suites). Validated against Kilburn (WO 03565359,
$1358, water heater in main table) and Gusty (WO 03437879, $280, de-duped service call). The
in-app MSR autofill (InvoiceEditor) now benefits from the same fix.
