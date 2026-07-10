# Quality Improvement Roadmap — 2026-07-09

Goal: raise the QUALITY of what is already built (not productization). Scores are the
2026-07-09 developer assessment. Each module: current -> target, then concrete moves
ranked by leverage. Product/generalizability work is deferred to the appended section.

Guiding rule (CLAUDE.md): surgical, tested (`npm run verify` gate), reuse existing code.

---

## Cross-cutting (do these first — they lift every module)

1. **ESLint in the verify gate.** No linter today; the dead `setTechs` prop (a passed-but-
   not-destructured button) slipped through. Add `eslint` + `eslint-plugin-react-hooks`
   (exhaustive-deps, no-unused-vars, react/jsx-no-undef) to `npm run verify`. Auto-catches
   the whole dead-prop / stale-dep / unused class. Highest ROI, one-time.
2. **Error surfacing.** Audit `catch` blocks on USER actions (capture, folder, export,
   invoice save) — they must toast, not swallow. Silent failures read as "button broken".
   (Pure browser-API catches like setSelectionRange stay silent — fine.)
3. **JSDoc types on the money/reconcile paths.** No TS. Add `// @ts-check` + JSDoc to
   orders-logic.js (computeInvoiceTotals, reconcile*, recomputeInvoice) so editors catch
   shape drift on the highest-risk code without a TS migration.
4. **Renderer/flow tests.** renderer-smoke mounts the app; extend to drive the money flows
   (bill matched, recompute, save invoice) via the real components, not just pure logic.

---

## AMH scraper — 5 -> 7.5  (biggest gap + top operational risk)

- **Version probe at launch.** Read Edge/msedgedriver versions in make_driver; if headless
  support / driver-browser major mismatch, FAIL LOUD with the versions (the Edge-150 /
  driver-149 drift already bit us). Today failures are opaque "Chrome instance exited".
- **Retry + backoff** on `Order/Query` (transient 5xx / token expiry) instead of one shot.
- **Explicit aged-out UX.** The 100-order window is a hard external cap; surface "N WOs
  aged out — enter manually" as first-class state, not a per-block flag.
- **Token/session health check** before the full run; re-login proactively if stale.
- **Structured stderr -> UI.** Pipe scrape_amh phase logs to a capture-status detail line
  so a hang is legible.
- Note: headed-off-screen + pythonw fixes (this session) are in; keep the fallback ladder
  documented in scrape_amh.py.

## Detail / command center — 6.5 -> 8

- **Resolve the text lock-out** (bug_note_card_input_lock). Gated on a live `__lockDebug()`
  capture; leading theory now = Electron webContents focus death (clicks don't restore).
  Until captured, do NOT blind-patch. This bug alone caps the module.
- **Reduce focus juggling.** Several explicit-focus effects paper over React-18 commit
  timing; consolidate into one focus helper to shrink the surface that spawns focus bugs.

## Remittances / Invoices — 7 -> 8

- **Tune the IDF suspect scorer.** Measure false-positive rate on the live 250-item catalog
  (scratchpad/matchrate.js exists); raise MATCH_MIN_COVER / SOLO_IDF until red flags are
  trustworthy. Fewer false alarms = the flag means something.
- **Flagged-review queue.** A single list of every invoice line still carrying priceFlag
  across all WOs, so review isn't per-WO archaeology.
- **Provenance on the invoice.** Stamp which remittance (EFT/statement + date) billed a WO,
  so an invoice's origin is auditable.
- **End-to-end tests** for bill-matched + recompute + auto-bill (pure cores tested; the
  wiring is not).

## Service Library — 7 -> 8

- **jszip-patch the xlsx seed/export** (memory lesson_xlsx_surgical_patch: never exceljs-
  re-serialize a complex template). The remittance EXPORT is a fresh workbook (safe), but
  library seed/import touches templates.
- **Validate on import** (required columns, numeric prices) with a clear reject message.
- **Test parseMsr** (the col-C prose -> taxable derivation) against a fixture.

## Maps — 7 -> 8

- **Consolidate geocode providers** (locationiq/nominatim/photon/census branches) behind one
  adapter; unit-test `evaluate`/suspect scoring (city-mismatch logic).
- **Rate-limit / 429 handling** with backoff; today a burst can silently null-result.

## Settings — 7 -> 8

- **Audit ALL prop wiring** beyond the Settings sections (the setTechs class) — grep every
  `set*` prop passed vs destructured across components. ESLint (unused-vars on the child +
  no-undef) catches most automatically.
- **Test the list reducers** (phases/statuses/techs/types add-rename-delete-reorder).

## Itinerary / routing — 6 -> 7.5

- **Extract routing/weight math to pure functions** in a tested module (today it's in the
  component). Then the tech-preference ranking is unit-testable.
- **Live-verify drag-schedule** (the least-exercised interactive path).

## MSR capture (extension) — 6 -> 7

- **Clear "no MSR list tab open" error** instead of a silent no-op.
- **Parse tests** for the on-page scrape shape.

## Data / persistence — 7.5 -> 8.5

- **Schema-validate on load** (shape-check orders/settings; quarantine + report bad records
  rather than crash or silently drop).
- **Corruption guard** around the single-file store (atomic write + last-good backup on
  parse failure). Backups exist; add the read-side guard.

---

## Suggested order (leverage-ranked)

1. ESLint-in-verify (catches a whole defect class, one-time).
2. Text lock-out (after live capture) — unblocks Detail.
3. AMH version-probe + loud failure — kills the recurring capture saga.
4. IDF scorer tuning + flagged-review queue — invoicing trust.
5. Error surfacing pass + JSDoc on money paths.
6. Flow tests (bill/recompute/reconcile) + data schema-validate.
Everything else opportunistic.

---

# APPENDED: Generalizability (FUTURE / back-burner — not now)

Recorded so it isn't lost; explicitly deferred per user. Turning this bespoke tool into
something other vendors could use requires de-hardcoding the business, NOT more polish.

- **Client/PM config, not literals.** `AMH` / `MSR` are hardcoded across constants,
  CATALOG_TAX, resolveBidLine sentinels, scrapers, folder logic. Generalizing means a
  per-client config object: {name, taxMode (inclusive/additive), catalog, remittance parser,
  capture adapter, folder template}. Biggest lift by far.
- **Pluggable capture.** AMH (Edge+API) and MSR (Chrome extension) are bespoke adapters.
  A product needs a capture interface + graceful "manual entry" default when no adapter.
- **Invoice OUTPUT target.** RazorSync is manual copy-paste today. A product needs an export/
  API to whatever billing system the user runs (or a generic PDF/CSV invoice).
- **Cross-platform + no hardcoded paths.** Windows + OneDrive Desktop paths are baked in.
- **Multi-user / sync / auth.** Single local JSON file today. A product needs accounts,
  a server or sync layer, and conflict handling.
- **Onboarding.** A setup wizard (client, tax rule, folders, catalog seed) replaces the
  current "it already knows your business" assumption.
- **Config-drive the tax core-truths.** They are correct but AMH/MSR-specific; a general
  tool exposes tax rules as per-client settings, not code constants.

Sequence if ever pursued: (1) extract a Client config abstraction and route existing AMH/MSR
through it (prove with the 2 real clients) -> (2) capture-adapter interface -> (3) invoice
output -> (4) sync/auth -> (5) onboarding. Steps 1-2 are the real moat; the rest is standard
app plumbing.
