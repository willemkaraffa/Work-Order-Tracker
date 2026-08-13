'use strict';
/*
 * coder-role-gate.js: the chat-facing Claude is the OVERSEER and does not write app
 * code. The coder is a Task subagent. This hook is what makes that true.
 *
 * WHY IT DID NOT EXIST UNTIL NOW. The role model has been written down since
 * 2026-07-17 and was never enforced, because a probe that day found session_id is
 * SHARED between a subagent and its parent and concluded from that that hooks could
 * not tell the two apart. That conclusion went into memory as "role-based permissions
 * are unimplementable", and every session after it read that line and stopped.
 *
 * The narrow fact was right and the conclusion was wrong. Re-probed 2026-07-23 on
 * Claude Code 2.1.217 by logging the raw PreToolUse payload for two Writes in one
 * session, one direct and one from a subagent:
 *
 *   direct    keys: cwd effort hook_event_name permission_mode prompt_id
 *                   session_id tool_input tool_name tool_use_id transcript_path
 *   subagent  keys: agent_id agent_type  + all of the above
 *
 * So the harness names the caller after all. `agent_id` and `agent_type` sit OUTSIDE
 * `tool_input`, which is the only part of the payload Claude authors, so they cannot
 * be forged from the model side. Absence of `agent_id` means the chat-facing session
 * made this call.
 *
 * TWO MARKERS THAT LOOK RIGHT AND ARE NOT, recorded so nobody re-derives them:
 *   - `transcript_path` is the PARENT jsonl for both. A path test always passes.
 *   - `isSidechain: true` is real but lives in a separate file the hook never sees
 *     (<session>/subagents/agent-<id>.jsonl). Not available here.
 * Test `agent_id`. Nothing else.
 *
 * SCOPE IS DATA, read from overseer.json under roles.overseer.mayNotWrite. It now
 * covers src, extension, main.js, preload.js, all .py, scripts/, test/ and
 * .claude/hooks/ INCLUDING THIS FILE. Docs and anything outside the repo stay the
 * overseer's to write.
 *
 * WHY IT WIDENED on 2026-07-23: the original boundary was app code only and exempted
 * .claude/hooks, scripts/, tests and docs -- that is, every category the overseer
 * actually worked in, so the gate constrained nothing it did. And the overseer picked
 * that boundary itself, which is the same defect the lock exists to prevent. The
 * self-edit carve-out is gone too: this file is inside the scope it defines, and
 * role-lock.js keeps it locked to everyone.
 *
 * NO ESCAPE HATCH, also the human's call. An escape I can invoke is exactly the
 * discipline that already failed. If this wedges, the human unregisters it.
 *
 * KNOWN HOLE, stated rather than hidden: a PreToolUse matcher on Edit/Write does not
 * see a file written through Bash or PowerShell heredoc. Same coverage hole that let
 * a PowerShell call walk through a Bash-only guard on 2026-07-16. The commit hook is
 * the fence; this is the early warning. For the locked role-definition paths that
 * fence is .claude/hooks/role-lock-check.js, run from .githooks/pre-commit, which is
 * tool-agnostic because git runs it whichever shell staged the change.
 *
 * Exit 2 = block (stderr reaches Claude). Fails OPEN on its own errors.
 */
const fs = require('fs');
const path = require('path');

// The overseer's write scope is not a list buried in this hook any more. It lives
// in overseer.json under roles.overseer.mayNotWrite, so the role is data the human
// can open, read and change without touching hook code.
// Fails OPEN on any config problem (missing file, bad JSON, missing key): a broken
// config must not turn into a gate that blocks every write.
function roleScope(root) {
  let raw;
  // ABSENT/unreadable overseer.json -> nothing to enforce -> fail OPEN. This is a
  // non-PO tree, not tampering.
  try { raw = fs.readFileSync(path.join(root, 'overseer.json'), 'utf8'); }
  catch { return []; }
  // PRESENT but unparseable -> fail CLOSED. Corrupting the role definition must not
  // be a way to switch the gate off. overseer.json is itself locked, so a legit
  // corruption is a bad human edit, recoverable by fixing the JSON.
  let cfg;
  try { cfg = JSON.parse(raw); }
  catch {
    process.stderr.write(
      '[coder-role] BLOCKED: overseer.json is present but unparseable. Refusing to\n' +
      'fail open on a corrupt role definition. Fix the JSON, then retry.\n');
    process.exit(2);
  }
  const list = cfg && cfg.roles && cfg.roles.overseer && cfg.roles.overseer.mayNotWrite;
  return Array.isArray(list) ? list : [];
}

// Minimal glob over "/"-split segments:
//   "**" spans zero or more segments, except as the last pattern segment, where it
//        needs at least one -- "src/**" is the contents of src/, not src itself.
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

// Normalise to a repo-relative POSIX path. Returns null when the file is outside the
// repo (scratchpad, temp) or inside node_modules, neither of which is app code.
function repoRelative(file, cwd) {
  let rel;
  try { rel = path.relative(cwd, path.resolve(cwd, file)); } catch { return null; }
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  rel = rel.split(path.sep).join('/');
  if (/^node_modules\//i.test(rel)) return null;
  return rel;
}

function main() {
  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { return; }

  const tool = input.tool_name || '';
  if (tool !== 'Edit' && tool !== 'Write') return;

  // A subagent is doing the writing. That is the whole point of the gate.
  if (input.agent_id) return;

  const ti = input.tool_input || {};
  const file = String(ti.file_path || '');
  if (!file) return;

  const root = input.cwd || process.cwd();
  const rel = repoRelative(file, root);
  if (!rel) return;
  const scope = roleScope(root);
  if (!scope.some((g) => globMatch(g, rel))) return;

  process.stderr.write(
    `[coder-role] BLOCKED: you are the OVERSEER. App code is the coder's to write.\n` +
    `  file: ${rel}\n\n` +
    `This call carried no agent_id, so it came from the chat-facing session rather\n` +
    `than a subagent. On 2026-07-22 that session did 111 edits, spawned zero\n` +
    `subagents, and silently overwrote a real work order's user-set status. Collapsing\n` +
    `overseer and coder into one process is the failure mode, not a shortcut around it.\n\n` +
    `Dispatch it:\n` +
    `  Agent(subagent_type: "caveman:cavecrew-builder", prompt: "<the change, with file\n` +
    `  paths and enough context to act without this conversation>")\n\n` +
    `Reviewer and architect work is NOT a subagent; role-router.js routes those to\n` +
    `Gemini. This gate is only about who writes app code.\n\n` +
    `There is no escape hatch by design. Rewording or splitting the edit to slip past\n` +
    `this is tampering with the gate, not a judgment call. If the block is wrong, say\n` +
    `so to the human and stop.\n`
  );
  process.exit(2);
}

try { main(); } catch (e) {
  process.stderr.write('[coder-role] guard error (failing OPEN): ' + e.message + '\n');
}
