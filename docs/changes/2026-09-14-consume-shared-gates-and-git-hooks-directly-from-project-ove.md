---
date: 2026-09-14
model: gemini-flash-latest
diff: 9b10e6f14ef6a28a
files: .claude/hooks/coder-role-gate.js, .claude/hooks/commit-authority-gate.js, .claude/hooks/spawn-limiter.js, .claude/settings.json, .githooks/post-checkout, .githooks/pre-commit, docs/intent/2026-09-14-po-frame-hooks.approval.json, docs/intent/2026-09-14-po-frame-hooks.md, overseer.json, package-lock.json, test/coder-role-gate.test.js, test/commit-authority-gate.test.js, test/spawn-limiter.test.js
---

### Consume shared gates and git hooks directly from Project Overseer

Delete local implementations of coder-role-gate, spawn-limiter, and commit-authority-gate from `.claude/hooks/`. Configure `.claude/settings.json` and gate test suites to invoke the canonical versions provided by the `project-overseer` package under `node_modules/`, and add the `SessionStart` hook.

Replace the self-contained `.githooks/pre-commit` script and add `.githooks/post-checkout` using thin stand-in templates that delegate execution to `node_modules/project-overseer/git-hooks/`. Static standalone copies caused local gates to freeze at copy time and silently diverge from the framework. To preserve repo-specific gate coverage without embedding custom logic inside the shared hook stand-ins, register `user-authority-check.js` under `preCommitGates` in `overseer.json`, where the runner executes it after the default framework gates.

Update the `project-overseer` dependency lock to commit `c0546127219cbf249efe925afbc1f0fe60e52b44` (resolving an omitted lock entry for declared dependency `playwright` in the process). Unregister the deleted hooks from `guards` and `roles.locked` in `overseer.json`, and track intent approval metadata.

**Files:** .claude/hooks/coder-role-gate.js, .claude/hooks/commit-authority-gate.js, .claude/hooks/spawn-limiter.js, .claude/settings.json, .githooks/post-checkout, .githooks/pre-commit, docs/intent/2026-09-14-po-frame-hooks.approval.json, docs/intent/2026-09-14-po-frame-hooks.md, overseer.json, package-lock.json, test/coder-role-gate.test.js, test/commit-authority-gate.test.js, test/spawn-limiter.test.js
