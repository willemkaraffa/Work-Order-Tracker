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

## Live-test findings (2026-07-28, after S1a+S1b shipped)

User live-tested. 6 issues. None are S1b regressions (all pre-existing flatness /
not-yet-built scope / UI polish). Triaged, fix specs to vet before coding:

1. **Sticky table header scrolls with the list + overlaps rows** (CSS). thead is
   `position:sticky;top:0` but background/z-index lets rows show through mid-
   scroll. Fix: opaque header bg + z-index above body; verify in scroll
   container. Small. (invoices.jsx table ~:327)
2. **Multi-size families are line items, not section headers** (STRUCTURAL; the
   core flatness goal #3, only partly solved). AMH `X:` headers (Condenser:/FAU:/
   Furnace:) DO recover. But inside e.g. a "Maintenance:" section, families like
   "Condenser (A/C Straight Cool)" / "Evaporator Coil" are PRICED rows followed
   by `1.5-5 Ton` size rows with NO `:` sub-header -> stay flat. Same for Water
   Heaters. NEEDS DESIGN: heuristic to detect a family (a row followed by
   size-variant rows, e.g. `/\d+(\.\d+)?\s*Ton/` or `\d+ Gallon`) and promote it
   to the section (subCategory), sizes become its items. DECIDED (user 2026-07-28):
   FAMILY = SECTION. The family row becomes the subCategory; its size variants are
   the items under it. No 4th level. Family's own priced row: drop it (or keep as
   a base item -- confirm at build). Parser-recovery extension (S1a territory) ->
   needs a re-seed to take effect.
3. **Description column is dead weight when empty** -> drop it, give Item Name the
   space. Fix: hide the Description column when no visible item has a non-empty
   desc (mirror the existing `showSubCol` pattern); General still uses desc so do
   not delete the field. Small. (invoices.jsx :327-)
4. **Sub-categories unchangeable / cannot merge** items into one subcat. Per-row
   subCategory `<select>` exists (:271) but user wants to MERGE many items into
   one section. DECIDED (user 2026-07-28): RENAME-IN-MANAGE REASSIGNS. Renaming a
   section in Manage sub-categories rewrites `subCategory` on every item carrying
   the old name; merge = rename two sections to the same name. No multi-select UI.
5. **Cannot seed MSR plumbing** (Settings seed buttons Seed General/AMH/MSR are
   static). Plumbing load = S2, not built. 53 rows (with material/labour) already
   in this doc's table.
6. **Seed should choose a target category/sub** to seed into; PM catalogs stay
   hardcoded but MSR Plumbing sub was never hardcoded. = S2 seed-UI + a plumbing
   seed path. Fold into S2.

Sequence proposal: S1b-fix (#1+#3, small UI) -> design #2 + #4 -> S2 (#5+#6, +
plumbing load w/ material/labor). Spawn budget: 2 coders already spent this
session; the above is NEXT session (or explicit override).

### Progress 2026-07-28 (session 2)
- #1 (sticky header gap) + #3 (hide empty Description col): DONE, commit dfc57d9.
  Root cause #1 = scroll container 14px top padding under a sticky top:0 thead;
  dropped padding + zIndex 1->2. #3 mirrors showSubCol (showDescCol on items).
- #2 (family=section flatness): DONE code, commit c52851c. LIVE DATA differed
  from this doc's heuristic: the flat HVAC block (rows 86-203) is a tonnage x
  SEER-tier equipment MATRIX, not simple family+Ton. Family header rows carry
  D="14 Seer" (a TIER LABEL, parsed as $14 before). DECIDED (user 2026-07-28):
  col D = the sell price, ONE item per Ton size (B/C are SEER cost tiers,
  ignored -> material/labor='Included'); bundles (System/Full-System
  Replacements, rows 144-203) INCLUDED as items. parseAmh rewritten: buffer
  rows + one-row look-ahead; a non-size row whose next row is Ton/Gallon becomes
  the subCategory; sizes emit as "<family> <size>". Look-ahead runs BEFORE
  isSectionHeader (reviewer finding 0b5c6b4b). KNOWN cosmetic: "80% Furnace" /
  "93%+ Furnace" have a 2-row header (product line + "Adjust ECM..." note) so
  they name after the note row -> rename via #4 later. REQUIRES user re-seed
  (Settings > Seed AMH); no auto-migration. parseMsr UNCHANGED (MSR is flat).
- REMAINING this batch: #4 (rename-in-manage reassigns), #5+#6 (S2 plumbing
  seed + seed-target UI). Both need their own coder-spawn grant; #5+#6 wants its
  own session (53-row load + user row-by-row PDF check).

