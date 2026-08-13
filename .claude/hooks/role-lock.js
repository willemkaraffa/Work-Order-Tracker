#!/usr/bin/env node
// role-lock -- PreToolUse on Edit and Write.
//
// Blocks every path listed in overseer.json under roles.locked. For EVERYONE.
// Not just the overseer: `input.agent_id` is deliberately ignored here, which is
// the opposite of coder-role-gate.js. That is the entire point of this hook.
// The role definition says what the overseer may not write. If the overseer
// could edit the role definition, the boundary would be self-administered and
// therefore not a boundary. If the overseer could dispatch a coder subagent to
// edit it instead, the boundary would just be one indirection away. Both doors
// are shut: locked is locked, whoever is holding the pen.
//
// The only release is a human grant, read out of the session transcript by
// node_modules/project-overseer/scripts/user-grant.js.
//
// Why that function and not a grep of the transcript: EVERY tool result in a
// transcript is stored as a `role: user` entry, including Bash stdout. A grep
// for the answer text would therefore accept `echo "Unlock"` as a human
// decision -- the model could forge its own permission slip in one command.
// lastUserGrant reads the transcript structurally instead: it takes answers
// only from `entry.toolUseResult.answers`, and only when that entry is the
// result of a tool_use block whose name is AskUserQuestion. Claude emits the
// question; only the human can produce that answers object.
//
// Fails OPEN on any error, including a missing or unloadable user-grant.js.
// A broken lock must not become a gate that blocks all editing.

const fs = require('fs');
const path = require('path');

// SCOPED grant. The question names the exact repo-relative file, so the human's
// answer unlocks THAT path only, not every locked path for the session. The lock
// rebuilds this same string from the file it is checking and reads the human's
// answer to it; a grant for overseer.json does not unlock role-lock.js. To unlock
// several files, ask several of these in one AskUserQuestion call (its questions
// array), one per path.
const question = (rel) => 'Unlock the role definition for editing "' + rel + '"?';

// Locked paths live in overseer.json so the human can inspect them.
// Any config problem returns [] -> nothing is locked -> fail OPEN.
function lockedPaths(root) {
  let raw;
  // ABSENT/unreadable -> nothing locked -> fail OPEN (non-PO tree, not tampering).
  try { raw = fs.readFileSync(path.join(root, 'overseer.json'), 'utf8'); }
  catch { return []; }
  // PRESENT but unparseable -> fail CLOSED. Corrupting the role definition must not
  // unlock the locked paths. overseer.json is itself locked; a real corruption is a
  // bad human edit, recoverable by fixing the JSON.
  let cfg;
  try { cfg = JSON.parse(raw); }
  catch {
    process.stderr.write(
      '[role-lock] BLOCKED: overseer.json is present but unparseable. Refusing to\n' +
      'fail open on a corrupt role definition. Fix the JSON, then retry.\n');
    process.exit(2);
  }
  const list = cfg && cfg.roles && cfg.roles.locked;
  return Array.isArray(list) ? list : [];
}

// Repo-relative, forward slashes. null for anything outside the repo or under
// node_modules -- this hook has no business there.
function repoRelative(file, cwd) {
  let rel;
  try { rel = path.relative(cwd, path.resolve(cwd, file)); } catch { return null; }
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  rel = rel.split(path.sep).join('/');
  if (/^node_modules\//i.test(rel)) return null;
  return rel;
}

// Same minimal glob as coder-role-gate.js, copied rather than shared: two small
// self-contained hooks beat a shared module at this size.
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
  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { return; }

  const tool = input.tool_name || '';
  if (tool !== 'Edit' && tool !== 'Write') return;

  const ti = input.tool_input || {};
  const file = String(ti.file_path || '');
  if (!file) return;

  const root = input.cwd || process.cwd();
  const rel = repoRelative(file, root);
  if (!rel) return;
  if (!lockedPaths(root).some((g) => globMatch(g, rel))) return;

  // Grant machinery missing or broken -> fail OPEN, do not block on our own plumbing.
  let lastUserGrant;
  try {
    ({ lastUserGrant } = require(path.join(root, 'node_modules', 'project-overseer', 'scripts', 'user-grant.js')));
  } catch { return; }

  // A missing transcript_path is NOT an error: it just means no grant is
  // provable, so the file stays locked. The grant is keyed on THIS file's
  // question, so a grant for a different locked path will not match here.
  const q = question(rel);
  let ans = null;
  try { ans = lastUserGrant(input.transcript_path, q); } catch { ans = null; }
  if (typeof ans === 'string' && /^unlock/i.test(ans.trim())) return;

  process.stderr.write(
    '[role-lock] BLOCKED: ' + rel + '\n' +
    '\n' +
    'This file is part of the ROLE DEFINITION. It is human-owned, not yours.\n' +
    'It says what the overseer may not write, so it cannot be edited by the\n' +
    'party it constrains.\n' +
    '\n' +
    'A subagent cannot unlock it either. Dispatching a coder to make this edit\n' +
    'is the same edit with an extra step, and this hook ignores agent_id.\n' +
    '\n' +
    'The only way through is to ask the human, with the AskUserQuestion tool,\n' +
    'using this exact question text:\n' +
    '\n' +
    '  ' + q + '\n' +
    '\n' +
    'Rewording the question, or answering it yourself in any way -- echoing the\n' +
    'answer, writing it into a file, narrating that the user agreed -- is\n' +
    'forging a human decision. The grant is read structurally from the human\'s\n' +
    'own answer to that tool call, so a forgery will not be honoured; it will\n' +
    'only be a lie in the transcript.\n'
  );
  process.exit(2);
}

try { main(); } catch (e) {
  process.stderr.write('[role-lock] guard error (failing OPEN): ' + e.message + '\n');
}
