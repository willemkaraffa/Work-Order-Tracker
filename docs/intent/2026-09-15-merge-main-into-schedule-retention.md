# Intent record: merge main into feat/schedule-retention

STATUS: approval lives in `2026-09-15-merge-main-into-schedule-retention.approval.json`,
never in this line. Proposed 2026-09-15.
Origin: the user's request to merge `main` (d7ddf93) into `feat/schedule-retention`
(f71bbf6), held on 2026-09-14 until Project Overseer judged merge commits by what they
add (PO slice 12, 294bac8), then held again until the plan gate was merge-aware (PO
slices 13-15, 6fdba72), and again until the changelog writer handled merges (PO slice 16,
0769989).

---

## Part A: the user's words, verbatim

**2026-09-14.**
> "merge main into feat/schedule-retention"

> "Option 1 I was just trying to capture AMH work orders"

> "The capture worked"

**2026-09-15.**
> "PO fix implemented. Claude full restarted"

> "PO main is now 294bac8 (slice 12: during a merge, falsification, changelog and fidelity count only files that differ from BOTH parents, so main's 70 po-frame-hooks records and its docs/changes entry no longer count). Finish the in-progress merge of main into feat/schedule-retention:"

> "Keep MERGE_HEAD. Update the project-overseer dependency to 294bac8 (npm install github:willemkaraffa/Project-Overseer#294bac8)."

> "PO main is now 6fdba72 (slices 13-15: Architect plans against Auditor's checklist; re-checks carry proven items; plan gate and changelog writer merge-aware, plan's own intent record always in scope). Keep MERGE_HEAD."

> "Before installing: revise the merge intent record (L1 and its wording pin 6fdba72, not 294bac8), get approval, re-observe before, redraft the plan, run the Auditor, approve the plan."

> "Then: npm install github:willemkaraffa/Project-Overseer#6fdba72, check node_modules/project-overseer/package.json says 0.16.0, run node node_modules/project-overseer/scripts/plan-check.js, then review, changelog entry, HISTORY.md line, fidelity, commit."

> "If the Auditor marks items MISSING, do not label them; re-check once first."

> "PO main is now 0769989 (slices 13-16). Slice 16: during a merge, an entry or methodology folder either parent committed is history, so changelog.js mints the merge's own entry and folder and never reuses main's. Keep MERGE_HEAD."

> "Revise the merge intent record so L1 and its wording pin 0769989; get approval; re-observe before; redraft the plan; run the Auditor; approve the plan."

> "Then: npm install github:willemkaraffa/Project-Overseer#0769989, check node_modules/project-overseer/package.json says 0.17.0, run plan-check.js, review, changelog.js (must write a NEW 2026-09-15 entry), HISTORY.md line, fidelity, commit."

> "Stage HISTORY.md, NEXT-STEPS.md and the changelog entry BEFORE the fidelity ruling."

> "Expected: the review still reads main's code (~86k chars, under budget); that is slice 12's stated limit, not a failure."

---

## Part B: the Overseer's interpretation

Subordinate to Part A.

### B1. Verified state (read 2026-09-15)

- `feat/schedule-retention` is at f71bbf6; `origin/main` at d7ddf93 (PR #20, the Project
  Overseer migration). Merge base 55cac40.
- `git merge --no-commit --no-ff origin/main` conflicts in 4 files; everything else
  merges cleanly:
  - `scrape_amh.py`: both sides added `hydrate_customers` (refill AMH contacts from the
    single-WO endpoint). This branch (de86cb9, 2026-08-21) takes one WO and returns it,
    called per WO inside the bulk loop; `main` (6d28a15, 2026-08-19) takes a list and
    runs 8 lookups at once. Git auto-merged `main()` so that it calls BOTH signatures
    (`hydrate_customers(token, [..])` and `build_wo(hydrate_customers(token, item))`),
    which breaks AMH capture whichever definition is kept. `main` also added
    `build_wo` warnings for a WO with no contact or no street (auto-merged, no conflict).
  - `extension/background.js`: both sides re-arm the command poll alarm at top level
    (this branch at 0.5 min; `main` at `POLL_MINUTES = 1`, Chrome's real floor, plus a
    drain on worker spawn). In the find-new bail, this branch has one branch naming
    whether Amherst is open but not on a list page; `main` logs each bail.
  - `extension/content.js`: MSR "Find new". This branch (8629614, 40ffcc8, 2026-08-25)
    scans only the list tab the user has open; `main` (aaa58b6, 2026-08-19) scans the
    open tab when it is the assessment/pending list, else loads that list in a hidden
    iframe. `main`'s `ping` handler (for its `woDiag` probe) judges "on a list" by a
    different rule than this branch's `isMSRListPage()`.
  - `test/renderer-smoke.test.js`: both sides fixed the same exit crash (close the jsdom
    windows, set `exitCode` instead of `process.exit`). This branch's version also clears
    the App's intervals, stubs fetch, asserts the error boundary did not catch, and seeds
    the Admin S1 note migration.