### Progress 2026-07-29 (session 3) - scope settled with user
- SPAWN PLAN (user-decided): #4 ALONE this spawn. #6 is really #5's UI (the three
  existing seeds have FIXED workbook+tab targets via replaceTab; a target-chooser
  has no live seed to drive without the plumbing merge-seed path). So #5+#6 ship
  TOGETHER next session, gated on the user's row-by-row PDF check of the 53 rows.
- #4 DESIGN (locked, ready to build):
  - ROOT CAUSE: two stores, no link. Label list = `settings.librarySubCats`
    (app.jsx:3930). Items carry `subCategory` in the `service_library` store
    (`useServiceLibraryStore`). `SimpleListEditor.commitRename` (app.jsx:3010)
    rewrites the label list ONLY; items keep the old string -> rename orphans
    instead of reassigning.
  - MECHANISM: extract a PURE `renameSubCategory(lib, oldName, newName)` into
    `src/orders-logic.js` (rewrite `subCategory` old->new across every catalog
    array, guard Array.isArray) so it is unit-testable per the QA rule. Give the
    generic `SimpleListEditor` optional `onRename(old,new)` / `onDelete(name)`
    props that OWN the transaction (editor skips its own setItems when present).
  - WIRING (BOTH call sites, each already holds `[lib, persist]`): `ServiceLibrary`
    (invoices.jsx:402) + `LibraryToolsSection` (app.jsx:3172). Handler:
    `setSubCats([...new Set(subCats.map(s=>s===old?new:s))])` (label list: replace
    + DEDUP = merge) then `persist(renameSubCategory(lib, old, new))`. Miss either
    site and that screen still orphans.
  - MERGE = rename two sections to the same name; the Set collapses the dup label,
    the cascade rewrites both item groups. Matches the 2026-07-28 decision.
  - DELETE stays non-destructive (leave item strings; they still render as an
    ad-hoc section via subOptions merge). Not wiring onDelete cascade this pass.
  - SCOPE: subCategory (L3) only; `page` (L2) untouched. Files: src/orders-logic.js
    (new pure fn + test), src/app.jsx (SimpleListEditor props + LibraryToolsSection
    wiring), src/invoices.jsx (ServiceLibrary wiring).
  - VERIFY: `npm run verify` (logic test for renameSubCategory incl. merge-dedup) +
    live: rename a section in Manage, confirm items carrying it flip subCategory
    and re-group; merge by renaming two to one name.
  - #4 SHIPPED this session (verify green, 28 pass). renameSubCategory in
    orders-logic.js; SimpleListEditor opt-in onRename/onDelete; both sites cascade.
    Static+unit verified, not electron-clicked.

### Item-name trimming (user 2026-07-29, for the #5/#2 re-seed next session)
- Parser family=section recovery currently names size variants
  `"<family> <size>"`, producing very long names like
  `"Adjust ECM motor speed to match system tonnage for 1.5 - 2.5 & 3.5 Ton units 1.5 Ton"`.
- USER DECISION: the section header already carries the family context, so the
  ITEM name should be ONLY the tonnage/size token (e.g. `"1.5 Ton"`), not
  `family + size`. Cleaner list; header supplies the meaning.
- Apply in the parseAmh look-ahead branch (and the plumbing/MSR size recovery):
  when a family row spawns size-variant items, emit `subCategory = <family>` and
  `name = <size token only>` (the `\d+(\.\d+)?\s*Ton` / `\d+ Gallon` match), NOT
  the family-prefixed string. Requires the AMH re-seed to take effect.
  Watch the known 2-row-header families (80% / 93%+ Furnace) so the family name
  used for the header is the product line, not the "Adjust ECM..." note row.

### Progress 2026-07-29 (session 4) - #5+#6 PARTIAL, blocked by API 529
- library_io.js DONE (role gate allowed it):
  - parseAmh look-ahead size rows now emit `name: name` (size token alone, e.g.
    "1.5 Ton"); dropped the `family + ' ' + name` prefix. subCategory still = family.
    (item-name trim.)
  - New `plumbingSeedItems()` = the 53 rows from this doc's table, built as
    { name, desc:'', price:Total, taxable:false, page:'Plumbing', subCategory:<section>,
    manual:true, material, labor }. 7 bundled rows use MATERIAL_INCLUDED ('Included').
    Exported in module.exports.
- NOT DONE (blocked): main.js IPC `library-seed-msr-plumbing`, preload.js
  `seedMsrPlumbing` bridge, app.jsx `seedMsrPlumbing` merge + "Seed MSR Plumbing"
  button, parse-amh.test.js name-assertion fixups, new test/parse-plumbing.test.js.
  `npm run verify` NOT run. Gate NOT green. Nothing committed.
