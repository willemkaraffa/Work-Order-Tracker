# MSR Pricing Agreement Update — Handoff + Plan

Date: 2026-07-06
Source: `~/OneDrive/Desktop/excel/PM Bids Excel/Complete_with_Docusign_MSR_-_Maintenance_Bid.pdf`
Effective date (per doc): **July 2, 2026**. Signed by Gamble Plumbing 7/3/2026.
Status: WS1 + WS2 + WS3 DONE. WS4 RESOLVED (user decisions, see below). `npm run verify`
green (7 pass). Bid-sheet copies now default to 70% zoom (was 90%). TWO outstanding/deferred
tasks logged under WS4: (1) bid-submission confirmation phase-hook (only if MSR demands
in-bid equipment data), (2) auto service-call qty=1 on the FIRST bid sheet per WO. OPEN
QUESTION (awaiting MSR confirmation): the diagnostic/service-call fee may be payable ONLY
when it was the sole labor (Incurred-Costs rule) — if so, do NOT ubiquitously add the
service call to MSR invoices/bids; this gates Outstanding #2.
UPDATE 2026-07-07: MSR's live Excel bid sheet arrived. parseMsr now READS that sheet
(no more embedded array) — same file as the automation skeleton, one source of truth.
Sheet = 120 items (embedded had drifted to 98, missing tonnages). Col B = Item, col G =
Total Price. ALL items taxable:true (tax-inclusive divide-out; grand total = sheet face).
WS3 cell map re-verified + updated: HVAC addr C8->C9, date C9->C10 (header block moved down
one row); patch live-tested on a copy (C9/C10 materialized, values land, reparse clean).

DONE:
- library_io.js: embedded 98-item MSR HVAC price list + `parseMsr()`.
- main.js: IPC `library-seed-msr`. preload.js: `window.library.seedMsr`.
- app.jsx: `LIBRARY_TABS`/`emptyLibrary` add 'MSR'; `useLibraryTools.seedMsr`; "Seed MSR"
  button in Settings > Service Library.
- invoices.jsx:376: MSR WOs route to the 'MSR' catalog tab (autofill + agreement).
- Tax: per-item `taxable` set from each line's PDF description — 81 items whose scope says
  the price includes tax → taxable:false (used as-is); 17 with no tax wording (labor/
  diagnostic/cleaning + a few materials for user discretion) → taxable:true. Existing isMSR
  divide-out reproduces the face total for taxable lines. No tax-code change. NOTE: under the
  MSR master agreement all pricing is tax-inclusive, so grand total = sheet face for BOTH
  flags; the flag only toggles whether a 7.25% tax line is DISPLAYED (taxable) or not.
- RUNTIME STEP FOR USER: open Settings > Service Library > "Seed MSR" once to load the 98
  items (mirrors Seed General/AMH; replaces the MSR tab).

Original plan below (WS3/WS4 reference retained).

MSR (Main Street Renewal) issued a new fully-executed Maintenance Bid Sheet with fixed
line-item pricing. This plans folding it into the app + automation.

---

## Scope of THIS document

- The PDF is the **MSR HVAC bid sheet** only (title p2: "MSR HVAC BID SHEET"). There is
  **no plumbing sheet** in this file. MSR plumbing pricing, if/when issued as its own sheet,
  is a separate follow-up — this handoff does not cover it.
- Catalog = the **first table only** (pages 2-24, ending at the `TOTAL BID COST` row). The
  material-cost reference tables (pages 25-53: Manufacturer / 10% Tax / 20% Markup / Total
  Material Cost) are backup math, NOT catalog items — ignored per user direction.
- **98 line items** extracted. Runtime-authoritative source = `MSR_ITEMS` in
  `library_io.js` (edit there on a price revision). These handoff copies are a provenance
  snapshot / anti-drift reference only:
  - `roadmap-handoffs/msr-hvac-catalog.json` (`{name, desc:"", price, taxable}`)
  - `roadmap-handoffs/msr-hvac-catalog.csv` (name, price, taxable)

