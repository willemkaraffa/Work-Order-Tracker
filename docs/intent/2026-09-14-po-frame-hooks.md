# Intent record: this project runs Project Overseer's shipped gates, not local copies

STATUS: approval lives in `2026-09-14-po-frame-hooks.approval.json`, never in this line.
Proposed 2026-09-14; first approved at 76cf32169344; its fidelity ruling looped back
(Part C); revised 2026-09-14 for PO 06340fa (slices 9 and 10), re-approved at
9d9c9591e3c0, held on the lockfile budget (Part C); revised 2026-09-14 for PO c054612
(slice 11).
Origin: Project Overseer `NEXT-STEPS.md` item 3, slice 7 rulings Q1 and Q2
(`C:\dev\Project-Overseer\docs\intent\2026-09-11-slice-7-migrate-gates.md` Part C),
and PO slice 9 (`docs/intent/2026-09-14-slice-9-project-independence.md`).

---

## Part A: the user's words, verbatim

**This session, 2026-09-14, first instruction.**
> "PO PR #6 merged (6400a32)."

> "user ruled 2026-09-14: keep user-authority-check.js as 7th pre-commit gate after template's six; work in this worktree off main."

> "update project-overseer lock to 6400a32; remove .claude/hooks/{coder-role-gate,spawn-limiter,commit-authority-gate}.js; point .claude/settings.json at node_modules/project-overseer/hooks/ (+SessionStart session-start.js); refresh .githooks/pre-commit and add post-checkout from templates/; fix 3 tests that load the removed copies; drop the 3 from overseer.json guards + roles.locked; bootstrap HISTORY.md, NEXT-STEPS.md, docs/changes, docs/intent, docs/methodology."

> "Unlock locked files via role-lock question per path."

**This session, 2026-09-14, resume instruction.**
> "PO main is now 06340fa (slices 9 and 10). Resume the held migration on chore/po-frame-hooks:"

> "Update the project-overseer dependency to 06340fa; confirm node_modules/project-overseer holds git-hooks/, hooks/user-dispatch.js, scripts/transcripts.js (a global npm install of it hit TAR_ENTRY_ERROR today; verify the files, never assume)."

> "Replace .githooks/pre-commit and post-checkout with node_modules/project-overseer/templates/ stand-ins; move user-authority-check.js into overseer.json"

> "Stage HISTORY.md, NEXT-STEPS.md and the changelog entry BEFORE the fidelity ruling: the Architect now sees them, every staged file whole, and the human's answers as facts."

> "Review, triage, fidelity, commit through the gates. Check with overseer-status.js."

**This session, 2026-09-14, second resume instruction.**
> "PO main is now c054612 (slices 9, 10, 11). Resume the held migration on chore/po-frame-hooks:"

> "Update the project-overseer dependency to c054612; verify node_modules/project-overseer holds git-hooks/, hooks/user-dispatch.js, scripts/transcripts.js (a global npm install of PO hit TAR_ENTRY_ERROR; check files, never assume)."

---

## Part B: the Overseer's interpretation

Subordinate to Part A. A later instruction supersedes an earlier one where they differ:
the lock goes to c054612, not 6400a32 or 06340fa; the git hooks become stand-ins, not full copies;
the seventh gate moves from `.githooks/pre-commit` into `overseer.json`.

### B1. Verified state

At the branch base (main 98895f4), read 2026-09-14:
- `package-lock.json` resolves `project-overseer` to a588d17.
- `.claude/hooks/` holds local copies of coder-role-gate, spawn-limiter and
  commit-authority-gate. Against PO they differ only in header comments, plus
  `spawn-limiter.js` loading `user-grant.js` through `node_modules/project-overseer/scripts/`.
- `.claude/settings.json` registers the local copies; no SessionStart hook.
- `.githooks/pre-commit` is an old full copy running branch, verify, review, plan and
  `user-authority-check.js`. No `post-checkout`.
- The three gate tests load `.claude/hooks/<gate>.js`.
- `overseer.json` lists the three under `guards` and `roles.locked`; no `preCommitGates`.
- No `HISTORY.md`, `NEXT-STEPS.md` or `docs/`.
- `package.json` declares `playwright ^1.62.1`; the lock has no playwright entry.
- PO 06340fa's `overseer-status.js`, pointed at the base, reports 5 GAPs (session-start
  review, old full-copy pre-commit, falsification, fidelity and project gates not in
  the active pre-commit) and exits 1.

The PO c054612 install, read 2026-09-14 after `npm update project-overseer`: the lock
resolves `#c0546127219cbf249efe925afbc1f0fe60e52b44`; `git-hooks/pre-commit`,
`git-hooks/post-checkout`, `hooks/user-dispatch.js`, `scripts/transcripts.js`,
`templates/pre-commit` and `templates/post-checkout` are present and match PO
c054612's tree except for CRLF line endings. PO's `templates/`, `git-hooks/` and
`hooks/` are unchanged between 06340fa and c054612, so the stand-ins already in
`.githooks/` are current. Git's `sh` ran a CRLF script with `set -e`
correctly, and the installed `git-hooks/post-checkout` exited 0.

