'use strict';
/*
 * role-lock-check.js: the COMMIT-side half of the role lock.
 *
 * role-lock.js is PreToolUse, so it only ever sees Edit and Write. A file written
 * through Bash, PowerShell, redirection or a heredoc reaches the role definition
 * untouched. git runs pre-commit itself no matter which shell staged the change, so
 * this is the fence and the PreToolUse lock is the early warning. Same pairing as
 * user-authority-gate.js / user-authority-check.js.
 *
 * THE TRAILER IS WEAKER THAN THE PreToolUse GRANT. Stated plainly rather than left
 * to be discovered: role-lock.js releases only on an unforgeable human answer, read
 * structurally out of the session transcript by user-grant.js (answers come from
 * entry.toolUseResult.answers on an AskUserQuestion tool_use, which Claude cannot
 * author). A git hook has no session and no transcript_path, so it cannot call
 * user-grant.js at all. All it can read is the commit message, and Claude can type
 * a commit message. So `Role-Definition-Approved:` is an honesty marker, not a
 * proof. The two are NOT equivalent. This check closes the shell-write hole; it
 * does not close the lying hole.
 *
 * Exit 0 = allowed, 1 = refused. Any config problem exits 0 (fails OPEN): a broken
 * config must not become a gate that blocks every commit.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APPROVED = /^\s*Role-Definition-Approved:\s*\S+/mi;

const REPO = process.cwd();
const git = (args) => {
  try { return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }); }
  catch { return ''; }
};

function stagedFiles() {
  return git(['diff', '--cached', '--name-only']).split('\n').map(s => s.trim()).filter(Boolean);
}

// commit-msg hands us the message file as $1 (process.argv[2]); a pre-commit hook
// runs BEFORE git writes the pending message, so reading COMMIT_EDITMSG there was
// stale (the PREVIOUS commit's message) -- that was the bug. Fall back to
// COMMIT_EDITMSG only when no argv is given (e.g. direct/test invocation).
function commitMessage() {
  const p = process.argv[2] || path.join(REPO, '.git', 'COMMIT_EDITMSG');
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

// Locked paths live in overseer.json so the human can inspect them.
// Any config problem returns [] -> nothing is locked -> fail OPEN.
function lockedPaths() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(REPO, 'overseer.json'), 'utf8'));
    const list = cfg.roles.locked;
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

// Same minimal glob as role-lock.js, copied rather than shared: these hooks are
// deliberately self-contained at this size.
//   "**" spans zero or more segments, except as the last pattern segment, where
//        it needs at least one -- ".githooks/**" is the contents, not the dir.
//   "*"  spans a run of characters inside one segment, never across "/".
//   anything else is a literal segment, compared case-insensitively.
function globMatch(pattern, rel) {
  const pat = String(pattern).split('/');
  const seg = String(rel).split('/');
  const lit = (s) => new RegExp(
    '^' + s.split('*').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$', 'i');
  const walk = (i, j) => {
    if (i === pat.length) return j === seg.length;
    if (pat[i] === '**') {
      if (i === pat.length - 1) return seg.length - j >= 1;
      for (let k = j; k <= seg.length; k++) if (walk(i + 1, k)) return true;
      return false;
    }
    if (j >= seg.length) return false;
    return lit(pat[i]).test(seg[j]) && walk(i + 1, j + 1);
  };
  return walk(0, 0);
}

function main() {
  const locked = lockedPaths();
  if (!locked.length) return 0;

  const files = stagedFiles();
  if (!files.length) return 0;

  const hits = files.filter(f => locked.some(g => globMatch(g, f)));
  if (!hits.length) return 0;
  if (APPROVED.test(commitMessage())) return 0;

  console.error('[role-lock] COMMIT REFUSED: this diff changes the ROLE DEFINITION.');
  console.error('    ' + hits.slice(0, 10).join('\n    '));
  console.error('');
  console.error('  The role definition says what the overseer may not write. Changing it is the');
  console.error('  HUMAN\'s call: not the coder\'s, and not the overseer\'s. A boundary the');
  console.error('  constrained party can move is not a boundary.');
  console.error('');
  console.error('  The PreToolUse lock (role-lock.js) sees only Edit and Write, so a file written');
  console.error('  through Bash or PowerShell walks past it. This commit-side check is the fence');
  console.error('  against that shell write.');
  console.error('');
  console.error('  Ask the human, then record what they agreed to:');
  console.error('    Role-Definition-Approved: <what the human agreed to>');
  console.error('  as a line in the commit message. Typing that line without having asked is');
  console.error('  forging a human decision, not a shortcut.');
  return 1;
}

if (require.main === module) process.exitCode = main();
module.exports = { APPROVED, globMatch, lockedPaths };
