// role-lock-check hook: the COMMIT-side fence for the role definition.
//
// The load-bearing test here is 'a locked path staged from ANY shell is refused'.
// role-lock.js can only see Edit and Write; this one sees the staged diff, so it is
// what actually stops a Bash or PowerShell write to the role definition.
//
// Drives the real hook against a real temporary git repo: git init, write, git add,
// write .git/COMMIT_EDITMSG, run the hook with cwd set there.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const GATE = path.join(__dirname, '..', '.claude', 'hooks', 'role-lock-check.js');

// No git, no meaningful test. Exit 2 = SKIP to test/run.js, not a failure.
if (spawnSync('git', ['--version'], { encoding: 'utf8' }).status !== 0) {
  console.log('SKIP role-lock-check: git is not available');
  process.exit(2);
}

let failed = 0;
function t(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}: ${e.message}`); }
}

const LOCKED = ['.claude/settings.json', 'overseer.json', '.githooks/**'];

// A throwaway repo per test. `overseerJson` null means the file is never written.
function makeRepo(name, overseerJson) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `role-lock-check-${name}-`));
  const g = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  g('init');
  // A brand-new repo has no identity configured on some machines; nothing here
  // commits, but keep it local and harmless.
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'test');
  if (overseerJson !== null) write(dir, 'overseer.json', overseerJson);
  return dir;
}
function write(dir, rel, content) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}
function stage(dir, rel) {
  const r = spawnSync('git', ['add', '--', rel], { cwd: dir, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, `git add ${rel} failed: ${r.stderr}`);
}
function message(dir, text) {
  fs.writeFileSync(path.join(dir, '.git', 'COMMIT_EDITMSG'), text);
}
function run(dir, msgPath) {
  const args = msgPath ? [GATE, msgPath] : [GATE];
  const r = spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf8' });
  return { status: r.status, stderr: r.stderr || '' };
}
function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* tmp, leave it */ }
}
const config = JSON.stringify({ roles: { locked: LOCKED } });

// THE point of this hook: the shell write that role-lock.js never sees.
t('a locked path with no approval trailer is refused', () => {
  const dir = makeRepo('refuse', config);
  try {
    write(dir, '.githooks/pre-commit', '#!/bin/sh\nexit 0\n');
    stage(dir, '.githooks/pre-commit');
    message(dir, 'fix: quietly widen my own boundary\n');
    const r = run(dir);
    assert.strictEqual(r.status, 1, r.stderr);
    assert.ok(/ROLE DEFINITION/.test(r.stderr), 'message should name the role definition');
  } finally { cleanup(dir); }
});

t('the approval trailer releases it', () => {
  const dir = makeRepo('approved', config);
  try {
    write(dir, '.githooks/pre-commit', '#!/bin/sh\nexit 0\n');
    stage(dir, '.githooks/pre-commit');
    message(dir, 'chore: add role gate\n\nRole-Definition-Approved: agreed in chat\n');
    assert.strictEqual(run(dir).status, 0);
  } finally { cleanup(dir); }
});

// The real mechanism: commit-msg hands the pending message as $1, a path that is
// NOT .git/COMMIT_EDITMSG (git has not written that file yet at this point in the
// real flow). Prove the gate reads argv, both ways, so the fix cannot be mistaken
// for a weakening of the gate.
t('an approval trailer passed via argv (not COMMIT_EDITMSG) releases it', () => {
  const dir = makeRepo('argv-approved', config);
  try {
    write(dir, '.githooks/pre-commit', '#!/bin/sh\nexit 0\n');
    stage(dir, '.githooks/pre-commit');
    const msgPath = path.join(dir, 'PENDING_MSG');
    fs.writeFileSync(msgPath, 'chore: add role gate\n\nRole-Definition-Approved: agreed in chat\n');
    assert.strictEqual(run(dir, msgPath).status, 0);
  } finally { cleanup(dir); }
});

t('a locked path with no approval trailer is refused via argv too', () => {
  const dir = makeRepo('argv-refuse', config);
  try {
    write(dir, '.githooks/pre-commit', '#!/bin/sh\nexit 0\n');
    stage(dir, '.githooks/pre-commit');
    const msgPath = path.join(dir, 'PENDING_MSG');
    fs.writeFileSync(msgPath, 'fix: quietly widen my own boundary\n');
    const r = run(dir, msgPath);
    assert.strictEqual(r.status, 1, r.stderr);
    assert.ok(/ROLE DEFINITION/.test(r.stderr), 'message should name the role definition');
  } finally { cleanup(dir); }
});

t('an unlocked path is not this hook\'s business', () => {
  const dir = makeRepo('unlocked', config);
  try {
    write(dir, 'src/app.jsx', 'export const App = () => null;\n');
    stage(dir, 'src/app.jsx');
    message(dir, 'feat: app change\n');
    assert.strictEqual(run(dir).status, 0);
  } finally { cleanup(dir); }
});

t('nothing staged is allowed', () => {
  const dir = makeRepo('empty', config);
  try {
    message(dir, 'chore: nothing\n');
    assert.strictEqual(run(dir).status, 0);
  } finally { cleanup(dir); }
});

// A broken lock must not become a gate that blocks every commit.
t('a missing overseer.json fails OPEN', () => {
  const dir = makeRepo('noconfig', null);
  try {
    write(dir, '.githooks/pre-commit', '#!/bin/sh\nexit 0\n');
    stage(dir, '.githooks/pre-commit');
    message(dir, 'chore: no config here\n');
    assert.strictEqual(run(dir).status, 0);
  } finally { cleanup(dir); }
});

t('a malformed overseer.json fails OPEN', () => {
  const dir = makeRepo('badconfig', '{ not json');
  try {
    write(dir, '.githooks/pre-commit', '#!/bin/sh\nexit 0\n');
    stage(dir, '.githooks/pre-commit');
    message(dir, 'chore: broken config\n');
    assert.strictEqual(run(dir).status, 0);
  } finally { cleanup(dir); }
});

console.log(failed ? `\n${failed} failed` : '\nall role-lock-check tests pass');
process.exit(failed ? 1 : 0);