### B2. What gets built

1. **Lock to c054612.** `npm update project-overseer` (spec stays
   `github:willemkaraffa/Project-Overseer`). npm also writes the playwright entry
   package.json already declares.
2. **Local copies removed:** `.claude/hooks/coder-role-gate.js`, `spawn-limiter.js`,
   `commit-authority-gate.js`.
3. **Settings point at the frame.** Each registration of the three becomes
   `node node_modules/project-overseer/hooks/<gate>.js` on the same matchers, same
   order; a `SessionStart` entry runs `session-start.js`. This project's own hooks
   (`role-lock.js`, `scraper-data-gate.js`, `user-authority-gate.js`) stay.
   PO's settings manifest is unchanged between 6400a32 and c054612.
4. **Git hooks are stand-ins.** `.githooks/pre-commit` and `post-checkout` are
   `templates/pre-commit` and `templates/post-checkout` of 06340fa: they `exec` the
   frame's `git-hooks/` body, so a PO update reaches them through the package.
   `commit-msg` and `post-commit` stay.
5. **The seventh gate in config.** `overseer.json` gains
   `"preCommitGates": [{ "run": "node .claude/hooks/user-authority-check.js", "label": "user authority" }]`,
   which the frame runs after its six.
6. **The three tests** load `node_modules/project-overseer/hooks/<gate>.js`; nothing
   else in them changes.
7. **overseer.json** drops the three from `guards` and their paths from `roles.locked`.
   `roles.overseer.mayNotWrite` stays.
8. **Bootstrap:** `HISTORY.md`, `NEXT-STEPS.md`, `docs/changes/`, `docs/intent/`,
   `docs/methodology/`. `HISTORY.md`, `NEXT-STEPS.md` and the `docs/changes/` entry are
   staged before the fidelity ruling, so the Architect reads them.
9. Locked files are edited only after a role-lock grant, asked once per path. Seven
   were asked and answered "Unlock" in this session before the first round of edits.

### B3. Honest limits

- The frame's copies sit under `node_modules/`, which `role-lock.js` skips; a reinstall
  restores them. The lock pins which bytes a reinstall brings.
- The playwright lock entry is collateral of the lock write, not a chosen change.
- `package-lock.json` (over 300,000 characters) is judged by the Reviewer and the
  Architect from its diff only, never read whole (PO slice 11).
- The installed files carry CRLF endings (npm packed the git checkout on Windows).
- Revising this record changes its hash, so every observation is observed again against
  this version: `before` in a clean detached worktree of the base (98895f4) at
  `C:\dev\WOT-base-obs`, its `node_modules` a junction to this checkout's (a clean tree
  has none, and the tests and status script need it), with the scripts pointed at it
  through `OVERSEER_ROOT`, the records then copied into this commit's methodology
  folder; `after` here. The first round's records stay, as history for the earlier version.
- The user-level dispatcher (`install-hooks.js --user`) is not installed here; it is PO
  slice 9's L1, run after this lands.

---

## Part C: questions for the user, and the rulings

Ruled before the first version: slice 7 Q1 and Q2 (a separate commit in this project
that also refreshes its pre-commit); the seventh gate; the worktree.

Worktree, asked 2026-09-14 (AskUserQuestion), because approvals were then found only in
the transcript folder of the project path the session opened in:
> "Main worktree (Recommended)"

The first fidelity ruling, 2026-09-14, against staged diff e0c228de03f6dccf. The
Architect ruled 6 items AMBIGUOUS. The user's answer to each script-written question,
verbatim (AskUserQuestion):
> item-7 (bootstrap): "Loop back to Discussion"
> item-8 (role-lock grant per path): "Loop back to Discussion"
> obs-B1-bootstrap-records: "Loop back to Discussion"
> obs-T1-gate-tests-pass: "Loop back to Discussion"
> obs-ST1-status-enforcing: "Loop back to Discussion"
> obs-I1-suite-stays-green: "Loop back to Discussion"

Each item's evidence sat where the Architect was not shown it: `HISTORY.md` and
`NEXT-STEPS.md` hidden by the Reviewer's exclusion list; test and status output, which a
diff cannot hold; the unlock answers, in the transcript. The user held this project
until PO fixed that (PO slice 9, Q5 and Q6): observation items are now ruled from their
filed records, the fidelity diff hides only `docs/methodology/`, every staged file is
shown whole, and the human's answers are citable facts. The resume instruction in
Part A is the ruling on how to proceed; this revision's approval confirms it.

