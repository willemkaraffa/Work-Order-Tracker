# Service Library: categories + subcategory pages + sections + doc import

Status: PLAN / awaiting acceptance. No code yet. Overseer-discussed 2026-07-27.

## Goal (user, decoded)

1. Load the NEW MSR plumbing prices into the **service library** (from
   `~/Downloads/pricesheet.pdf`, effective 7/10/2026), hand-transcribed +
   user-verified.
2. Reorganize the library into THREE levels and make them navigable:
   **category > subcategory-page > section**. Clicking a category searches
   across all its subcategory-pages. Applies to every category going forward.
3. Fix the flatness bug: item families like "Water Heaters" / "Heat Pumps"
   (with sized variants) must sit under a **section header**, not exist as bare
   flat items. The bid sheets already have these headers; the parsers DROP them
   (any row with no price is skipped), which is why MSR/AMH are flat.
4. Categories user-editable: **manually create** or **import from xlsx**.
5. Migration must be **reversible** (snapshot + restore) in case it breaks.

## Decisions locked (with user, 2026-07-27)

- Plumbing price source = the PDF (no updated plumbing bid-sheet xlsx exists).
  The stale on-disk `Gamble Plumbing - MSR Plumbing Bid Sheet.xlsx` is the
  WO-automation **bid skeleton** (`main.js BID_SKELETON.Plumbing`) and STAYS
  untouched. Library plumbing is decoupled from it.
- Importer input = xlsx + manual create. No PDF auto-parser.
- Delivery = sliced, plan-first. One coder spawn per slice, verified each.
- **Exclude "Minimum Job Fee $75"** (a billing floor, not a service item).
- **Apply the model to AMH** (subcategory-pages from the bid sheet trades; see
  AMH source-sheet gap below).
- Reversible: snapshot `service_library` before any migration; provide restore.

## The 3-level model (terminology, CODE vs UI)

The user's words invert the code's. Pin the mapping:

| Level | User calls it | CODE field | Nav behavior |
|------|---------------|-----------|--------------|
| L1 | Category | library object key (`MSR`) | sidebar top; click = search ALL pages |
| L2 | Subcategory | **NEW field `page`** (e.g. `HVAC`,`Plumbing`) | sidebar sub-entry; own page |
| L3 | Section | **existing `subCategory`** (e.g. `Water Heaters`) | header row within a page |

