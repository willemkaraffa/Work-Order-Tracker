---
name: warn-test-logic-drift
enabled: true
event: file
conditions:
  - field: file_path
    operator: regex_match
    pattern: test[\\/].*\.test\.js$
  - field: new_text
    operator: not_contains
    pattern: _load
---

**Test file written without importing shipped code.**

Logic tests MUST import the real shipped code through `test/_load.js` (the esbuild
bridge). Hand-copying app logic into a test produced false-green tests before: the
copy drifted from `src/orders-logic.js` and the suite passed while the app was
broken.

**Fix:**
- Import the real module via `test/_load.js`. Do not paste logic into the test.
- Pure order/phase/age/migration logic belongs in `src/orders-logic.js`, not buried
  in `app.jsx`, so it stays importable.

False positive if this is a DOM-fixture or renderer-smoke test that legitimately does
not load logic modules. Say which, and continue.
