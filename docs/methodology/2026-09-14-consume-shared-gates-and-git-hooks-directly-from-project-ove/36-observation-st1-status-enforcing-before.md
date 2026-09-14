---
at: 2026-09-14T18:49:59.900Z
role: observation
action: ST1-status-enforcing-before
outcome: matched
intent: docs/intent/2026-09-14-po-frame-hooks.md
sha256: 9d9c9591e3c0ccf82c25d22eb55380f3c596724d5d611d97fea22044ad0f8d4c
observation: ST1-status-enforcing
phase: before
kind: flip
expected: exit 1; contains "GAP"
exit: 1
matched: true
head: 98895f4
---

## observation / ST1-status-enforcing-before

### Instruction sent (verbatim)

```text
node node_modules/project-overseer/scripts/overseer-status.js
```

### Reply received (verbatim)

```text

PROJECT OVERSEER STATUS
(read from disk; nothing here is asserted from memory)

ENFORCEMENT (automatic, fires without being asked)
  OK   commit gates: core.hooksPath=.githooks
  OK   thrash guard: present, registered
  OK   verify budget nudge: present, registered
  OK   plan scope guard: present, registered
  OK   style gate: present, registered
  GAP  session-start review: MISSING, NOT REGISTERED
  OK   coder role gate: present, registered
  OK   coder spawn limiter: present, registered
  OK   commit authority gate: present, registered
  OK   scraper data gate: present, registered
  OK   user authority gate: present, registered
  OK   coder role gate: present, registered
  OK   role lock: present, registered
  OK   role lock commit check: present, registered
  OK   commit authority gate: present, registered
  OK   spawn limiter: present, registered
  GAP  pre-commit runs the frame's own hook: OLD FULL COPY  <-- replace with templates/pre-commit
  GAP  falsification gate: present, NOT in the active pre-commit
  GAP  fidelity gate: present, NOT in the active pre-commit
  GAP  project gates: present, NOT in the active pre-commit

ROLES (declared in overseer.json by the consuming project)
  overseer mayNotWrite: **/*.js, **/*.jsx, **/*.mjs, **/*.cjs, **/*.ts, **/*.tsx, **/*.py, src/**, extension/**, scripts/**, test/**, .claude/hooks/**, main.js, preload.js
  locked roles: .claude/settings.json, overseer.json, .githooks/**, .claude/hooks/coder-role-gate.js, .claude/hooks/role-lock.js, .claude/hooks/role-lock-check.js, .claude/hooks/commit-authority-gate.js, .claude/hooks/spawn-limiter.js, .plan.json, .review-findings.json
  Declared, not proven. Enforcement of these is whatever hook above reads them.

PLAN
  no plan on disk. Scope is NOT enforced (this is the normal ad-hoc mode).

SPEND
  heavy-verify runs observed: 0   scope: no plan on disk (ad-hoc bucket)
  no plan budget to compare against; the nudge falls back to 2 per 15 min.
  Counts RUNS the PostToolUse hook saw, not tokens. A floor, never a bill.
  spawns this session: unknown (no transcript found for this project).

COST (tokens, derived from the transcripts; informational, not a gate)
  no session transcripts found for this project (nothing to cost).

FINDINGS
  no review on record for this tree.

RULES
  live A1  TP=0 FP=0 prec=-  hypothesis
  live A2  TP=0 FP=0 prec=-  hypothesis
  live A3  TP=1 FP=0 prec=1.00  hypothesis
  live A4  TP=0 FP=0 prec=-  hypothesis
  live A5  TP=1 FP=0 prec=1.00  hypothesis
  live A6  TP=1 FP=0 prec=1.00  hypothesis
  live A7  TP=1 FP=0 prec=1.00  hypothesis
  live B1  TP=0 FP=0 prec=-  hypothesis
  live C4  TP=0 FP=0 prec=-  hypothesis
  live G1  TP=0 FP=2 prec=0.00  hypothesis
  live G2  TP=1 FP=0 prec=1.00  hypothesis
  live G3  TP=0 FP=0 prec=-  hypothesis
  live G4  TP=3 FP=0 prec=1.00  validated  collateral=1/3
  live G5  TP=0 FP=0 prec=-  hypothesis
  live G6  TP=0 FP=0 prec=-  hypothesis
  15 rules, 0 retired by evidence, 0 flagged for redesign.

ARCHITECT (manual: runs ONLY when invoked)
  There is no ambient architect. It is a script, not a daemon.
  Evidence it ran THIS session = architect-ruled dismissals above, or a fresh plan.
  Invoke: node node_modules/project-overseer/scripts/architect.js plan docs/intent/<file>.md | fidelity docs/intent/<file>.md | triage | rule <id> | scope <file>

VERDICT: 5 GAP(S) ABOVE. Some enforcement is NOT active.


```