- The merge stages `main`'s 70 methodology records; PO 294bac8 counts only files that
  differ from both parents, so they are not this commit's claim set.
- `package-lock.json` pins PO c054612 on `main` and a588d17 here; `package.json` names
  `github:willemkaraffa/Project-Overseer` unpinned on both.
- After `npm install github:willemkaraffa/Project-Overseer#294bac8`: `package.json` names
  `#294bac8`, the lock resolves `#294bac8dabd1c4296f28e7a0fe079e83caff2232`, and the
  installed `scripts/` (36), `hooks/` (11), `git-hooks/` (2) and `templates/` (3) match
  PO 294bac8's tree file for file (no TAR_ENTRY_ERROR loss); `falsification-check.js`
  has `mergeHeads`. Its `stagedPaths()` lists only the 4 conflicted files,
  `package.json` and `package-lock.json`: none of `main`'s methodology records.
- Pinned at 294bac8, `plan-check.js` compared the whole index with HEAD: 17 staged files
  counted as outside the plan's scope, 15 of them arriving from `main` unchanged plus
  this record and its approval. PO 6fdba72 (package version 0.16.0) makes the plan gate
  and the changelog writer merge-aware and keeps a plan's own intent record in scope.
- Pinned at 6fdba72, `changelog.js` took `main`'s entry
  (`docs/changes/2026-09-14-consume-shared-gates-and-git-hooks-directly-from-project-ove.md`,
  absent from HEAD) for this commit's: it overwrote that entry and filed this merge's 51
  methodology records into `main`'s folder. Contained the same day: the entry and folder
  were restored and match MERGE_HEAD in the index and the tree (re-checked 2026-09-15),
  and the 51 records sit staged in `docs/methodology/_pending/`. PO 0769989 (package
  version 0.17.0, slice 16) treats an entry or folder either parent committed as history.
- AMH "Capture all AMH" on this branch was live-tested by the user on 2026-09-14 and
  worked.

### B2. What gets built (the merge's own work)

1. **AMH, this branch's refill** (user ruling): keep the one-WO `hydrate_customers`,
   called per WO in the bulk loop and the single-WO path; drop `main`'s list version,
   its two calls in `main()`, and its now-unused `ThreadPoolExecutor` import. Keep
   `main`'s "no contact" / "no street" warnings in `build_wo`.
2. **MSR find-new, open list tab only** (user ruling): keep this branch's find-new
   handler and `isMSRListPage()`; drop `main`'s iframe fallback in that handler. `main`'s
   `ping` handler stays, with `onList` from `isMSRListPage()` so `woDiag` and the scan
   agree on what a list page is. `main`'s `loadInIframe(url, kind)` readiness rule stays
   for the capture paths, which still use iframes.
3. **MSR poll alarm:** `main`'s block (`POLL_MINUTES = 1`, get-then-create at top level,
   drain on spawn); this branch's duplicate 0.5-minute line is dropped. Find-new bail:
   this branch's list-aware message, with `main`'s bail log line.
4. **Renderer smoke test:** this branch's version; `main`'s duplicate window list and
   watchdog are dropped.
5. **Project Overseer pinned to 0769989** (`npm install
   github:willemkaraffa/Project-Overseer#0769989`, per the user, after the plan is
   approved), in `package.json` and the lock; the installed `package.json` must say
   0.17.0. So this commit is gated by the slices that judge merges, merge-aware plan
   scope, and a changelog writer that mints the merge's own entry. `changelog.js` must
   write a NEW 2026-09-15 entry; `main`'s entry and folder must still match MERGE_HEAD.
6. `HISTORY.md` gains this merge's line; `NEXT-STEPS.md` is updated; this record, its
   approval and the merge's methodology records.
7. Conflicts are resolved by a coder subagent under an approved plan (the user-authority
   gate requires one for scraper files).

### B3. Honest limits

- The Reviewer still sees everything against HEAD, including code `main` already
  reviewed (PO slice 12 B3; about 86,000 characters, under budget). `plan-check.js` is
  merge-aware from PO 6fdba72.
- MSR find-new and the alarm are extension code; the suite does not run them. The user's
  live check after the merge is the proof: one "Find new" on an open MSR list tab and
  one "Capture all AMH".
- Role-definition files (`.claude/settings.json`, `overseer.json`, `.githooks/`) arrive
  from `main` unchanged; the user approved them on this branch on 2026-09-14 (Part C).

---

## Part C: questions for the user, and the rulings

2026-09-14, AskUserQuestion answers, verbatim:
> "Approve" (the role-definition changes from `main` on this branch)
> "Capture AMH now, merge later (Recommended)"

2026-09-15, AskUserQuestion answers, verbatim:
> "Merge PO PR #9 (Recommended)"
> "Open list tab only (Recommended)"
> "This branch's, one by one (Recommended)"

