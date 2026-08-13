# PO role-boundary + deterministic-gap review (2026-08-13)

Driven via the Gemini reader (`scripts/ask.js`); the overseer did not bulk-read the
hooks itself. Findings are advisory. The `verify` gate + a human are the only green
light. All fixes below were verified by RUNNING the actual gate against crafted
PreToolUse payloads, not by assertion.

## Fixed and verified

### C1 - denylist under-covered app code (was: HIGH, confirmed)
`overseer.json roles.overseer.mayNotWrite` enumerated paths, so any new root-level or
new-directory code file escaped (this session: `amh-runner.js`, `amh-pw-token.js`).
Fix: default-deny code by extension (`**/*.js|jsx|mjs|cjs|ts|tsx|py`) plus the prior
dir globs.
Proof: `amh-runner.js`, `lib/newthing.js`, `main.js`, `src/app.jsx` -> exit 2;
`docs/*.md` and any subagent write -> exit 0.

### C3 - forgeable plan approval (was: HIGH, confirmed)
`.plan.json status:approved` was model-writable (not locked, not in mayNotWrite), so
the model could self-approve plan-gated scraper edits.
Fix: added `.plan.json` to `overseer.json roles.locked`. role-lock (PreToolUse) now
blocks any Edit/Write, including from a subagent. Legit writers are Bash scripts
(architect.js, plan-approve.js), unaffected by the Edit/Write matcher.
Proof: Write to `.plan.json` -> exit 2 (direct and subagent).

### C7 - fakeable review findings (was: HIGH, confirmed)
`review-gate.js` refuses a commit while any reviewer finding is open and requires a
`gemini-*` model stamp, but it reads `.review-findings.json`, which was model-writable.
The model could write `{model:"gemini-x", diffHash:<computed>, findings:[]}` to fake a
clean review.
Fix: added `.review-findings.json` to `roles.locked`. Same mechanism as C3. Legit
writer is `gemini-review.js` (Bash), unaffected.
Proof: Write to `.review-findings.json` -> exit 2 (direct and subagent).

### C5 - config-parse fail-OPEN disabled the gate (was: MED, confirmed)
`coder-role-gate.roleScope` and `role-lock.lockedPaths` caught all config errors and
returned `[]`, so a corrupt `overseer.json` silently switched the gate off.
Fix: two-tier. ABSENT/unreadable `overseer.json` -> fail OPEN (non-PO tree). PRESENT
but unparseable -> fail CLOSED (exit 2). `overseer.json` is itself locked, so a real
corruption is a bad human edit, recoverable by fixing the JSON.
Proof: corrupt config -> exit 2 both hooks; absent -> exit 0; valid -> unchanged.

## Residuals - accepted by human decision 2026-08-13 (NOT fixed)

### C2 - shell/heredoc write bypasses PreToolUse (P1, accepted)
role-lock and coder-role-gate match only Edit/Write. A write via Bash/PowerShell
redirect or heredoc is never seen. No clean deterministic fix: the coder-role
distinction depends on `agent_id`, a PreToolUse-only signal; at commit time an
overseer shell-write is indistinguishable from legit coder code, so no commit fence
works for general app code (locked paths do have a commit fence via role-lock-check).
Only a fragile, bypassable PreToolUse shell heuristic was possible; declined.
Status: documented known hole, as coder-role-gate.js already notes inline.

### C4 - registry silent-disable of safety guards (P1, accepted)
G1 (thrash), G3 (plan-scope), G6 (read-router) stand down if their rule is flagged
inactive in `~/.claude/state/tech-debt-protocol.json`, which the overseer can write
(outside the repo, so the repo-relative lock mechanism cannot cover it). Hardening
(always-on, ignore the flag) was declined to preserve registry-based retirement.
Escape of last resort stays the visible, deliberate settings.json unregister.
Status: accepted residual.

### C3-commit - trailer-alone approval (chained with C2)
role-lock-check.js and user-authority-check.js run from git pre-commit, which cannot
read the session transcript, so they accept a model-written commit-message trailer
(`Role-Definition-Approved`, `User-Authority-Approved`) as sole approval. Confirmed by
probe: TRAILER-ALONE-SUFFICES = yes, both files. Exploitable only when chained with a
shell-write (C2) that stages locked/authority files without passing PreToolUse. Closing
C2 or bridging the transcript to commit-time would break the chain; both deferred.
Status: residual, tied to C2.

### C6 - blanket fail-OPEN on internal error (LOW, by design)
Every hook top-level `catch` fails open ("a broken guard must never brick the session")
and does so SILENTLY. Not changed. Possible future nicety: emit a loud notice when a
guard actually errors, so a wedged guard is visible.

## Commit caveat

All C1/C3/C5/C7 edits are to files in `roles.locked` (`overseer.json`,
`.claude/hooks/coder-role-gate.js`, `.claude/hooks/role-lock.js`), made from a separate
`C:\dev\Overseer` session where the WOT gates are inactive. In a live WOT session these
edits require the human-unlock path (AskUserQuestion) and must be committed through the
review-gate. Nothing has been committed.

Separately fixed this session (reader plumbing, not part of this review):
`scripts/ask.js` shim (the reader escape path advertised by read-router was broken) and
its short usage string in `project-overseer/scripts/ask.js`.
