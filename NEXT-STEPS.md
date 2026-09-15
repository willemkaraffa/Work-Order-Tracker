# Next steps

Overseer-written; staged by every commit; bound by git to its last commit.

1. Every commit here runs Project Overseer's full pre-commit (branch, verify, review,
   plan, changelog, falsification, fidelity) plus this project's `preCommitGates` in
   `overseer.json` (today: `user-authority-check.js`). Each commit needs: an approved
   intent record under `docs/intent/`, observations before and after (`observe.js`), a
   reviewer run with every finding dispositioned, a `docs/changes/` entry, a
   `HISTORY.md` line citing it, this file staged, then the Architect's fidelity ruling.
   Scraper files (`scrape_amh.py`, `extension/`) also need an approved plan. Since PO
   slice 12, a merge commit is judged only on files that differ from both parents.
2. The frame is pinned in `package.json` and `package-lock.json` (PO 0769989, 0.17.0; the lock
   is judged from its diff, slice 11). The three role gates run from
   `node_modules/project-overseer/hooks/`; `.githooks/pre-commit` and `post-checkout`
   are stand-ins that exec the frame's `git-hooks/`. A PO update is
   `npm install github:willemkaraffa/Project-Overseer#<commit>`, then verify the
   installed files against PO's tree and run
   `node node_modules/project-overseer/scripts/overseer-status.js`.
3. User live check owed on `feat/schedule-retention` after the merge of `main`: one MSR
   "Find new" on an open MSR list tab (the scan now reads only that tab), and one
   "Capture all AMH" (contacts refilled one WO at a time, plus the new "no contact" /
   "no street" warnings). Rebuild the renderer and reload the extension first.
4. PO slice 9 L1, owed in the PO repo: global install, then `install-hooks.js --user`,
   then an edit here from the PO session must trip role-lock.
5. Known limit: `role-lock.js` skips `node_modules/`, so the installed gate copies are
   not role-locked. A reinstall restores them.
6. Cleanup for the user: worktrees `C:\dev\Work-Order-Tracker-po-gates` (unused) and
   `C:\dev\WOT-base-obs` (clean base for before-observations; its `node_modules` is a
   junction, remove the junction before the folder).