The lockfile hold, 2026-09-14. After the 06340fa revision was approved and observed,
`review-gate.js` refused: `package-lock.json` (319,298 characters) was over PO's
200,000-character per-file budget, so every commit touching the lock counted as "cut",
and splitting could not help. The user's answer, verbatim (AskUserQuestion):
> "PO: lockfiles diff-only (Recommended)"

PO slice 11 (c054612) built it; the second resume instruction in Part A resumes here.

---

## Part D: success criteria

```observation
id: L1-lock-pins-c054612
run: node -e "process.exit(require('./package-lock.json').packages['node_modules/project-overseer'].resolved.endsWith('#c0546127219cbf249efe925afbc1f0fe60e52b44')?0:3)"
before: exit 3
after: exit 0
```

```observation
id: H1-local-copies-removed
run: node -e "process.exit(['coder-role-gate','spawn-limiter','commit-authority-gate'].some(h=>require('fs').existsSync('.claude/hooks/'+h+'.js'))?3:0)"
before: exit 3
after: exit 0
```

```observation
id: S1-settings-point-at-frame
run: node -e "const s=require('fs').readFileSync('.claude/settings.json','utf8');const f='node_modules/project-overseer/hooks/';process.exit(['coder-role-gate','spawn-limiter','commit-authority-gate','session-start'].every(h=>s.includes(f+h+'.js'))&&!['coder-role-gate','spawn-limiter','commit-authority-gate'].some(h=>s.includes('.claude/hooks/'+h))?0:3)"
before: exit 3
after: exit 0
```

```observation
id: G1-git-hooks-are-stand-ins
run: node -e "const fs=require('fs');const p=fs.readFileSync('.githooks/pre-commit','utf8');const q=fs.existsSync('.githooks/post-checkout')?fs.readFileSync('.githooks/post-checkout','utf8'):'';process.exit(p.includes('exec sh node_modules/project-overseer/git-hooks/pre-commit')&&!p.includes('user-authority-check')&&q.includes('node_modules/project-overseer/git-hooks/post-checkout')?0:3)"
before: exit 3
after: exit 0
```

```observation
id: O1-overseer-json-gates
run: node -e "const c=require('./overseer.json');const g=JSON.stringify(c.guards)+JSON.stringify(c.roles.locked);const p=JSON.stringify(c.preCommitGates||[]);process.exit(!['coder-role-gate','spawn-limiter','commit-authority-gate'].some(h=>g.includes(h))&&p.includes('node .claude/hooks/user-authority-check.js')?0:3)"
before: exit 3
after: exit 0
```

```observation
id: B1-bootstrap-records
run: node -e "process.exit(['HISTORY.md','NEXT-STEPS.md'].every(f=>require('fs').existsSync(f))?0:3)"
before: exit 3
after: exit 0
```

```observation
id: ST1-status-enforcing
run: node node_modules/project-overseer/scripts/overseer-status.js
before: exit 1; contains "GAP"
after: exit 0; contains "gates ARE enforcing"; lacks "GAP"
```

```observation
id: T1-gate-tests-pass
kind: invariant
run: node test/coder-role-gate.test.js && node test/spawn-limiter.test.js && node test/commit-authority-gate.test.js
expect: exit 0; lacks "Cannot find module"
```

```observation
id: I1-suite-stays-green
kind: invariant
run: node test/run.js
expect: exit 0; contains ", 0 fail"
```

T1 after H1: the copies are gone and the tests still pass, so they run the frame's.

**Scope.** `package-lock.json`, `.claude/settings.json`, `.claude/hooks/coder-role-gate.js`,
`.claude/hooks/spawn-limiter.js`, `.claude/hooks/commit-authority-gate.js` (removed),
`.githooks/pre-commit`, `.githooks/post-checkout`, `test/coder-role-gate.test.js`,
`test/spawn-limiter.test.js`, `test/commit-authority-gate.test.js`, `overseer.json`,
`HISTORY.md`, `NEXT-STEPS.md`, `docs/changes/`, `docs/intent/`, `docs/methodology/`.

**Non-goals.** No change to any gate's behaviour. No migration of this project's own
gates (`role-lock.js`, `role-lock-check.js`, `scraper-data-gate.js`,
`user-authority-gate.js`, `user-authority-check.js`). No change to `commit-msg`,
`post-commit` or `package.json`. No user-level dispatcher install. The unused worktree
`C:\dev\Work-Order-Tracker-po-gates` is left for the user to remove.

**Falsifier.** Wrong if, after it lands, `overseer-status.js` reports a GAP; or any of
the three gates stops firing on a payload that blocked before; or a commit here passes
without the changelog, falsification, fidelity or user-authority gate running.

**Done.** `npm run verify` green; every observation flipped or held as predicted and
filed verbatim; reviewer findings dispositioned; fidelity ruled; this record approved
through the intent-approval channel before its observations.