The user first asked whether "one by one" meant bulk capture ran in sequence; the answer
given: both are bulk, and only the contact lookup inside it runs one WO after another
here, 8 at once on `main`.

The first approval question for this record was dismissed; the user's next message
(Part A, "Finish the in-progress merge") restated the steps, and this revision follows
it: the dependency is pinned in `package.json` by the user's own command.

Asked how to clear the plan gate's 17 out-of-scope files, the user answered
(AskUserQuestion, verbatim):
> "PO fix first"

PO 6fdba72 is that fix; the latest instruction in Part A resumes here and pins it.

Revising this record for 6fdba72, the approved plan's scope blocked the edit, and the
Architect escalated a one-file widen to the human. The user answered (AskUserQuestion,
verbatim):
> "Redraft plan first (Recommended)"

Asked how to proceed after the 6fdba72 changelog writer overwrote `main`'s entry, the
user answered (AskUserQuestion, verbatim):
> "PO fix first"

PO 0769989 is that fix; the latest instruction in Part A resumes here and pins it.

---

## Part D: success criteria

```observation
id: L1-po-pinned-0769989
run: node -e "const p=require('./package.json');const d=(p.devDependencies||{})['project-overseer']||(p.dependencies||{})['project-overseer']||'';process.exit(d.endsWith('#0769989')&&require('./package-lock.json').packages['node_modules/project-overseer'].resolved.endsWith('#076998966d6e94e7523c569aced0185dbc9e55e2')&&require('./node_modules/project-overseer/package.json').version==='0.17.0'?0:3)"
before: exit 3
after: exit 0
```

```observation
id: C1-no-conflict-markers
kind: invariant
run: node -e "const fs=require('fs');process.exit(['scrape_amh.py','extension/background.js','extension/content.js','test/renderer-smoke.test.js'].some(f=>/^(<<<<<<<|>>>>>>>) /m.test(fs.readFileSync(f,'utf8')))?3:0)"
expect: exit 0
```

```observation
id: A1-amh-one-refill
run: node -e "const s=require('fs').readFileSync('scrape_amh.py','utf8');const n=(s.match(/def hydrate_customers\(/g)||[]).length;process.exit(n===1&&s.includes('def hydrate_customers(token: str, item: dict) -> dict')&&!s.includes('ThreadPoolExecutor')&&!s.includes('hydrate_customers(token, [')&&s.includes('build_wo(hydrate_customers(token, item))')&&s.includes('no contact (phone/name) on this WO')?0:3)"
before: exit 3
after: exit 0
```

```observation
id: A2-amh-parses
kind: invariant
run: python -c "import ast;ast.parse(open('scrape_amh.py',encoding='utf-8').read())"
expect: exit 0
```

```observation
id: M1-msr-open-tab-scan
run: node -e "const s=require('fs').readFileSync('extension/content.js','utf8');process.exit(s.includes('scanned host list')&&!s.includes('find-new: via=')&&s.includes('onList: isMSRListPage()')?0:3)"
before: exit 3
after: exit 0
```

```observation
id: M2-msr-alarm-and-bail
run: node -e "const s=require('fs').readFileSync('extension/background.js','utf8');process.exit(s.includes('const POLL_MINUTES = 1')&&!s.includes('periodInMinutes: 0.5')&&s.includes('function isMsrListUrl')&&s.includes('find-new: BAIL')?0:3)"
before: exit 3
after: exit 0
```

```observation
id: T1-smoke-test
kind: invariant
run: node test/renderer-smoke.test.js
expect: exit 0; contains "ALL PASS"
```

```observation
id: ST1-status-enforcing
run: node node_modules/project-overseer/scripts/overseer-status.js
before: exit 1; contains "GAP"
after: exit 0; contains "gates ARE enforcing"; lacks "GAP"
```

```observation
id: I1-suite-stays-green
kind: invariant
run: node test/run.js
expect: exit 0; contains ", 0 fail"
```

**Scope** (the merge's own work). `scrape_amh.py`, `extension/background.js`,
`extension/content.js`, `test/renderer-smoke.test.js`, `package.json`,
`package-lock.json`, `HISTORY.md`, `NEXT-STEPS.md`, `docs/intent/`, `docs/changes/`,
`docs/methodology/`. Everything else arrives from `main` as it was committed there.

**Non-goals.** No change to any file `main` merges cleanly. No new MSR or AMH behaviour
beyond choosing between the two existing versions. No `package.json` change beyond the
Project Overseer pin.

**Falsifier.** Wrong if, after it lands, "Capture all AMH" loses phones or contact names,
MSR "Find new" fails on an open list tab, the suite goes red, or `overseer-status.js`
reports a GAP.

**Done.** `npm run verify` green; every observation flipped or held as predicted and filed
verbatim; reviewer findings dispositioned; plan approved; fidelity ruled; the user's live
check of "Find new" and "Capture all AMH".
