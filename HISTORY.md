# History

The master changelog: what changed, in plain terms. Written by the Overseer. Every line
ends with a pointer to the per-commit entry it summarises under `docs/changes/`, which
another role wrote from the staged diff; the commit gate refuses a pointer that does not
resolve, and a code commit whose entry no line cites. How each change was decided sits
verbatim in `docs/methodology/` under the same slug. Started 2026-09-14, when this
project took on Project Overseer's full commit gate; earlier history is `git log`.

## Unreleased

### Changed
- The three role gates (coder role gate, coder spawn limiter, commit authority gate) run from the installed Project Overseer package, pinned to c054612, instead of local copies; the git hooks become stand-ins that run the package's full commit gate, with this project's user-authority check kept as its own gate in `overseer.json`; this history, the next-steps file and the intent, change and methodology records start here (docs/changes/2026-09-14-consume-shared-gates-and-git-hooks-directly-from-project-ove.md)