Reuse rule (5): `subCategory` already renders as section header rows
(`invoices.jsx:123-135,257-263`) and General already populates it correctly ->
REUSE it for L3, do NOT rename (avoids churning General's 143 items). Add ONE
new field `page` for L2. Justification for the new field: a genuine third nav
level exists; AMH currently overloads `desc` to hold the trade, which is the bug
to fix, not a field to reuse. (Architect may instead rename subCategory->section
+ use subCategory for L2 to match user words; costs a 143-item + code rename.
Default = the low-churn `page`-field option unless architect argues otherwise.)

## Semantic-key risk (MUST preserve)

`MSR`/`AMH`/`General` (L1 keys) carry behavior, not just labels:
- `constants.CATALOG_TAX` keys tax policy by these names; unknown names fall to
  `DEFAULT_CATALOG_TAX`.
- Matching reads `lib.MSR`/`lib.General` by hardcoded key (`remittances.jsx:93`),
  General is the cross-catalog fallback (`invoices.jsx:429`, `app.jsx:5025`).

=> "Create category" is for NEW L1 categories (default tax). The three built-ins
stay pinned; a rename must not orphan a tax key. L2 `page` and L3 `subCategory`
do NOT affect tax/matching (those key off L1 only) -- safe to add/migrate.

## Current data (verified from the live store, wo-data.json)

- General (143): `subCategory` already = sections (Water Heaters 13, HVAC Indoor
  14, HVAC Outdoor, Bath, Service Call...). NO L2. Sized items already nest
  right. **No migration.**
- AMH (254): trade in `desc` (Plum Minor 71, Plum Major 31, HVAC 149) + 3
  service-call rows. NO sections. -> migrate `desc` trade to `page`; add sections
  from the AMH bid sheet.
- MSR (120): fully flat, no `page`, no `subCategory`. All HVAC. -> stamp
  `page:'HVAC'` + recover sections from the HVAC bid sheet.

## Parser fix: recover sections by tracking the header row

Mechanism (applies to parseMsr, parseAmh, and the plumbing load): iterate rows;
when a row has a name but NO numeric price, it is a **section header** -> set
`currentSection`, do not emit an item. When a row has a price, emit the item with
`subCategory = currentSection`. This is the ONE mechanism change; it recovers the
structure already present in the sheets.

Disambiguation: some no-price rows are instruction PROSE, not section headers
(e.g. HVAC sheet "INCURRED COSTS" note, "... TOTAL" summary rows). Guard: treat a
no-price row as a header only if short (heuristic, e.g. <= ~48 chars) and not a
"TOTAL"/summary line. Verify recovered sections against the sheet before commit.

Recovered MSR HVAC sections (from the bid sheet, for verification):
INCURRED COSTS (Diagnostic Fee, Emergency Diagnostic), CLEANING, DUCTING AND
VENTS, REFRIGERANT (incl R22/R410a/R32/R454b), FULL SPLIT SYSTEM REPLACEMENT -
HEAT PUMP / STRAIGHT COOL / GAS SPLIT, FULL SYSTEM REPLACEMENT - AC PACKAGED /
HEAT PUMP PACKAGED, PARTIAL REPLACEMENT - AIR HANDLER / GAS FURNACE (80% & 92%),
... (continues; full recovery in S1). Sized variants (1.5-5 Ton) become items
under each section.

## AMH source (RESOLVED 2026-07-27)

Authoritative AMH source = `OneDrive/Desktop/excel/PM Bids Excel/New
Structure-20260318- Carolina - Raleigh (1).xlsx` (multi-trade workbook; AMH
catalog uses tabs `Plum Minor`, `Plum Major`, `HVAC` -- same names as old
AMH_TABS). Update `main.js AMH_DEFAULT` to this path.

Confirmed layout (Plum Minor / HVAC):
- Row 1 = fee/instruction prose (skip).
- Row 2 = column-label row AND the first section name in col A (`Clogs:` /
  `Condenser:`). cols: B=Material Cost, C=Labor Cost, **D=Premier Pricing
  (=price)**, E=Labor Price. Old parseAmh did `if(n<=2)return` and LOST the first
  section -- new parser must capture row-2 col-A as section 1.
- Section headers = col-A cells ending `:` (e.g. `Faucets and Fixtures:`,
  `FAU/Air Handler Unit:`) with no col-D price. Items = col-A name + col-D price.
- Price still col D (matches old parser); taxable rule unchanged (inclusive ->
  false, except service-call/diagnostic/emergency -> true).
- `page` = the tab (Plum Minor / Plum Major / HVAC). `subCategory` = the
  recovered section.

## Reversibility (user requirement)

- Before any migration, snapshot the whole `service_library` to a sibling
  storage key `service_library_backup_<ISO-ts>` (and/or the existing round-trip
  xlsx export). One-click "Restore last snapshot" in Settings > Service Library.
- Migration is version-guarded + idempotent (a `libModelVersion` flag) so it runs
  once and re-running is a no-op.
- Report rows-changed counts (migration discipline: count flipped rows, don't
  trust the flag).

## Slices

### S1 - model + nav + section recovery + reversibility
- Add `page` field + 3-level sidebar (category > page sub-entries; category click
  = search-all; page click = that page; sections render as existing header rows).
- Make categories data-driven (derive L1 from library keys; built-ins pinned).
- Parser section-recovery (header-row tracking) for MSR HVAC + AMH; stamp
  `page`/`subCategory`. General untouched.
- Snapshot + restore + version guard.
- Add-category (manual) with default-tax warning; add-page + add-section scoped
  to selection.
- Verify: `npm run verify` + live app. MSR shows HVAC page with real sections;
  create a category; parent search-all works; built-in tax keys intact; snapshot
  restores.

### S2 - plumbing data load (accuracy-critical)
- Add the 53 transcribed plumbing items to MSR with `page:'Plumbing'`,
  `subCategory=<section>` (table below), `manual:true`, `taxable:false`.
- Idempotent add (no dupes on re-run).
- Verify: render MSR > Plumbing; USER checks every row vs the PDF.

### S3 - xlsx importer + manual create
- "Import from xlsx": choose file -> exceljs read -> preview/confirm table
  (map name/desc/price/taxable/page/section) -> write to a new/chosen category.
  No blind write. Reuses `library-choose-file` + `library_io`.
- Verify: import a sample xlsx, preview matches, items land correct.

## Labor/material breakdown (added 2026-07-28)

User requirement: store the per-item Material + Labour split exactly as the price
sheets display them, for AMH + MSR HVAC + MSR Plumbing. Model:

- Two NEW fields per item: `material`, `labor`. `price` stays = Total.
  Invariant: `material + labor == price` (Total). Verified true for all 53
  plumbing rows below.
- Sources carry the split natively. ALL THREE VERIFIED from the live files
  2026-07-28 (read the DATA rows, not just headers):
  - MSR Plumbing PDF section 4: cols `Material | Labour | Total`. Sell-side,
    sums clean.
  - MSR HVAC bid sheet (`Vendor HVAC Bid Sheet`, header row 13):
    `E=Material Price, F=Labor Price, G=Total Price`. VERIFIED E+F==G on 104/104
    rows. Sell-side, sums clean. Labor-only services: E blank, F=G. Refrigerants
    (R22/R410a/R32/R454b): F blank, E=G. Wire directly (invariant holds).
  - AMH `New Structure` xlsx: `B=Material Cost, C=Labor Cost, D=Premier Pricing`.
    CORRECTION: the header labels E "Labor Price" but the DATA rows show E is NOT
    a per-item column -- E cells hold "Overhead"/"Profit"/blank and F holds
    0.2/0.4 (an overhead/profit slider legend). The prior-session "E=Labor Price"
    claim was reading the header, not the data. So AMH has NO sell-side split;
    only internal costs B/C exist, and D (Premier) is a single burdened sell
    number (D ~= (B+C) x 1.6). B + C != D.
- AMH decision (user, 2026-07-28): store `material = B (Material Cost)`,
  `labor = C (Labor Cost)` exactly as the sheet displays. Understood as internal
  COST, NOT a decomposition of the billed price. `price` stays = D (Premier).
  Do NOT wire `labor=E`/`material=D-E` (E is not a price column). Invariant
  `material+labor==price` therefore holds for MSR only; AMH breakdown is
  cost-basis and does not sum to price.
- "Included"/blank material means bundled into labour (or labour into material
  for refrigerants), NOT $0 -- 7 plumbing rows (#13-17, 23, 46) plus MSR HVAC
  labor-only/refrigerant rows. Store faithfully (sentinel/string, not 0) so the
  UI shows "Included", matching the sheet. `taxable` unchanged.

## Plumbing items - transcription for verification (S2 source of record)

From `pricesheet.pdf` section 4 (bid pricing tables). `page:'Plumbing'`,
`taxable:false` (fully burdened, tax included). `price` = Total = Material +
Labour. Minimum Job Fee EXCLUDED (billing floor). Permit EXCLUDED (blank total).
Tile Surround = per square foot (name carries the unit; catalog has no unit
field). "Included" = material bundled into labour on the sheet.

| # | Section | Item | Material | Labour | Total |
|---|---------|------|-------:|------:|------:|
| 1 | Water Heater Replacement | 40 Gallon Water Heater: Gas | 828.82 | 675.00 | 1503.82 |
| 2 | Water Heater Replacement | 40 Gallon Water Heater: Electric | 674.45 | 625.00 | 1299.45 |
| 3 | Water Heater Replacement | 50 Gallon Water Heater: Gas | 856.12 | 675.00 | 1531.12 |
| 4 | Water Heater Replacement | 50 Gallon Water Heater: Electric | 723.85 | 625.00 | 1348.85 |
| 5 | Water Heater Replacement | Direct Vent Water Heater | 1627.02 | 725.00 | 2352.02 |
| 6 | Water Heater Repair/Service | Expansion Tank | 38.97 | 100.00 | 138.97 |
| 7 | Water Heater Repair/Service | 3/4 inch Water Ball Valve | 22.07 | 90.00 | 112.07 |
| 8 | Water Heater Repair/Service | Drain Pan | 25.97 | 22.50 | 48.47 |
| 9 | Water Heater Repair/Service | Water Heater Tune-Up Kit: upper/lower thermostats and 2 elements | 45.47 | 200.00 | 245.47 |
| 10 | Water Heater Repair/Service | T&P Valve | 27.91 | 90.00 | 117.91 |
| 11 | Water Heater Repair/Service | Anode Rod | 45.47 | 90.00 | 135.47 |
| 12 | Water Heater Repair/Service | Thermocouple | 15.57 | 90.00 | 105.57 |
| 13 | Sewer & Drain Lines | Unclog Main Sewer Line with Power Auger | Included | 300.00 | 300.00 |
| 14 | Sewer & Drain Lines | Unclog Drain Line Through Roof Vent | Included | 350.00 | 350.00 |
| 15 | Sewer & Drain Lines | Unclog Drain Line Through Removing and Resetting Existing Toilet | Included | 350.00 | 350.00 |
| 16 | Sewer & Drain Lines | Unclog Main Sewer Line with Hydrojet Machine | Included | 500.00 | 500.00 |
| 17 | Sewer & Drain Lines | Scope Sewer Lines with Camera | Included | 350.00 | 350.00 |
| 18 | Toilet | Toilet with Wax Ring and Bolts | 131.27 | 180.00 | 311.27 |
| 19 | Toilet | Wax Ring and Bolts | 9.07 | 90.00 | 99.07 |
| 20 | Toilet | Flange with Wax Ring and Bolts | 23.71 | 175.00 | 198.71 |
| 21 | Toilet | Full Tank Repair Kit with Supply Line and Angle Stop | 51.57 | 130.00 | 181.57 |
| 22 | Toilet | Toilet Seat | 16.86 | 22.50 | 39.36 |
| 23 | Toilet | Unclog Toilet Using Auger | Included | 150.00 | 150.00 |
| 24 | Tub & Shower | Garden Tub / Roman Tub | 0.00 | 900.00 | 900.00 |
| 25 | Tub & Shower | Tub Insert | 388.70 | 350.00 | 738.70 |
| 26 | Tub & Shower | 3-Piece Tub Surround | 492.70 | 650.00 | 1142.70 |
| 27 | Tub & Shower | Tile Surround (per square foot) | 0.00 | 5.00 | 5.00 |
| 28 | Tub & Shower | 3-Piece Shower Surround | 544.70 | 700.00 | 1244.70 |
| 29 | Tub & Shower | Shower Pan | 336.70 | 600.00 | 936.70 |
| 30 | Tub & Shower | Mixing Valve | 103.97 | 200.00 | 303.97 |
| 31 | Tub & Shower | Tub/Shower Trim Kit with Valve | 128.70 | 200.00 | 328.70 |
| 32 | Tub & Shower | Bath Tub Handle | 15.87 | 45.00 | 60.87 |
| 33 | Tub & Shower | Showerhead: 3 Spray | 12.97 | 22.50 | 35.47 |
| 34 | Tub & Shower | Toe-Touch Drain Bath Tub Kit | 31.17 | 45.00 | 76.17 |
| 35 | Tub & Shower | Shower Head Arm | 18.17 | 22.50 | 40.67 |
| 36 | Tub & Shower | Shower/Tub Cartridge | 0.00 | 90.00 | 90.00 |
| 37 | Sinks | Bathroom: Pedestal Sink / Free Standing Vanity | 141.38 | 250.00 | 391.38 |
| 38 | Sinks | Bathroom: Undermount Sink | 91.10 | 200.00 | 291.10 |
| 39 | Sinks | Bathroom: Sink Faucet | 38.97 | 90.00 | 128.97 |
| 40 | Sinks | Bathroom: Pop-Up Assembly | 16.32 | 22.50 | 38.82 |
| 41 | Sinks | Kitchen: Undermount Sink | 162.84 | 200.00 | 362.84 |
| 42 | Sinks | Kitchen: Faucet | 128.70 | 90.00 | 218.70 |
| 43 | Sinks | Kitchen: Sink Strainer and Drain Assembly | 6.34 | 45.00 | 51.34 |
| 44 | Sinks | P-trap | 6.42 | 22.50 | 28.92 |
| 45 | Sinks | Sink Cartridge | 14.74 | 90.00 | 104.74 |
| 46 | Sinks | Snake Kitchen/Bathroom Sink | Included | 150.00 | 150.00 |
| 47 | Miscellaneous | Exterior Water Spigot / Hose Bibb | 15.31 | 134.69 | 150.00 |
| 48 | Miscellaneous | 1/2 inch Gas Ball Valve | 15.34 | 90.00 | 105.34 |
| 49 | Miscellaneous | 1/2 inch Angle Stop Shutoff Valve | 14.83 | 45.00 | 59.83 |
| 50 | Miscellaneous | Washer Box and Valves | 29.56 | 225.00 | 254.56 |
| 51 | Miscellaneous | Backflow Preventer / Pressure Vacuum Breaker | 0.00 | 300.00 | 300.00 |
| 52 | Miscellaneous | Sump Pump | 0.00 | 400.00 | 400.00 |
| 53 | Miscellaneous | Stainless Steel Supply Line | 9.46 | 22.50 | 31.96 |

## Taxable policy

MSR = fully burdened, tax included; `CATALOG_TAX.MSR.taxableInclusive` divides
out (grand = face). No service-call/diagnostic items in the plumbing list -> every
plumbing item `taxable:false`. Consistent with existing MSR HVAC.

## Verify plan

- S1/S3: `npm run verify` + live app (observable nav/model change). Confirm tax
  keys + snapshot/restore.
- S2: live render + USER row-by-row check vs PDF (accuracy is the gate).