- DESIGN LOCKED for the pending wiring (hand to a builder verbatim next session):
  - main.js: handler returns { ok:true, items: libraryIO.plumbingSeedItems() }.
  - preload.js: `seedMsrPlumbing: () => ipcRenderer.invoke('library-seed-msr-plumbing')`.
  - app.jsx useLibraryTools: a NEW `seedMsrPlumbing` (NOT replaceTab -- Plumbing must
    coexist with HVAC in the one MSR tab). Merge = drop existing `page==='Plumbing'`
    items, append the 53. Idempotent, HVAC untouched, confirmDialog with existing count.
    Add to hook return + destructure in LibraryToolsSection + button after Seed MSR.
  - parse-amh.test.js: size items now named by size token alone; find by
    name AND subCategory (multiple families share "1.5 Ton").
  - test/parse-plumbing.test.js: 53 items; all page/taxable:false/manual:true/desc:'';
    numeric material+labor==price (7 'Included' rows exempt); exactly 7 'Included';
    spot-check 40 Gal Gas = 1503.82 / 828.82 / 675 / 'Water Heater Replacement'.
- ROOT CAUSE of the stall: two builder spawns died on Anthropic API 529 (Overloaded)
  before any work; the spawn-limiter counts attempts, so a 3rd = declared system
  failure and hard-blocked. NOT a scope/approach fault. Grant for spawn 2 does not
  carry. FIX: fresh session resets the counter; re-dispatch the same spec.
- GATE for #5 data: user's row-by-row PDF check of the 53 plumbing rows still pending.

### Progress 2026-07-29 (session 5) - DATA GATE PASSED, wiring still blocked by 529
- DATA GATE GREEN: 53/53 plumbing rows in library_io.js PLUMBING_TABLE verified
  row-by-row vs ~/Downloads/pricesheet.pdf section 4. Prices (material/labour/total)
  exact; material+labor==total holds every numeric row; 7 'Included' sentinels
  correct (Sewer 5, Toilet 1, Sinks 1); section names verbatim; Permit + Minimum
  Job Fee + Other correctly EXCLUDED. plumbingSeedItems() may seed as-is.
- Builder spawn died on API 529 (Overloaded) again before any work. NOT a scope
  fault. No files touched. library_io.js partial edits still stand.
- RESUME: re-dispatch the SAME builder spec (5 wiring items: main.js IPC,
  preload bridge, app.jsx seedMsrPlumbing merge+button, parse-amh.test fixups,
  new test/parse-plumbing.test.js) then npm run verify. Spec verbatim in the
  DESIGN LOCKED block above (lines ~381-392). Counter resets next session.

### Progress 2026-07-30 (session 6) - S2 WIRING DONE, gate green + live-verified, NOT committed
- Builder (2nd spawn, human-granted via AskUserQuestion) built all 5 wiring items
  first try. npm run verify GREEN: 29 pass / 0 fail / 0 skip, incl new
  test/parse-plumbing.test.js. Chain consistent: main.js:1116 handler
  library-seed-msr-plumbing -> preload.js:53 seedMsrPlumbing (window.library) ->
  app.jsx:2943 window.library.seedMsrPlumbing().
- app.jsx seedMsrPlumbing (2939-2954) MERGE (not replaceTab): kept = MSR items
  NOT page==='Plumbing'; append the 53 (all page==='Plumbing') = idempotent;
  confirmDialog only when existing Plumbing count>0; cancel returns pre-persist.
- LIVE-VERIFIED in Electron by USER: fresh seed = 53 across 7 sections + HVAC
  intact; re-seed = confirm dialog, stays 53 (not 106); cancel = no change. PASS.
- REVIEWER: could NOT run. gemini-review.js is NOT on this branch
  (fix/msr-scan-wrong-tab); it lives on branch chore/gemini-reviewer. Extracted it
  to scratchpad + ran with .gemini-key: Gemini API 503 (upstream overload) on 3
  attempts, exit 2 = DID NOT RUN (not a clean pass). External review still owed.
- NOT committed (commit = architect/overseer + human authority). Open before green
  light: (1) Gemini review unrun, retry when upstream up; user MAY accept gate+live
  in lieu. (2) gemini-review.js missing on this branch = infra gap to fix.

## Verify plan

- S1/S3: `npm run verify` + live app (observable nav/model change). Confirm tax
  keys + snapshot/restore.
- S2: live render + USER row-by-row check vs PDF (accuracy is the gate).
