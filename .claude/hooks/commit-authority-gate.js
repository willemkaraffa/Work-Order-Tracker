'use strict';
/*
 * commit-authority-gate.js: only the ARCHITECT and the OVERSEER may rule that a commit
 * is acceptable. The coder is a Task subagent; it may stage, run tests and execute a
 * commit script that a human or the overseer handed it. It may never run the commit
 * itself, push, publish, or type the approval trailer.
 *
 * THIS HOOK IS NOT REGISTERED. .claude/settings.json is locked by human ruling this
 * session, so nothing invokes this file yet. It is INERT until a human adds it to the
 * Bash, PowerShell, Edit and Write PreToolUse matchers. Do not read the presence of
 * this file, or its green test suite, as evidence that anything is being blocked.
 *
 * THE DISCRIMINATOR is `agent_id`, a top-level PreToolUse payload field the Claude Code
 * harness sets ONLY on subagent calls. Probed on Claude Code 2.1.217:
 *
 *   direct (chat-facing overseer):  cwd effort hook_event_name permission_mode prompt_id
 *                                   session_id tool_input tool_name tool_use_id transcript_path
 *   subagent (the coder):           agent_id agent_type  + all of the above
 *
 * It sits OUTSIDE `tool_input`, the only part of the payload the model authors, so it
 * cannot be forged from the model side.
 *
 * POLARITY IS THE INVERSE of coder-role-gate.js. That gate returns early when agent_id
 * is PRESENT (a subagent writing app code is the point). This gate blocks when agent_id
 * is present and returns early when it is ABSENT: the overseer is the commit authority
 * and this gate must never obstruct it.
 *
 * TWO MARKERS THAT LOOK RIGHT AND ARE NOT, recorded so nobody re-derives them:
 *   - `transcript_path` is the PARENT jsonl for both. A path test always passes.
 *   - `isSidechain: true` is real but lives in a file the hook never sees.
 * Test `agent_id`. Nothing else.
 *
 * WHY THE VERB LIST IS A CONSTANT AND NOT PURE CONFIG. coder-role-gate.js reads its
 * scope entirely from overseer.json and fails OPEN (empty list) when the key is missing.
 * Copying that here would be wrong: overseer.json is locked this session, so a pure-data
 * list would resolve to empty and this gate would silently enforce NOTHING while looking
 * installed. So DEFAULT_BLOCKED below is the floor, and overseer.json's
 * roles.commitAuthority.mayNotRun overrides it only when it is a non-empty array. Missing
 * file, bad JSON, missing key or an empty array all fall back to DEFAULT_BLOCKED. A future
 * reader will want to "fix" this to match the sibling gate. Do not.
 *
 * KNOWN HOLES, stated rather than hidden:
 *
 * 1. COMMIT WRAPPER SCRIPTS WALK THROUGH. A PreToolUse hook only sees the command
 *    string, so `npm run commit` or `sh scripts/land.sh` hides the `git commit` inside
 *    it. This is deliberate: section 0 of roadmap-handoffs/overseer-roles-in-spirit.md
 *    grants the coder the right to execute a commit script it was handed. The fence for
 *    what actually lands is .githooks/pre-commit, which is tool-agnostic because git
 *    runs it whichever shell staged the change.
 *
 * 2. POLARITY INVERTS UNDER A NON-CLAUDE OVERSEER. `agent_id` is a Claude Code field.
 *    If the overseer role moves to another model, Claude Code becomes the coder, every
 *    call arrives with no agent_id, and this gate blocks nothing while blaming nobody.
 *    The replacement is a dispatch token written by the overseer before dispatch (item 5
 *    in that doc), deferred by human ruling.
 *
 * 3. Same coverage hole every PreToolUse matcher has: a file written through a Bash or
 *    PowerShell heredoc is not an Edit/Write call, so the trailer check (c) does not see
 *    it. The trailer-in-command check (b) catches the common shape of that.
 *
 * Exit 2 = block (stderr reaches Claude). Fails OPEN on its own errors.
 */
const fs = require('fs');
const path = require('path');

// The floor. See the header for why this is a constant rather than pure config.
const DEFAULT_BLOCKED = [
  'git commit',
  'git push',
  'git tag',
  'gh pr create',
  'gh release',
  'npm publish',
];

// The trailer is the architect's/overseer's signature that a change is acceptable.
// The coder typing it anywhere -- command, file content -- is the role violation itself.
const TRAILER = 'Role-Definition-Approved:';

const TOOLS_COMMAND = ['Bash', 'PowerShell'];
const TOOLS_WRITE = ['Edit', 'Write'];

