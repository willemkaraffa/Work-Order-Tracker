---
name: verify-wo-tracker
description: The done-gate for any code change in the Work Order Tracker. Use this whenever you are about to claim a fix works, say something is "done"/"fixed"/"verified", finish a bug fix, or the user says test/verify/check this. Also use before committing or releasing. It defines what must actually be run before a claim of success is honest.
version: 0.1.0
---

# Verify (Work Order Tracker)

The full protocol lives in `roadmap-handoffs/qa-protocol.md`. Read it for the per-change
flow and the pre-commit checklist. This skill is the short path: what to run, and what a
claim of "done" actually requires.

It exists because fixes kept landing unsatisfactory. The root causes were structural, not
careless: no runnable gate, tests that mirrored copied logic and went false-green, and
"looks right" reported as "verified". Running the gate is what separates a fix from a
guess.

## The gate

```
npm run verify      # build:renderer + all tests. Must PASS before "done".
npm test            # all tests
npm run test:logic  # fixture-free subset, portable, always runnable
```

Per-test exit codes: `0` pass, `1` fail, `2` SKIP. A skip is not a failure. Fixture tests
self-skip when a DOM dump is absent so the gate stays green on any machine. Do not "fix" a
skip by deleting the test.

The build half matters as much as the tests: it catches JSX and esbuild errors that tests
never reach.

## What a change owes you

**Pure logic** (order, phase, age, migration, extraction) belongs in a leaf module such as
`src/orders-logic.js`, not buried in `app.jsx`. Not for tidiness: logic inside a component
cannot be imported, so it cannot be tested, so it drifts.

**Tests import the shipped code.** Load it through the `test/_load.js` esbuild bridge. Never
hand-copy app logic into a test. That already happened here: the copy drifted from the real
module and the suite passed green while the app was broken. A test that contains its own
copy of the logic is testing itself.

**Renderer or lifecycle changes** need `test/renderer-smoke.test.js` AND a look at the real
app (electron, or the preview tools). A static read cannot see a component that mounts,
unmounts, and loses focus. If the change is observable in the UI, observe it.

## Reporting honestly

Say "verified" only if you ran it. If you could not run it, say **"static analysis only,
not run"** and let the user decide whether the test is worth the cost. A confident false
claim is more expensive than an admitted gap, because it stops anyone else from looking.

After a fix, name the ROOT CAUSE, not the symptom. A symptom-only summary hides the debt
from the next reader, who is usually you.
