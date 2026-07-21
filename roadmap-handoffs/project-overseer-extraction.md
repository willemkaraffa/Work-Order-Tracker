# Project Overseer: extract from Work-Order-Tracker

Status: SEAMS BUILT, MOVE NOT STARTED. Written 2026-07-16, revised 2026-07-21.

## What changed on 2026-07-21

The two config seams below are no longer TODO. They exist:

- `overseer.json` at the repo root, loaded by `scripts/overseer-config.js`.
  Keys: `verifyCommand` (read by `.githooks/pre-commit`) and `rubricFile`
  (read by `gemini-review.js`). Defaults equal the old hardcoded values, so an
  absent config leaves behaviour identical here.
- A1-A7 moved out of `gemini-review.js` into `.claude/rubric.md`. The frame kept
  the reviewer's STANCE and the JSON output contract; the project supplies only
  the CHECKS. A project that could edit the contract could break the parser or
  grant itself approval authority.
- Missing or empty rubric exits 2 (DID NOT RUN), same code as a dead API key. A
  reviewer with no triggers returns `[]` and reads as a clean pass.
- `plan-approve.js` no longer hardcodes `C--dev-Work-Order-Tracker`. The
  transcript dir is derived from the repo path. That literal made the human
  approval channel dead in every other checkout, and no-transcript is
  indistinguishable from no-approval: the plan gate would refuse every plan
  forever while blaming the human for not answering.
- Covered by `test/overseer-config.test.js` (7 tests, fixture-free).

The open question at the bottom of this doc is answered: rubric is per-project,
supplied as a file. Not per-language, not a menu of named rubrics.

## The file list below is STALE and must be re-derived before the move

It names 5 files. PO has since grown to roughly 20 scripts in `scripts/` plus 7
hooks in `.claude/hooks/`, a rule registry with evidence scoring, plan/approval
machinery, an architect, and `overseer-status`. Re-inventory from disk at move
time; do not trust the list below as the scope.

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

## The real work: 2 config seams. DONE 2026-07-21.

1. **RUBRIC** in `gemini-review.js`. DONE: `overseer.json` -> `rubricFile`.
2. **`.githooks/pre-commit`** verify command. DONE: `overseer.json` ->
   `verifyCommand`.

Still WO-specific, and NOT config problems (they are whole components that
should simply not travel):

- `.claude/hooks/scraper-data-gate.js` (this app's scraper only).
- Skills `verify-wo-tracker`, `scraper-debug`.
- tmp filename prefixes `wot-*` in `plan.js`, `verify-thrash-guard.js`,
  `scraper-data-gate.js`. Harmless until two checkouts share a tmpdir and a
  plan id, then they collide silently.
- `WOT_TRANSCRIPT` env var name in `plan-approve.js`.

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
3. Extract the files (RE-INVENTORY FIRST, see above). The 2 seams are already
   built; keep the tests green.
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

## Open question. ANSWERED 2026-07-21.

Rubric per-project or per-language? PER-PROJECT, as a plain file the project
points at via `overseer.json` -> `rubricFile`. No menu of named rubrics: a menu
is a guess about which languages matter, and a project that needs two rubrics
can write one file. A1-A7 ships as `.claude/rubric.md`, this repo's answer, not
the frame's default.