## Decisions locked

1. **Tax = existing MSR divide-out** (user choice). MSR sheet prices are fully-burdened /
   tax-INCLUSIVE (the doc: "all pricing is fully burdened and inclusive of material, tax,
   labor, warranty, permit(s), overhead, profit"). The app ALREADY models this:
   `computeInvoiceTotals` ([invoices.jsx:29](../src/invoices.jsx:29)) divides tax back out
   (`unit / 1.0725`) for `taxable` lines on MSR WOs, then re-adds it, so the invoice shows a
   broken-out 7.25% tax line while the grand total equals the sheet price. → **MSR catalog
   items carry `taxable: true`. NO tax-code change.** This is the "code already present"
   applied to the MSR category.
2. **New service-library category = `MSR`** (a third tab beside General / AMH).

---

## WS1 — MSR service-library category (READY, not blocked)

Current category system (all in [app.jsx:2814](../src/app.jsx:2814)):
```js
export const LIBRARY_TABS = ['General', 'AMH'];
export function emptyLibrary() { return { General: [], AMH: [] }; }
```
The library is a `service_library` storage object keyed by tab; the Service Items module,
AddServiceItemModal, and the invoice editor all iterate `LIBRARY_TABS`, so adding a tab
propagates everywhere automatically. Import already whitelists tabs to `LIBRARY_TABS`
([app.jsx:2869](../src/app.jsx:2869)), so a new tab is honored once listed.

Fix spec:
1. `LIBRARY_TABS = ['General', 'AMH', 'MSR'];` and `emptyLibrary()` → add `MSR: []`.
2. **Route MSR WOs to the MSR tab.** [invoices.jsx:376](../src/invoices.jsx:376) currently:
   ```js
   const tabName = String(pm).toUpperCase() === 'AMH' ? 'AMH' : 'General';
   ```
   Change to map `MSR` → `'MSR'` (AMH → 'AMH', else 'General'). This sets both the invoice
   editor's default catalog and the `agreement` stamped on each line — which the divide-out
   keys off (isMSR is by WO `pm`, not agreement, so totals already work; agreement drives
   autofill catalog + the taxable default on the miss path,
   [orders-logic.js:515](../src/orders-logic.js:515)).
3. **Seed the 98 MSR items.** Reuse the existing persist path
   (`useServiceLibraryStore` / `window.library`) — do NOT invent a new store. Load
   `msr-hvac-catalog.json` into the `MSR` key. Two options: (a) one-time programmatic seed
   guarded by a settings flag (like other seeds), or (b) hand the JSON to the user to import
   via the Service Items module's existing import. Recommend (a) for a clean first ship.
4. Item shape is `{name, desc, price, taxable}` — matches the catalog JSON exactly. `desc`
   intentionally empty (user: descriptions too long; dropped).

Done-gate: `npm run verify`; then in the live app open the Service Items module, confirm an
`MSR` tab shows 98 items with the Taxable box checked, and export/import round-trips it.

## WS2 — Tax behavior (NO code change)

Catalog `taxable:true` + existing `isMSR` divide-out = grand total equals the sheet price
with tax shown broken out. Live-verify with the console handle already present
([invoices.jsx:54](../src/invoices.jsx:54) `window.__invoiceCalc`): feed one MSR line at its
sheet price (e.g. Diagnostic Fee 85.00) with `pm:'MSR'`, assert `grandTotal === 85.00` and
`tax` ≈ 85 − 85/1.0725. No edits; this is a regression check that the reused path holds.

Note: the sheet's own "10% Tax" column (pages 25+) is MSR's material-cost tax component
already baked into each Total Price. It is NOT the app's 7.25% sales tax and needs no
handling — the Total Price is the single number the catalog stores.

## WS3 — Replace the MSR bid sheet template (DONE 2026-07-07)

Received `Gamble Plumbing - MSR HVAC Bid Sheet.xlsx` (already the `BID_SKELETON.HVAC`
filename, dropped into `PM Bids Excel/`). Changes shipped:
- `BID_CELLS.HVAC` addr `C8`->`C9`, date `C9`->`C10` (header labels at B9/B10; value cells are
  the merged C9:I9 / C10:I10). Sheet tab name unchanged ('Vendor HVAC Bid Sheet'). Market cell
  C8 pre-filled to "Raleigh Durham" (fixed home market; exact string from the Markets dropdown
  list) via `market`/`marketVal` in the config -> patchBidSheet.
- `library_io.parseMsr(filePath)` now reads this sheet (col B name / col G Total Price) instead
  of an embedded array; `main.js` `library-seed-msr` passes the skeleton path. Re-seeding MSR
  pulls MSR's current prices with no code edit.
- Live-tested: patched a copy's C9/C10, values land, exceljs reparse clean (no corruption; the
  JSZip in-place patch mechanism is unchanged). RUNTIME: user re-runs Settings > Service Library
  > "Seed MSR" to load the 120 items; folder-create for an MSR HVAC WO fills address+date.
