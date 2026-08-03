# Remittance / invoicing round 2 — 2026-07-31

Source of truth for this batch. Discussed with user before handoff; decisions locked below.
Procedure: architect drafts implementation plan from this doc -> coder -> `npm run verify` (build + tests) + live drop of the two real SSRS PDFs.

Scope = Tier 1 (in-module, no external automation). Tier 2 (RazorSync fill bot) is explicitly
DEFERRED to a separate future handoff with its own prove-targeting probe. Do NOT build it here.

## Locked decisions (from discussion)
- Persisted remittance list = FULL rehydrate (reopen the exact report and act on its WOs), not metadata-only.
- "PM" on the list = the client already on `report.source` (AMH | MSR). No new PM field. No new person entity.
- RazorSync entry is ONE field at a time; fields needed = Description + Price. Name is a catalog SENTINEL the
  user picks (`Labor!` / `Materials!` / `AMH!` / `MSR!`); the sentinel sets taxability RazorSync-side.
  RazorSync has no xlsx import, so pre-built line items are impossible; QOL must live in the module.
- Copy mechanism = stepper (per-WO, walks fields in entry order) WITH per-field buttons as fallback.
- Bug B (missing detection) is a HYPOTHESIS with no reproduction yet. Include the fix anyway (correct
  independent of the repro); architect MUST design a live test for it (rule C3).

## Item 1 — Persist processed remittances (full rehydrate)
PROBLEM: `report` is `React.useState(null)` in `src/remittances.jsx:22`. In-memory only; unmount = lost.
Invoices get written onto WOs, but the remittance STATEMENT is never stored. User wants to return to a past
remittance to keep working its active WOs.

SPEC:
- On a successful `run()` (and/or an explicit "Save remittance" action), snapshot the report to a persisted
  history list. Reopen restores it via `setReport(snapshot)`.
- Storage: REUSE `window.storage` (KV over `wo-data.json`; see `preload.js:4`, `main.js:472-483`). New single
  key `remittance_history` = array of snapshots. Same pattern app.jsx already uses for `service_library` /
  `wo_data` (`src/app.jsx:2992+`). No new IPC, no new file. (Rule 5: reuse existing storage, do not add a
  parallel persistence layer.)
- Snapshot shape = the existing report plus stamp fields. Report today = `{ source, blocks, statementTotal,
  fileName }` (see `run()` `src/remittances.jsx:41-141`). Add: `id` (stable), `invoiceDate` (today, ISO), keep
  `source` as the client tag. Do NOT invent parallel fields for data already on the report/blocks.