function blockedVerbs(root) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, 'overseer.json'), 'utf8'));
    const list = cfg.roles.commitAuthority.mayNotRun;
    if (Array.isArray(list) && list.length) return list;
  } catch { /* fall through to the default */ }
  return DEFAULT_BLOCKED;
}

// "git commit" -> /\bgit(?:\s+-{1,2}[\w-]+(?:=[^\s;&|]+)?(?:\s+(?!-)[^\s;&|]+)?)*\s+commit(?![\w-])/i
//   - not anchored, so a verb after ";", "&&" or a pipe is caught
//   - \s+ between words, so "git   commit" is caught
//   - leading \b, so "mygit commit" is not this verb
//   - trailing (?![\w-]), so "git commits" and "git pushing" are not this verb
//   - FLAG RUN between the head word and the tail. Requiring the head and the verb to be
//     ADJACENT was a measured bypass: "git -C . commit", "git --no-pager commit",
//     "git -c user.name=x commit" and "npm --prefix . publish" all walked straight
//     through, and they are ordinary typing, not evasion. Only flag tokens (-x, --xyz,
//     --xyz=value) and ONE non-flag value token after a flag may sit in the gap, and
//     nothing may cross a ";", "&&" or a pipe. Multi-word verbs keep working because the
//     gap is head-to-tail only: "gh --repo owner/name pr create" is blocked.
// REJECTED, and do not "simplify" it back: matching head and verb anywhere in the same
// segment ("\bgit\b[^;&|]*?\bcommit") is looser and REGRESSES two commands that behave
// correctly today -- it would newly block "git stash push" and "git log --grep commit".
// The flag-run rule leaves both allowed.
function verbMatcher(verb) {
  const words = String(verb).trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (words.length < 2) return new RegExp('\\b' + words[0] + '(?![\\w-])', 'i');
  const flagRun = '(?:\\s+-{1,2}[\\w-]+(?:=[^\\s;&|]+)?(?:\\s+(?!-)[^\\s;&|]+)?)*';
  return new RegExp('\\b' + words[0] + flagRun + '\\s+' + words.slice(1).join('\\s+') + '(?![\\w-])', 'i');
}

function main() {
  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { return; }

  // No agent_id: the chat-facing session. That IS the commit authority. Never obstruct it.
  if (!input.agent_id) return;

  const tool = input.tool_name || '';
  const ti = input.tool_input || {};
  const root = input.cwd || process.cwd();

  let what = '';
  let why = '';

  if (TOOLS_COMMAND.includes(tool)) {
    const cmd = String(ti.command || '');
    if (!cmd) return;
    const hit = blockedVerbs(root).find((v) => verbMatcher(v).test(cmd));
    if (hit) { what = `command: ${cmd}`; why = `"${hit}" is the commit authority's call, not yours.`; }
    else if (cmd.includes(TRAILER)) { what = `command: ${cmd}`; why = `it types the ${TRAILER} approval trailer.`; }
  } else if (TOOLS_WRITE.includes(tool)) {
    // Edit: new_string is what lands. Write: content. old_string is what is being
    // REMOVED, so a trailer there is not the coder approving anything.
    const written = String(ti.new_string || '') + '\n' + String(ti.content || '');
    if (written.includes(TRAILER)) {
      what = `file: ${String(ti.file_path || '(unknown)')}`;
      why = `the written content contains the ${TRAILER} approval trailer.`;
    }
  }

  if (!what) return;

  process.stderr.write(
    `[commit-authority] BLOCKED: you are the CODER. You do not rule a commit acceptable.\n` +
    `  ${what}\n` +
    `  ${why}\n\n` +
    `This call carried an agent_id, so it came from a subagent. The ARCHITECT and the\n` +
    `OVERSEER are the only roles with authority to decide a change is fit to land. You\n` +
    `may stage (git add), inspect (git status/diff/log), run the verify gate and its\n` +
    `tests, and execute a commit script you were explicitly handed. Running the commit\n` +
    `yourself, pushing, tagging, publishing, or signing the approval trailer is that\n` +
    `judgment, and it is not yours to make.\n\n` +
    `There is no escape hatch by design. Rewording, splitting or wrapping the command to\n` +
    `slip past this is tampering with the gate, not a judgment call. Report the block to\n` +
    `the overseer with what you were trying to do, and stop.\n`
  );
  process.exit(2);
}

try { main(); } catch (e) {
  process.stderr.write('[commit-authority] guard error (failing OPEN): ' + e.message + '\n');
}