- Provenance files `msr-hvac-catalog.{json,csv}` are now STALE (98-item snapshot); the live sheet
  is the source of truth. Left for history; ignore for pricing.

### Original WS3 (blocked) reference

MSR requires all future bids on their designated live Excel bid sheet: "Vendor is required
to submit all future bids using the designated bid sheet format... Compliance with this
format is a condition of bid approval." The app drops a copy of the HVAC skeleton into each
MSR WO folder and patches address+date:
- Template dir: `~/OneDrive/Desktop/excel/PM Bids Excel/` ([main.js:472](../main.js:472)).
- `BID_SKELETON.HVAC = 'Gamble Plumbing - MSR HVAC Bid Sheet.xlsx'` ([main.js:473](../main.js:473)).
- `BID_CELLS.HVAC = { sheet: 'Vendor HVAC Bid Sheet', addr: 'C8', date: 'C9' }`
  ([main.js:475](../main.js:475)); `patchBidSheet` sets those two cells in place.

BLOCKER: user does not yet have MSR's new Excel bid sheet (MSR supplies it "via the live
Excel document"). This PDF is a flattened DocuSign print, not the fillable xlsx.

When the Excel file arrives:
1. Save it into `PM Bids Excel/` as the HVAC skeleton (keep the exact `BID_SKELETON.HVAC`
   filename, or update that constant to the new filename).
2. **Re-verify the cell map** — the new layout has a different header block (Vendor Name /
   Supplier Used / Market / Property Address / Date of Bid), so the sheet tab name and the
   address/date cell refs almost certainly moved. Open the xlsx, find the sheet name and the
   Property Address + Date of Bid value cells, update `BID_CELLS.HVAC`.
3. Re-run a WO folder create for an MSR HVAC WO; confirm the copy fills address+date and
   Excel opens it without the "found a problem with content" repair prompt (the in-place
   JSZip patch already avoids the exceljs corruption — see the patchBidSheet comment).

## WS4 — MSR bid-acceptance requirements (RESOLVED 2026-07-07, user decisions)

MSR's rules (PDF pages 1-2, 24) and how the app treats each:
- **Fixed pricing, no deviation** — applies ONLY to service items MSR explicitly lists and
  prices (the MSR tab). Anything not on that sheet is NOT bound by MSR pricing.
- **Non-listed work → treat as General**, not the MSR "Other" line. Non-listed work falls under
  the General catalog / normal pricing; it does not adhere to MSR fixed pricing. (No code: the
  matcher already falls back client→General, and a non-MSR-catalog line just prices freely.)
