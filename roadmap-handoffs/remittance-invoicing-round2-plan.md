# Remittance round 2 — implementation plan (architect) + overseer dispositions

Companion to `remittance-invoicing-round2.md` (source of truth). Coder executes THIS plan.

## Overseer dispositions (settled with human 2026-07-31)
- OQ1 helper location: APPROVED new root CJS module `bid-select.js` for the two MAIN-PROCESS pure helpers
  (`chooseBidCoFiles`, `resolveBidSheetName`). Reason: `main.js` is CJS and cannot import the ESM
  `orders-logic.js`; precedent = `library_io.js` (pure root CJS, required by `main.js`, tested by direct
  `require`). Tested via `test/bid-select.test.js` (plain require). `sentinelTag` + history reducers stay in
  `orders-logic.js` (renderer side, tested via `test/_load.js`).
- OQ2 RazorSync Price copy: PRE-TAX (`l.pre`). RazorSync re-applies tax on taxable-sentinel lines; copying
  pre-tax avoids double-tax. Non-taxable lines: `pre === post`.
- OQ3 Bug B repro: no WO nameable from repo (folders on user's OneDrive). At live-test time find a WO whose
  `rec.type` misses `/hvac|heat|cool|furnace/i` over an HVAC-only workbook (items 0 -> >0), OR mark Bug B
  UNVERIFIED (rule C3/C4). Fix is correct-by-construction + falls back to current behavior when ambiguous.
- OQ4 line-shape enrichment: non-blocking; `npm run verify` catches regressions. Confirm reconcile tests
  assert per-field, not whole-object deepEqual.

## Sequencing
Items 3 + 4 first (share main.js, pure helpers + tests). Then Item 2 (pure -> UI). Then Item 1. Verify last.

## Item 3 — Bug A: SUPERSEDED. Re-plan required (evidence below)
INVALIDATED 2026-07-31 by direct exceljs dump of the real Airedale folder (WO 03429915). The multi-file
"newest Bid wins" theory is WRONG. Actual mechanism = INTRA-SHEET main-table + OTHER double count.
- `478 Airedale Trail Bid 07-07.xlsx` `Vendor HVAC Bid Sheet`:
  - main-table qty>0 rows: Diagnostic Fee 85 (r17, SKIPPED by main.js:875 regex), Clean Condenser 150 (r25),
    R410a 62.5 (r35), Capacitor Replacement 124.584 (r139).
  - OTHER packed cell (r154 col C): "$85 Service Call $150 Clean condenser coil $124.58 Capacitor ...".
    parseOtherCell splits these into line items. So the SAME work is present in BOTH the catalog table AND the
    OTHER free-text summary (the user hand-writes OTHER for MSR's Salesforce submission).
  - `readSheetOtherItems` sums main-table + OTHER. Dedup key `desc.toLowerCase()+'|'+unitPrice` MISSES the
    overlap: "Clean Condenser"@150 != "Clean condenser coil"@150 (wording), and 124.584 != 124.58 (rounding).
    -> Clean Condenser and Capacitor each counted twice within ONE sheet. Sheet's own TOTAL BID COST r155 =
    572.084; main-table alone = 422.084.
- `478 Airedale Trail Bid 09-07.xlsx`: main-table EMPTY, OTHER EMPTY -> contributes 0. A blank started
  revision. Proves "newest bid" would ZERO the WO.
RE-PLAN DIRECTION (architect to design, not prescribed here):
- The real dup is main-table vs OTHER overlap inside one sheet. Options: treat OTHER free-text as the single
  authoritative itemization (or the main-table) and not sum both; OR merge with a FUZZY dedup that normalizes
  wording (strip filler, compare tokens) and rounds price so "Clean Condenser"@150 == "Clean condenser
  coil"@150. The existing Service-Call skip (main.js:875) is the same idea applied to only one item type.
- Multi-file handling still matters but inverted: an empty/emptier newer revision must NEVER erase an older
  filled bid. Prefer the sheet(s) with real items; do not blind-pick by mtime.
- USER RULE (settled 2026-07-31): MERGE main-table + OTHER as a UNION with FUZZY dedup (normalize wording,
  round price) so overlapping items collapse to one while table-only (R410a) and OTHER-only (Service Call)
  survive. Multi-sheet: PREFER sheet(s) with items; ignore empty/blank revisions; never let an empty newer
  sheet zero the WO. (Not "newest wins".)
- Live proof unchanged: drop SSRS (10)+(12).pdf; Airedale total must equal paid.

## STATE 2026-07-31 (after coder run terminated on account session limit)
Uncommitted work on disk, `npm run verify` GREEN (32 pass):
- Item 1 (persist reducers upsert/remove + hook/panel), Item 2 (sentinelTag + line enrichment category/agreement
  + stepper/copy/WO-prefix in remittances.jsx), Item 4 (resolveBidSheetName wired in main.js) = DONE + passing.
- Bug A = built to the SUPERSEDED plan: bid-select.js `chooseBidCoFiles` is blind newest-wins (zeros a WO on
  an empty revision); NO `dedupeLineItems`; main.js still uses the weak `desc|price` seen-set. bid-select.test.js
  is a FALSE-GREEN to the wrong spec (author-writes-test-agreeing-with-bug). REMAINING WORK = correct Bug A only.

## Overseer dispositions on the Bug A re-plan risks (settled 2026-07-31)
- Risk 1 (extract matchTokens/MATCH_BOILER to root CJS `text-normalize.js`, ESM orders-logic imports it):
  APPROVED. Verified orders-logic.js is consumed ONLY bundled (src/*.jsx imports + tests via loadEsm esbuild
  bridge), never raw ESM in node, so ESM-imports-CJS is safe. GUARD: catalog-match + reconcile-* tests must
  stay green (they exercise matchTokens via resolveInCatalog).
- Risk 2 (multi-sheet rule): DISPOSED. Read every candidate, DROP zero-row sheets, then newest-NON-EMPTY Bid
  supersedes older non-empty Bids + all COs additive; run dedupeLineItems across the merged set. Rationale: a
  re-bid is a restatement; merging two full non-empty bids would double any line whose price was edited between
  revisions (fuzzy dedup recall is imperfect). Airedale has one filled bid so unaffected. No user re-ask.

## Item 3 (OLD, do NOT implement) — Bug A duplicate line items
- 3a. `bid-select.js` `chooseBidCoFiles(files)`: input `[{name, mtime}]` (caller pre-filters to bid|CO).
  Classify CO if `/\bCO\b/.test(name)`, else Bid if `/bid/i`. Return all COs + single newest Bid (max mtime).
  No bid -> all COs. One bid -> that bid (+COs). Pure, no fs/electron.
- 3b. `test/bid-select.test.js` (direct require): two bids+one CO -> newest bid + CO; single bid -> itself;
  only COs -> all COs; multiple bids no CO -> newest only; empty -> empty; equal-mtime tie deterministic.
- 3c. Wire into `read-bid-lineitems` (`main.js:929`): stat each `allBidCoSheets` candidate for time using the
  same approach as `latestBidOrCoSheet:726` (`st.birthtimeMs || st.mtimeMs`); build
  `[{name: basename, mtime, path}]`; pass to `chooseBidCoFiles`; iterate only chosen paths through existing
  `readSheetOtherItems` + `desc|price` dedup (`:933`, keep as second guard).
- 3d. Verify: pure test in `npm run verify`. Live (mandatory): drop SSRS `(10).pdf` + `(12).pdf`; Airedale WO
  03429915 computed total == paid. Coder may ALSO prove at logic level: run a scratch node script that reads
  the CHOSEN files vs ALL files under the real Airedale folder and show the total halves.

## Item 4 — Bug B not detected (HYPOTHESIS)
- 4a. `bid-select.js` `resolveBidSheetName(sheetNames, bidCells)`: pass `BID_CELLS` in (single source of
  truth). Return the canonical sheet name present in `sheetNames`. Both present or neither -> `null` (caller
  falls back to current `rec.type` guess). Pure.
- 4b. Tests (add to `test/bid-select.test.js`) with stub BID_CELLS: HVAC-only -> HVAC; Plumbing-only ->
  Plumbing; both -> null; neither -> null.
- 4c. Wire into `readSheetOtherItems` (`main.js:824-828`): after `wb.xlsx.readFile`, compute
  `names = wb.worksheets.map(w => w.name)`, `resolved = resolveBidSheetName(names, BID_CELLS) || sheetName`,
  use `wb.getWorksheet(resolved) || wb.worksheets[0]`. `read-bid-lineitems` still computes the type-guess
  `sheetName` (`:926-927`) and passes it as fallback (unchanged).
- 4d. Verify: pure tests in `npm run verify`. Live (mandatory, rule C3): see OQ3 — name a real WO and show
  items 0 -> >0, OR mark Bug B UNVERIFIED. Do not claim fixed on pure test alone.

## Item 2 — RazorSync copy QOL
- 2a. Enrich rendered line shape (prereq for sentinelTag). `orders-logic.js`: MSR return (`:876`) add
  `category: it.category` (capture `it.category` into invLines at `:857`) + `agreement: 'MSR'`; AMH return
  (`:945`) add `category: 'labor'` + `agreement: 'AMH'`. Already-known values (reuse, not new computation).
- 2b. `sentinelTag(line)` in `orders-logic.js` near `categoryLabel` (`:1055`), reusing it: 'AMH'->'AMH!',
  'MSR'->'MSR!', 'labor'->'Labor!', 'material'->'Materials!'. Display-only, no new field.
- 2c. Test in `test/catalog-match.test.js` (loadEsm): all four mappings.
- 2d. Per-line click-copy in `ReportBlock` line render (`src/remittances.jsx:411-418`): Description + Price
  copyable via existing `copyText`/`onCopy` (reuse `copyField:359`); render `sentinelTag(l)` chip as a third
  copyable token. Price copies PRE-TAX `l.pre` (OQ2). No new copy plumbing.
- 2e. WO# prefix: header (`:377`) WO# copy copies `'WO ' + value`, displays bare number. Add optional
  transform arg to `copyField` (e.g. `copyField('WO number', b.orderId||b.woId, v => 'WO '+v)`). Copied string
  only; do NOT mutate `woId`/`id`. Invoice#/propId copy sites (`:380-384`) are independent.
- 2f. Copy stepper, one per WO block, inside `ReportBlock` (top-level component; NO inline component, A5):
  ordered fields = `flatten(b.lines.map(l => [sentinelTag(l), l.desc, l.pre]))`.
  `const [cursor, setCursor] = React.useState(0)` — LEGIT user-driven state, NOT an A1/A2 recompute smell; do
  NOT hoist/derive it; comment says so. "Copy next" button copies `fields[cursor]` via `onCopy`, advances
  cursor, renders `Next: <line desc> <field>` label; "Reset" -> `setCursor(0)`. Keep 2d per-field buttons as
  fallback.
- 2g. Verify: pure `sentinelTag` test in `npm run verify`. Live: stepper walks sentinel->desc->price per line;
  WO# copies as `WO <num>`.

## Item 1 — Persist processed remittances (full rehydrate)
- 1a. Pure reducers in `orders-logic.js`: `upsertRemittanceHistory(list, snapshot)` newest-first, de-dupe on
  `source+fileName+invoiceDate` (replace same-key so same-day re-parse does not pile up);
  `removeRemittanceById(list, id)`. Pure.
- 1b. `test/remittance-history.test.js` (loadEsm): insert newest-first; re-insert same key replaces (length
  stable); remove by id drops row; unknown id no-op.
- 1c. `useRemittanceHistory()` hook in `src/remittances.jsx` (top-level, mirrors `useServiceLibraryStore`
  `app.jsx:2986`): load `window.storage.get('remittance_history')` on mount -> array (default `[]`);
  `persist(next)` writes `window.storage.set`. No new IPC/file; single key `remittance_history`.
- 1d. Snapshot on successful `run()` (`src/remittances.jsx:117`, after `setReport`): `snapshot = { blocks,
  statementTotal, fileName, source, id, invoiceDate }`, `id = ${source}-${Date.now()}`, `invoiceDate =
  new Date().toISOString().slice(0,10)`. `persist(upsertRemittanceHistory(history, snapshot))`. Reuse report
  fields; NO parallel fields.
- 1e. `RemittanceHistoryPanel` top-level component (A5), rendered in empty-state area (`:291-299`, shown when
  `!report`). Rows newest-first: `invoiceDate . source . fileName . N match / M flagged` (counts via same expr
  as `:246-247`). Row click -> `setReport(snapshot)`. Per-row delete -> `persist(removeRemittanceById(...))`.
- 1f. Stale-order guard (A-rule): reopen resolves blocks against CURRENT `orders`. Existing lookups already
  guarded (`fetchAmh:150`, `fetchAllAmh:164`+`:176`, saveBlock). Do NOT add a new unguarded `orders.find()` in
  the reopen path; `setReport(snapshot)` reuses guarded sites.
- 1g. Verify: pure reducer test in `npm run verify`. Live (main proof): drop PDF -> snapshot saved -> fully
  RESTART app (not reload) -> history persists -> reopen row -> blocks render -> Bill/Save act on live WOs.

## Done-gate
`npm run verify` (lint + build:renderer + node test/run.js) GREEN, covering new pure tests: `bid-select.test.js`
(Bug A+B), `sentinelTag` in `catalog-match.test.js`, `remittance-history.test.js`. Use `verify-wo-tracker`
skill as honesty gate. GUI-only live checks (persistence restart, stepper, copy, PDF drops) that the coder
cannot run headless: list them explicitly for the user; do NOT claim them done.
