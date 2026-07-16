# Project Overseer: extract from Work-Order-Tracker

Status: NOT STARTED. Plan only. Written 2026-07-16.

## Goal

Work-Order-Tracker is an app repo. Project Overseer is a general dev-workflow
frame that happens to live there. Move it out.

Shape: a modular frame that accepts swappable agents as inputs, where the
deterministic gates are the load-bearing glue holding the agents in place.
Agents are fallible and untrusted; the gates are not. Every model sits behind a
one-function seam.

## Repos (2, not 1)

| Repo | Holds | Why not merged |
|---|---|---|
| `claude-config` (private, DONE) | `~/.claude`: hooks, agents, skills, CLAUDE.md, settings | Claude Code reads user hooks from that exact path. Cannot be a subdir of another checkout without symlinks (Windows: admin/dev-mode). |
| `project-overseer` (TODO) | review scripts, gates, tests, docs | Portable, installed per-project. |

## Moves out of WO-Tracker

- `scripts/gemini-review.js` (reviewer)
- `scripts/research.js` (scout)
- `scripts/review-gate.js` + `scripts/review-disposition.js` (dismissal ledger)
- `test/review-gate.test.js`
- `.githooks/pre-commit` (becomes a template)

Stays in `claude-config`: `pretool-guards.js`, `posttool-guards.js`,
`prompt-guards.js`. Path is fixed by the harness.

## The real work: 2 config seams

This is NOT a file move. Two things are WO-specific and must become
project-supplied, or the toolkit only ever works for this repo:

1. **RUBRIC** in `gemini-review.js` hardcodes A1-A7 (React rules from this
   repo's CLAUDE.md). A Python project needs its own. Move to a rubric file the
   project supplies; ship the A1-A7 one as an example, not a default.
2. **`.githooks/pre-commit`** runs `npm run verify`. Project-specific command.
   Make it config (e.g. `overseer.json` -> `{ "verifyCommand": "npm run verify" }`).

Already seamed, do not re-abstract: `search()` in research.js is the only
provider-specific code (Tavily now, Gemini grounding when billing is on).
`MODELS` chain in gemini-review.js.

## Distribution

npm package, consumed via `file:` path or git URL. Standard, no invention.

Do NOT adopt husky/lefthook: scouted 2026-07-16, they are hook MANAGERS, not
toolkit distribution, and `core.hooksPath` + `.githooks/` already does that job
natively with zero deps.

## Order

1. `claude-config` remote. DONE.
2. Create `project-overseer` repo.
3. Extract the 5 files, add the 2 seams, keep the tests green.
4. Point WO-Tracker at it.
5. Confirm the gates still BITE: break the tree on purpose, confirm the commit is
   refused. A gate that no longer blocks after a refactor is worse than no gate.

## Non-negotiables (learned the hard way, do not regress)

- Gates block; agents advise. Never let an agent's opinion gate anything.
- Exit contract: 0 ran clean, 2 DID NOT RUN. A skipped check must never read as a
  clean pass.
- Findings ledger ACCUMULATES. A re-roll of a non-deterministic model must not be
  able to drop a finding (laundering).
- No override knob for Claude. A knob Claude may turn is not a gate.
- Reviewer gets full file text, not just the diff, or it calls unchanged code
  "missing" (3 FPs in one session).
- Hooks: BLOCK to stop, additionalContext to nudge, NEVER warn. `systemMessage`
  is invisible to the model. See [[lesson_hook_channels]].
- Guard every shell tool, not just Bash. See [[lesson_hook_coverage_hole]].
- Guards FAIL OPEN. `node --check` after every hook edit.

## Open question

Rubric per-project or per-language? A1-A7 is React. Probably: ship rubrics as
named files, project picks one, custom rubrics supported. Decide with evidence,
not preference.
