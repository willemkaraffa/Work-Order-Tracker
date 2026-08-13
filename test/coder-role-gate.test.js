'use strict';
// coder-role-gate: the overseer may not write app code; a subagent must.
//
// The gate keys on `agent_id`, a top-level PreToolUse payload field the harness sets
// only for subagent calls (probed on Claude Code 2.1.217). These tests feed the hook
// both payload shapes directly, so they test the real discriminator rather than a
// stand-in for it.
//
// Written against the ACTUAL 2026-07-22 incident file (main.js), not against a
// convenient example. The user-authority gate in this repo was tested against the
// symptom instead and passed its own suite while missing the edit it existed to stop.
//
// Exit codes: 0 pass / 1 fail (see test/run.js).
const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const GATE = path.join(__dirname, '..', '.claude', 'hooks', 'coder-role-gate.js');
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

// The chat-facing session: no agent_id.
const overseer = (file_path, tool_name = 'Write') =>
  run({ hook_event_name: 'PreToolUse', tool_name, cwd: REPO, tool_input: { file_path } });

// A subagent: harness supplies agent_id + agent_type.
const coder = (file_path, tool_name = 'Write') =>
  run({
    hook_event_name: 'PreToolUse', tool_name, cwd: REPO,
    agent_id: 'a3dde38b918bcf7c0', agent_type: 'caveman:cavecrew-builder',
    tool_input: { file_path },
  });

// --- the discriminator itself ---

t('overseer writing app code is BLOCKED', () => {
  const r = overseer('src/app.jsx');
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /BLOCKED/);
});

t('subagent writing the same file is ALLOWED', () => {
  assert.strictEqual(coder('src/app.jsx').status, 0);
});

t('agent_id is what decides, not agent_type', () => {
  const r = run({
    hook_event_name: 'PreToolUse', tool_name: 'Write', cwd: REPO,
    agent_id: 'anything', tool_input: { file_path: 'src/app.jsx' },
  });
  assert.strictEqual(r.status, 0);
});

// --- the 2026-07-22 incident file ---

t('overseer editing main.js is BLOCKED (the actual incident file)', () => {
  const r = overseer('main.js', 'Edit');
  assert.strictEqual(r.status, 2, 'the capture-routing edit lived in main.js');
});

t('overseer editing preload.js is BLOCKED', () => {
  assert.strictEqual(overseer('preload.js', 'Edit').status, 2);
});

// --- scope: app code in, everything else out ---

t('extension code is app code', () => {
  assert.strictEqual(overseer('extension/content.js').status, 2);
});

t('python scrapers are app code', () => {
  assert.strictEqual(overseer('scrape_amh.py').status, 2);
});

t('src at any depth is app code', () => {
  assert.strictEqual(overseer('src/modules/nested/thing.jsx').status, 2);
});

// Scope widened 2026-07-23: the old boundary exempted every category the overseer actually worked in.
t('the gate itself is now the coder\'s', () => {
  assert.strictEqual(overseer('.claude/hooks/coder-role-gate.js').status, 2);
});

// Scope widened 2026-07-23: the old boundary exempted every category the overseer actually worked in.
t('harness scripts are now the coder\'s', () => {
  assert.strictEqual(overseer('scripts/gemini-review.js').status, 2);
});

// Scope widened 2026-07-23: the old boundary exempted every category the overseer actually worked in.
t('tests are now the coder\'s', () => {
  assert.strictEqual(overseer('test/coder-role-gate.test.js').status, 2);
});

t('.claude/hooks/** is blocked for the overseer', () => {
  assert.strictEqual(overseer('.claude/hooks/role-lock.js').status, 2);
});

t('the coder may still write all of it', () => {
  assert.strictEqual(coder('scripts/gemini-review.js').status, 0);
  assert.strictEqual(coder('test/coder-role-gate.test.js').status, 0);
});

t('docs are still the overseer\'s', () => {
  assert.strictEqual(overseer('roadmap-handoffs/x.md').status, 0);
});

t('test/** does not over-match testing/ (non-code path)', () => {
  assert.strictEqual(overseer('testing/x.md').status, 0);
});

t('any .js is code under default-deny, incl testing/', () => {
  assert.strictEqual(overseer('testing/x.js').status, 2);
});

t('a nested python file matches **/*.py', () => {
  assert.strictEqual(overseer('a/b/c.py').status, 2);
});

t('docs stay writable by the overseer', () => {
  assert.strictEqual(overseer('roadmap-handoffs/overseer-role-hierarchy.md').status, 0);
});

t('node_modules is not this repo app code', () => {
  assert.strictEqual(overseer('node_modules/project-overseer/src/thing.js').status, 0);
});

t('a path outside the repo is not app code', () => {
  const outside = path.join(require('os').tmpdir(), 'scratch', 'note.py');
  assert.strictEqual(overseer(outside).status, 0);
});

t('an absolute path INSIDE the repo is still app code', () => {
  const inside = path.join(REPO, 'src', 'app.jsx');
  assert.strictEqual(overseer(inside).status, 2, 'absolute paths must normalise, not bypass');
});

// --- shape robustness ---

t('non-write tools are not this gate\'s business', () => {
  assert.strictEqual(overseer('src/app.jsx', 'Bash').status, 0);
});

t('missing file_path does not crash the gate', () => {
  const r = run({ hook_event_name: 'PreToolUse', tool_name: 'Write', cwd: REPO, tool_input: {} });
  assert.strictEqual(r.status, 0);
});

t('garbage stdin fails OPEN', () => {
  const r = spawnSync(process.execPath, [GATE], { input: 'not json', encoding: 'utf8' });
  assert.strictEqual(r.status, 0);
});

console.log(failed ? `\n${failed} failed` : '\nall coder-role-gate tests pass');
process.exit(failed ? 1 : 0);
