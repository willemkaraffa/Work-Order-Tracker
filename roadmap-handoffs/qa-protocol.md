# QA Protocol — Work Order Tracker

Why this exists: fixes kept landing unsatisfactory. Root causes were structural —
no runnable test gate, tests that mirrored copied logic (false green), machine-local
fixtures, and "looks right" claimed as "verified". This is the routing every change
goes through so those failure modes can't recur silently.

## The gate (one command)

```
npm run verify     # build:renderer + run all tests. MUST pass before "done".
npm test           # all tests
npm run test:logic # fixture-free subset (portable, always runnable)
```

Exit codes per test: `0` pass, `1` fail, `2` SKIP (e.g. DOM fixture absent — does not fail the gate).

## Per-change flow

1. **Before the fix — log + scope.**
   - Bug sweep: write the symptom to a `roadmap-handoffs/` handoff before touching code.
   - A reported case is a SYMPTOM. `grep` for the shared pattern and fix the CLASS, not the one example. List every site you found.

2. **Before code — define the check.**
   - Write the failing test, or write the render/state trace on paper (CLAUDE.md C1).
   - Pure logic (order/phase/age/migration/extraction)? It belongs in a leaf module
     (`src/orders-logic.js`, `scraper-extract.js`) and gets a test that imports the
     SHIPPED code via `test/_load.js`. Never hand-copy logic into a test.

3. **Write the change.** Surgical. Reuse an existing field before adding state
   (grep first). Port mechanism, not surface.

4. **After code — verify, don't guess.**
   - `npm run verify` green.
   - Observable UI change → also run the real app (electron / preview tools) and
     confirm the behavior. Renderer lifecycle change → `test/renderer-smoke.test.js`.
   - Could not run it? Say "static analysis only — not run." Do not say "verified".

5. **Pre-commit mental gate** (CLAUDE.md section E), as checkboxes:
   - [ ] Ran the code path, or traced it stepwise.
   - [ ] The failure mode I flagged in review got tested (not just noted).
   - [ ] No new `useEffect` → `setState(derived)` shadow (A1).
   - [ ] No ref-attached element behind a render guard (A3).
   - [ ] Copied a hook block? Wrote its invariant down (B1).
   - [ ] No inline component defs in render (A5).
   - [ ] Cleanup matches setup (A6, A7).
   - [ ] Report names the ROOT CAUSE, not the symptom.

## Test layout

- `test/run.js` — runner. Globs `test/*.test.js`, spawns each, aggregates exit codes.
- `test/_load.js` — esbuild ESM→CJS bridge. `loadEsm('src/orders-logic.js')` returns the
  real shipped exports so tests can't drift from the app.
- `test/fixtures/` — committed DOM dumps for scraper tests. Fixture tests self-SKIP
  (exit 2) when a required dump is absent, so the gate stays green on any machine.
- Logic tests: `change11` (orders/phase/age/migration), `stress` (extractor edges),
  `scraper-surface` (extractor export shape), `renderer-smoke` (App mounts clean).
- Fixture tests: `extract`, `full-flow`, `contacts`, `expand-static`, `wo9718400`.

## Known gaps (honest)

- The change11 reconciler and the WO action handlers (markComplete/reopen/…) are still
  INLINE in component effects/handlers in `app.jsx`; `change11.test.js` tests local
  distillations of them. Extracting those into `orders-logic.js` would close the last
  drift gap — do it when next touching that code.
- `renderer-smoke` asserts mount-without-crash only. The note-card input-lock regression
  has a labeled slot there awaiting a jsdom interaction harness for the command center.
- Re-capture the missing AMH dumps (full-flow / wo9718400 / expand-static sets) into
  `test/fixtures/` to light up those skipped tests.
