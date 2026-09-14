# Next steps

Overseer-written; staged by every commit; bound by git to its last commit.

1. Every commit here runs Project Overseer's full pre-commit (branch, verify, review,
   plan, changelog, falsification, fidelity) plus this project's `preCommitGates` in
   `overseer.json` (today: `user-authority-check.js`). Each commit needs: an approved
   intent record under `docs/intent/`, observations before and after (`observe.js`), a
   reviewer run with every finding dispositioned, a `docs/changes/` entry, a
   `HISTORY.md` line citing it, this file staged, then the Architect's fidelity ruling.
2. The frame is pinned by `package-lock.json` (PO c054612; the lock is judged from its
   diff, slice 11). The three role gates run from
   `node_modules/project-overseer/hooks/`; `.githooks/pre-commit` and `post-checkout`
   are stand-ins that exec the frame's `git-hooks/`. A PO update is
   `npm update project-overseer`, then verify the installed files and run
   `node node_modules/project-overseer/scripts/overseer-status.js`.
3. PO slice 9 L1, owed in the PO repo now this has landed: global install, then
   `install-hooks.js --user`, then an edit here from the PO session must trip role-lock.
4. Known limit: `role-lock.js` skips `node_modules/`, so the installed gate copies are
   not role-locked. A reinstall restores them.
5. Parked, not lost: `stash@{0}` holds `roadmap-handoffs/admin-module.md` WIP from
   `feat/schedule-retention`. The Admin module lives only on that branch; switch back
   (`git switch feat/schedule-retention`, `git stash pop`, `npm run build:renderer`,
   restart the app) to see it again. Notes data was verified intact (925 in
   `wo-data.json`).
6. Cleanup for the user: worktrees `C:\dev\Work-Order-Tracker-po-gates` (unused) and
   `C:\dev\WOT-base-obs` (clean base for this commit's before-observations; its
   `node_modules` is a junction, remove the junction before the folder).
