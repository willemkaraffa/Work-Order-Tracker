'use strict';
// commit-authority-gate: only the architect and the overseer rule a commit acceptable.
// The coder is a subagent; it may stage and test, never commit/push/publish/approve.
//
// The gate keys on `agent_id`, a top-level PreToolUse payload field the harness sets
// only for subagent calls (probed on Claude Code 2.1.217). These tests feed the hook
// both payload shapes directly, so they test the real discriminator rather than a
// stand-in for it. Polarity is the INVERSE of coder-role-gate: agent_id present blocks.
//
// Exit codes: 0 pass / 1 fail (see test/run.js).
const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const GATE = path.join(__dirname, '..', '.claude', 'hooks', 'commit-authority-gate.js');
const REPO = path.join(__dirname, '..');

let failed = 0;
function t(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}: ${e.message}`); }
}

function run(input) {
  const r = spawnSync(process.execPath, [GATE], { input: JSON.stringify(input), encoding: 'utf8' });
  return { status: r.status, stderr: r.stderr || '' };
}

// The chat-facing session: no agent_id. This is the commit authority.
const overseer = (tool_input, tool_name = 'Bash') =>
  run({ hook_event_name: 'PreToolUse', tool_name, cwd: REPO, tool_input });

// A subagent: harness supplies agent_id + agent_type.
const coder = (tool_input, tool_name = 'Bash') =>
  run({
    hook_event_name: 'PreToolUse', tool_name, cwd: REPO,
    agent_id: 'a3dde38b918bcf7c0', agent_type: 'caveman:cavecrew-builder',
    tool_input,
  });

const VERBS = ['git commit -m "x"', 'git push', 'git tag v1.2.3', 'gh pr create --fill', 'gh release create v1', 'npm publish'];

// --- the six blocked verbs, subagent side ---

for (const cmd of VERBS) {
  t(`subagent BLOCKED: ${cmd}`, () => {
    const r = coder({ command: cmd });
    assert.strictEqual(r.status, 2);
    assert.match(r.stderr, /BLOCKED/);
  });
}

// --- the same six from the overseer: never obstructed ---

for (const cmd of VERBS) {
  t(`overseer ALLOWED: ${cmd}`, () => {
    assert.strictEqual(overseer({ command: cmd }).status, 0);
  });
}

// --- command-shape robustness ---

t('extra whitespace between the words still blocks', () => {
  assert.strictEqual(coder({ command: 'git   commit -m "x"' }).status, 2);
});

t('a chained command blocks (verb is not at the start)', () => {
  assert.strictEqual(coder({ command: 'npm test && git push' }).status, 2);
});

t('a verb after a semicolon blocks', () => {
  assert.strictEqual(coder({ command: 'npm run verify ; git commit -m "x"' }).status, 2);
});

// --- REGRESSION: a global flag between the head word and the verb used to walk through.
// The matcher required the two words to be ADJACENT, so any standard flag defeated the
// gate. Measured, not guessed: all four of these returned rc=0 while "git commit" got 2.

t('REGRESSION (flag-between-words bypass): git -C . commit blocks', () => {
  assert.strictEqual(coder({ command: 'git -C . commit -m x' }).status, 2);
});

t('REGRESSION (flag-between-words bypass): git --no-pager commit blocks', () => {
  assert.strictEqual(coder({ command: 'git --no-pager commit -m x' }).status, 2);
});

t('REGRESSION (flag-between-words bypass): git -c user.name=x commit blocks', () => {
  assert.strictEqual(coder({ command: 'git -c user.name=x commit' }).status, 2);
});

t('REGRESSION (flag-between-words bypass): npm --prefix . publish blocks', () => {
  assert.strictEqual(coder({ command: 'npm --prefix . publish' }).status, 2);
});

t('a multi-word verb behind a flag blocks (head/tail, not adjacency)', () => {
  assert.strictEqual(coder({ command: 'gh --repo owner/name pr create --fill' }).status, 2);
});

// --- the approval trailer ---

t('trailer in a Bash command blocks', () => {
  const r = coder({ command: 'echo "Role-Definition-Approved: overseer" >> notes.txt' });
  assert.strictEqual(r.status, 2);
});

t('trailer in a Write content blocks', () => {
  const r = coder({ file_path: 'notes.md', content: 'Role-Definition-Approved: me' }, 'Write');
  assert.strictEqual(r.status, 2);
});

t('trailer in an Edit new_string blocks', () => {
  const r = coder({ file_path: 'notes.md', old_string: 'a', new_string: 'Role-Definition-Approved: me' }, 'Edit');
  assert.strictEqual(r.status, 2);
});

t('trailer in old_string ONLY is allowed (it is being removed, not written)', () => {
  const r = coder({ file_path: 'notes.md', old_string: 'Role-Definition-Approved: me', new_string: 'x' }, 'Edit');
  assert.strictEqual(r.status, 0);
});

// --- what the coder is explicitly allowed to do ---

t('subagent ALLOWED: staging and read-only git', () => {
  assert.strictEqual(coder({ command: 'git status' }).status, 0);
  assert.strictEqual(coder({ command: 'git add -A' }).status, 0);
  assert.strictEqual(coder({ command: 'git diff --staged' }).status, 0);
  assert.strictEqual(coder({ command: 'git log --oneline -5' }).status, 0);
});

t('subagent ALLOWED: near-misses on the verb list (word boundary)', () => {
  assert.strictEqual(coder({ command: 'git checkout pushing-branch-name' }).status, 0);
  assert.strictEqual(coder({ command: 'git commits' }).status, 0);
  assert.strictEqual(coder({ command: 'git pushing' }).status, 0);
});

// The flag-run rule allows ONLY flags (and one value each) in the gap. These two are the
// commands a looser "head ... verb anywhere in the segment" rule would wrongly block.
t('subagent ALLOWED: a non-flag word in the gap is not a flag run', () => {
  assert.strictEqual(coder({ command: 'git stash push' }).status, 0);
  assert.strictEqual(coder({ command: 'git log --grep commit' }).status, 0);
});

// DOCUMENTED HOLE, asserted so it is visible rather than assumed shut. A PreToolUse hook
// sees only the command string, so a wrapper hides the git commit inside it. This is
// INTENTIONAL: the coder is granted the right to execute a commit script it was handed,
// and .githooks/pre-commit is the tool-agnostic fence for what actually lands. This test
// passing is NOT proof the hole is closed -- it is proof the hole is where we think.
t('subagent ALLOWED: a commit wrapper script (DOCUMENTED HOLE, intentional)', () => {
  assert.strictEqual(coder({ command: 'npm run commit' }).status, 0);
  assert.strictEqual(coder({ command: 'sh scripts/land.sh' }).status, 0);
});

// --- tool coverage and the discriminator ---

t('PowerShell is gated the same as Bash', () => {
  const r = coder({ command: 'git push' }, 'PowerShell');
  assert.strictEqual(r.status, 2);
});

t('agent_id is what decides, not agent_type', () => {
  const r = run({
    hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd: REPO,
    agent_id: 'anything', tool_input: { command: 'git push' },
  });
  assert.strictEqual(r.status, 2);
});

t('a tool the gate does not cover is not its business', () => {
  assert.strictEqual(coder({ command: 'git push' }, 'Read').status, 0);
});

// --- shape robustness ---

t('missing tool_input does not crash the gate', () => {
  const r = run({
    hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd: REPO, agent_id: 'x',
  });
  assert.strictEqual(r.status, 0);
});

t('missing command does not crash the gate', () => {
  assert.strictEqual(coder({}).status, 0);
});

t('garbage stdin fails OPEN', () => {
  const r = spawnSync(process.execPath, [GATE], { input: 'not json', encoding: 'utf8' });
  assert.strictEqual(r.status, 0);
});

console.log(failed ? `\n${failed} failed` : '\nall commit-authority-gate tests pass');
process.exit(failed ? 1 : 0);