- List UI: a panel in the Remittances module listing saved snapshots, newest first, each row showing
  invoiceDate + client (source) + fileName + matched/flagged counts (already derived in `src/remittances.jsx:
  245-248`). Row click = rehydrate. Include a delete-row (hard delete is fine; it is the user's own log).
- Rehydrate + live WOs: blocks carry `woId`/`orderId`. On reopen, the module already renders blocks and its
  Fetch/Bill/Save actions resolve against the CURRENT `orders` prop, so "active work orders" stay live. Keep
  the snapshot as-was for the numbers; let the existing actions operate on current orders. Architect: confirm
  no stale-order crash when an `orderId` no longer exists (guard the find()).

VERIFY: reducer/roundtrip is thin; main proof is live (drop -> save -> restart app -> list persists -> reopen
-> blocks render -> Bill/Save still act on live WOs).

## Item 2 — RazorSync copy QOL
PROBLEM: only header fields (WO#/Invoice#/PropId) are click-to-copy (`copyField` `src/remittances.jsx:359`,
`copyText` `:219`). Line items are not copyable; entry into RazorSync is slow and one-field-at-a-time.

SPEC:
- Per-line click-to-copy for Description and Price (reuse `copyText`; extend the ReportBlock line render at
  `src/remittances.jsx:344-`).
- Sentinel tag per line, click-to-copy, derived from the EXISTING pure `categoryLabel(line)`
  (`src/orders-logic.js:1055`; tested `test/catalog-match.test.js:166`). Map (display-only, no new field):
    categoryLabel 'AMH' -> `AMH!` ; 'MSR' -> `MSR!` ; 'labor' -> `Labor!` ; 'material' -> `Materials!`.
  PM-listed lines already resolve to 'AMH'/'MSR' via `isPmListed` (`:1050`), so the client sentinels fall out
  for free. Put the map in orders-logic (pure, testable) as e.g. `sentinelTag(line)`.
- Copy stepper: one control per WO block. Holds a cursor over the ordered field list for that WO:
  per line [sentinel, Description, Price]. Each click copies the current field, advances the cursor, shows a
  visible "Next: <line> <field>" label; include a reset. Cursor is legit render-uncomputable state (user
  input drives it) so useState is fine here (NOT an A1/A2 smell). Keep per-field buttons as fallback.
- WO# copy carries the `WO ` prefix: copying WO# yields `WO <num>` (space; AMH memo needs the letters). This
  is the copied STRING only; do not mutate stored `woId`/`id`. Confirm no other copy site depends on the bare
  number.

VERIFY: pure test for `sentinelTag` mapping (all four labels). Live: stepper walks fields in order, WO# copies
with prefix.

## Item 3 — Bug A: duplicate line items (CONFIRMED)
ROOT CAUSE (proven against WO 03429915, Airedale Trail): `read-bid-lineitems` (`main.js:921`) reads EVERY
`/bid/i` sheet via `allBidCoSheets` (`main.js:902`) and SUMS them. The WO folder holds two FULL bids:
`478 Airedale Trail Bid 07-07.xlsx` and `...Bid 09-07.xlsx` (a revision). The read-all model assumes each
extra sheet is an additive delta; a re-bid is a full RESTATEMENT. Dedup keys on exact `desc|price`
(`main.js:933`), so any revised line escapes and double-counts -> bid-sum balloons vs the MSR paid total ->
"massive discrepancy". Within a single sheet the read is correct (main-table takes only `qty>0` rows,
`main.js:873`; Diagnostic/Service Call skipped to avoid the OTHER double, `:875`).

FIX: distinguish sheet TYPE by filename token (the split already exists in `allBidCoSheets`):
- Bid = full statement (`/bid/i`, not a CO). A later Bid SUPERSEDES earlier bids -> use only the NEWEST bid.
- CO = change order (`/\bCO\b/`, produced by `wo-create-subfolder` `main.js:767`) = additive delta -> use ALL.
Selection = newest Bid (by mtime) + all COs, then existing dedup. Reuse the mtime approach in
`latestBidOrCoSheet` (`main.js:716`). Extract the selection into a PURE helper (input: list of {name, mtime};
output: chosen file list) so it is unit-testable without electron/fs.
Edge cases: zero bids (only COs) -> read all COs; one bid -> unchanged; multiple bids -> newest only.

VERIFY: pure test of the selection helper (two bids + one CO -> newest bid + CO; single bid -> itself).
Live: drop `Vendor_ACH_Payment_Detail_-SSRS1 (10).pdf` and `(12).pdf`; Airedale total now matches paid.

## Item 4 — Bug B: bid sheet not detected (HYPOTHESIS — repro pending)
HYPOTHESIS: trade is guessed from `rec.type` via `/hvac|heat|cool|furnace/i` (`main.js:926`), else Plumbing;
`sheetName = BID_CELLS[trade].sheet`. A WO whose `type` misses the regex (e.g. "AC", "Air Handler") makes the
reader seek the Plumbing sheet in an HVAC-only workbook -> sheet absent -> zero items -> a "properly-marked
folder" reads as undetected. (Airedale's workbook only has `Vendor HVAC Bid Sheet`.) Not yet reproduced
against a real failing WO.

FIX (correct regardless of the repro): pick the bid sheet that ACTUALLY EXISTS in the workbook rather than
guessing from `rec.type`. Known sheet names live in `BID_CELLS` (`main.js:574`): HVAC `Vendor HVAC Bid Sheet`,
Plumbing `Plumbing - Rough & Finish`. Add a pure `resolveBidSheetName(sheetNamesInFile)` that returns the
present one; if both or neither, fall back to the current type-regex guess. Wire into `read-bid-lineitems`
(exceljs already loads the workbook in `readSheetOtherItems`, so sheet names are available).

VERIFY (rule C3, mandatory live test): pure test for `resolveBidSheetName` (HVAC-only list -> HVAC; Plumbing
-> Plumbing; both -> type fallback; neither -> type fallback). Live: a WO with an HVAC folder whose `type`
does NOT match the regex now returns items > 0. Architect: name the concrete WO used for the live test; if
none can be found, say so and mark Bug B unverified rather than claiming a fix.

## Anchors
- Module: `src/remittances.jsx` (state :22, run :41, copyText :219, ReportBlock :344, copyField :359,
  derived counts :245).
- Logic (pure, tested): `src/orders-logic.js` (resolveBidLine :718, isPmListed :1050, categoryLabel :1055).
- Main read path: `main.js` (BID_CELLS :574, WO_ROOT :566, resolveWoFolder :643, latestBidOrCoSheet :716,
  readSheetOtherItems :824, allBidCoSheets :902, read-bid-lineitems :921, trade regex :926).
- Storage: `main.js:472-483` + `preload.js:4` (`window.storage`); usage pattern `src/app.jsx:2992+`.
- Parser runner (unchanged): `remittance-runner.js`.

## Out of scope / deferred
- Tier 2 RazorSync fill bot (fill-only, never-submit, verified blocks only). Separate handoff; milestone 1 =
  prove one field targets correctly on one real WO before any code.
- MSR! sentinel item creation in RazorSync = the user's catalog task, not app code.