- **Bid-sheet format is mandatory** — handled (WS3: MSR's own sheet is the skeleton).
- **Equipment data plate + photos** — COVERED for now: techs already photograph the data plate
  in the field. Only becomes a code task if MSR requires the data written into the bid itself
  (see Outstanding #1).
- **Diagnostic fees** — KEEP them in the app's invoice line list for now (they ARE MSR catalog
  items: Diagnostic Fee $85 / Emergency $135, and drive the invoiceHasServiceCall alert). MSR's
  rule that they go in Salesforce "Incurred Costs" is a Salesforce-entry step, not an app change.
  **OPEN QUESTION (needs MSR confirmation):** the Incurred-Costs language implies the diagnostic
  fee is only PAID when it was the ONLY labor — i.e. if the bid is approved, incurred costs
  (incl. the diagnostic) are removed from the WO, so the fee is billable only on a
  diagnose-and-no-further-work visit. If confirmed, the app must NOT ubiquitously include the
  service call on MSR HVAC invoices/bids: it belongs only when no other billable work is on the
  invoice. This DIRECTLY GATES Outstanding #2 (auto service-call qty=1) and softens the
  invoiceHasServiceCall RED alert for MSR (no service call is CORRECT when other work exists).
  Do not build the auto-service-call default until MSR confirms the rule. Await user
  confirmation.

## Outstanding tasks (deferred, not built)

1. **Bid-submission confirmation phase-hook.** IF MSR later demands the equipment data
   (make/model/serial) + photos be written into the bid itself: add a hook on the
   bid-submitted status(es) that pops a confirmation checklist ("data plate photo attached?
   equipment info in bid?") before the status commits. Gate: only if MSR rejects photo-only.
   Look at the existing phase/status-change flow for the hook point (phases live in the WO
   record; find where a status transition fires).
2. **Auto service-call on the FIRST bid sheet.** BLOCKED on the diagnostic-fee OPEN QUESTION
   above — if MSR pays the fee only when it was the sole labor, an auto qty=1 on every first
   bid is WRONG. Do not build until confirmed. Spec (when unblocked): in `patchBidSheet`
   (main.js), on the FIRST
   bid per WO only (NOT CO duplications), set the Diagnostic Fee / basic service-call line's
   Quantity cell to 1 — col H, row 17 on the current 'Vendor HVAC Bid Sheet' (H17). One
   service-call fee per WO. The first-bid path (main.js ~line 588, `copyFileSync(skel,dest)`)
   is distinct from the CO path (~line 666, copies the newest cumulative bid) — set the qty
   ONLY in the first-bid branch, or pass a flag through patchBidSheet. Re-verify the H17 cell
   ref against the sheet before shipping (numeric-qty cell for the Diagnostic Fee row).

---

## Collateral / risks

- **Source name typos kept verbatim.** Rows 32-40 read "AC Pacakaged System" / "Heat Pump
  Pacakaged System" (MSR's misspelling). Kept as-is so the invoice autofill match against
  MSR-scraped bid descriptions stays exact. Flag for user: fix only if MSR's own portal
  strings are spelled correctly.
- **UOM (Count vs Pound) is not modeled** in the service library (`{name,desc,price,taxable}`
  has no unit). The 4 refrigerants (R22/R410a/R32/R454b) are priced per Pound; everything
  else per Count. Price stored is per-unit either way, so qty on the invoice handles it — no
  schema change needed, but note it so refrigerant lines get a sensible qty (pounds).
- **"Other" line already exists** — the invoice editor's blank/sentinel line covers MSR's
  "Other" requirement; no new field.
- **Name-extraction provenance.** Prices, UOM, and section headers parsed cleanly from the
  PDF table. 28 item names were mangled by the PDF's cell-wrap (name text interleaved with
  description) and were reconstructed from the source text; spot-check the CSV names against
  the sheet before shipping. Prices are verbatim from the Total Price column.

## Suggested sequence

1. WS1 (category + seed 98 items) + WS2 (verify tax round-trip) — unblocked, ship together.
2. WS4 — drop the requirements text wherever chosen (or leave in this handoff).
3. WS3 — on receipt of MSR's Excel bid sheet: swap skeleton + re-verify cell map.
