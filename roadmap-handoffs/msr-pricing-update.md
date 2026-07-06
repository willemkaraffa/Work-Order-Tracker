# MSR Pricing Agreement Update — Handoff + Plan

Date: 2026-07-06
Source: `~/OneDrive/Desktop/excel/PM Bids Excel/Complete_with_Docusign_MSR_-_Maintenance_Bid.pdf`
Effective date (per doc): **July 2, 2026**. Signed by Gamble Plumbing 7/3/2026.
Status: WS1 + WS2 DONE (2026-07-06). WS3 BLOCKED (user requesting MSR's official Excel
sheet — will not self-build; MSR won't accept a vendor-made/locked sheet). WS4 captured here.
`npm run verify` green (5 pass); parseMsr returns 98 valid items.

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

## WS3 — Replace the MSR bid sheet template (BLOCKED on the Excel file)

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

## WS4 — Capture MSR's bid-acceptance requirements

New rules MSR imposes for bid acceptance (from PDF pages 1-2, 24). Where to surface these
in-app is open (no existing "agreement notes" UI). Options: a static reference blurb in the
Service Items / MSR tab header, or leave them here as the reference. Requirements:
- **Fixed pricing, no deviation** without prior written MSR approval.
- **Non-listed work → the "Other" line item**: bid = standard hourly labor rate × estimated
  hours + material cost; subject to review/approval before work starts.
- **Bid-sheet format is mandatory**; non-compliant bids are rejected (see WS3).
- **Equipment data required**: existing equipment data plate — manufacturer, model number,
  serial number — plus photographs, as part of every bid submission.
- **Header fields per bid**: Vendor Name, Supplier Used (dropdown), Market (dropdown),
  Property Address, Date of Bid, recommendation to remedy (dropdown), and a written reason
  for the recommendation (equipment age, serial, scope).
- **Diagnostic fees go in the Work Order's "Incurred Costs" section in Salesforce**, not the
  bid body; if the total bid is approved, incurred costs are removed from the WO. Diagnostic
  Fee is only payable with documented troubleshooting/testing that identifies a specific
  fault — visual inspections, estimates, second opinions, and no-test site visits are not
  reimbursable.

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
