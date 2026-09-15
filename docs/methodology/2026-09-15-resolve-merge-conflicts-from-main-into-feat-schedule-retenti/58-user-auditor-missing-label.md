---
at: 2026-09-15T17:19:33.123Z
role: user
action: auditor-missing-label
model: human
outcome: tp
---

## user / auditor-missing-label

### Instruction sent (verbatim)

```text
The Auditor found no plan text covering this point. Is it truly missing from the plan?

Item item-7: Conflicts are resolved by a coder subagent under an approved plan (the user-authority gate requires one for scraper files).
The Auditor said: MISSING
Exact evidence: (none given)
The plan, in full:
  goal: Intent record: merge main into feat/schedule-retention
  scope: scrape_amh.py, extension/background.js, extension/content.js, test/renderer-smoke.test.js, package.json, package-lock.json, HISTORY.md, NEXT-STEPS.md, docs/changes/*, docs/methodology/**
  step 1: Assert .git/MERGE_HEAD exists (expected d7ddf93 / origin/main). Do not merge --abort, reset, or commit. If MERGE_HEAD is missing, stop and report; do not start a different merge.
  step 2: Resolve scrape_amh.py: keep this branch's one-WO hydrate_customers(token: str, item: dict) -> dict and per-WO build_wo(hydrate_customers(token, item)) in the bulk loop and single-WO path. Delete main's list-valued hydrate_customers, both hydrate_customers(token, [ call sites, and the ThreadPoolExecutor import. Keep main's build_wo warnings including 'no contact (phone/name) on this WO' and the no-street warning. git add scrape_amh.py.
  step 3: Resolve extension/content.js: keep this branch's find-new handler and isMSRListPage() (open list tab only; must contain 'scanned host list'; must not contain 'find-new: via='). Keep main's ping handler with onList from isMSRListPage() (literal 'onList: isMSRListPage()'). Keep main's loadInIframe(url, kind) for capture paths. git add extension/content.js.
  step 4: Resolve extension/background.js: keep main's const POLL_MINUTES = 1, get-then-create alarm at top level, and drain on worker spawn; delete this branch's periodInMinutes: 0.5. Find-new bail: this branch's list-aware message via function isMsrListUrl plus main's 'find-new: BAIL' log. git add extension/background.js.
  step 5: Resolve test/renderer-smoke.test.js by keeping this branch's version (clear App intervals, stub fetch, assert error boundary did not catch, seed Admin S1 note migration). Drop main's duplicate window list and watchdog. git add test/renderer-smoke.test.js.
  step 6: Run the intent C1/A1/A2/M1/M2 one-liners (not verifyBudget). If test/amh-hydrate-customers.test.js (out of scope) asserts a list-valued hydrate API, stop and report; do not edit it or any file main merged cleanly.
  step 7: Run exactly: npm install github:willemkaraffa/Project-Overseer#294bac8. No other package.json edits. Confirm L1 (dependency ends with #294bac8 and lock packages['node_modules/project-overseer'].resolved ends with #294bac8dabd1c4296f28e7a0fe079e83caff2232). git add package.json package-lock.json.
  step 8: Append this merge's line to HISTORY.md (existing style). Update NEXT-STEPS.md to the remaining user live checks (one MSR Find new on an open list tab; one Capture all AMH). Write docs/changes/2026-09-15-merge-main-into-schedule-retention.md. Do not unstage main's cleanly merged files to shrink the review.
  step 9: Stage HISTORY.md, NEXT-STEPS.md, and the changelog entry now, before any fidelity ruling. Leave MERGE_HEAD in place; do not git commit.
  step 10: Run T1: node test/renderer-smoke.test.js (expect exit 0 and ALL PASS). Then I1: node test/run.js (expect exit 0 and ', 0 fail'). These two are the verifyBudget. Then ST1: node node_modules/project-overseer/scripts/overseer-status.js (expect exit 0, contains 'gates ARE enforcing', lacks GAP).
  step 11: File after-observation records under docs/methodology/ for L1, C1, A1, A2, M1, M2, T1, ST1, I1 (reuse docs/methodology/_pending/ befores). Do not commit.

[auditor-missing plan-2026-09-15-intent-record-merge-main-into-fe item-7]
```

### Reply received (verbatim)

```text
Truly missing
```
