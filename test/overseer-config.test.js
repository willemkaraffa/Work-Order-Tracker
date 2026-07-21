'use strict';
/*
 * The two portability seams, plus the derived transcript key.
 *
 * WHAT THIS IS GUARDING. Project Overseer is a general frame that lived inside one
 * app repo, and three places had this app spelled out in the frame's own source: the
 * verify command, the review rubric, and the transcript directory. Each one failed
 * SILENTLY elsewhere (a gate that cannot find its command, a reviewer with no
 * triggers, an approval channel that reads an empty directory as "the human said
 * no"). Silence is why they get tests rather than a comment.
 *
 * Exit: 0 pass, 1 fail. No fixtures, so this belongs in the logic subset.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

let failed = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
};

const REPO = path.join(__dirname, '..');
const cfg = require('../scripts/overseer-config.js');

console.log('overseer-config: the portability seams');

t('config: this repo\'s overseer.json is present and parses', () => {
  const c = cfg.config();
  assert.strictEqual(c.verifyCommand, 'npm run verify');
  assert.strictEqual(c.rubricFile, '.claude/rubric.md');
});

t('config: defaults preserve current behaviour when keys are absent', () => {
  // The seam must not be able to CHANGE what this repo does, only to let another
  // repo answer differently. Absent key -> the value that was hardcoded before.
  assert.strictEqual(cfg.DEFAULTS.verifyCommand, 'npm run verify');
  assert.strictEqual(cfg.DEFAULTS.rubricFile, '.claude/rubric.md');
});

t('config: a malformed overseer.json falls back instead of throwing', () => {
  // This loader runs inside the commit gate. A stray comma must not take the gate
  // down; it must degrade to the defaults, which are still real gate behaviour.
  const saved = fs.readFileSync(cfg.CONFIG_FILE, 'utf8');
  try {
    fs.writeFileSync(cfg.CONFIG_FILE, '{ this is not json ');
    delete require.cache[require.resolve('../scripts/overseer-config.js')];
    const fresh = require('../scripts/overseer-config.js');
    assert.strictEqual(fresh.config().verifyCommand, 'npm run verify');
  } finally {
    fs.writeFileSync(cfg.CONFIG_FILE, saved);
    delete require.cache[require.resolve('../scripts/overseer-config.js')];
  }
});

t('rubric: the project checks file exists and carries real triggers', () => {
  const r = require('../scripts/overseer-config.js').rubric();
  assert.ok(r, 'rubric must load');
  assert.match(r, /A1 mirror-state/);
  assert.match(r, /A7 uncleaned-timer/);
});

t('rubric: an empty rubric file reads as MISSING, not as "no rules"', () => {
  // A reviewer with zero triggers still returns [] and still looks like a clean
  // pass. Empty must be indistinguishable from absent so the caller can refuse.
  const f = path.join(REPO, cfg.config().rubricFile);
  const saved = fs.readFileSync(f, 'utf8');
  try {
    fs.writeFileSync(f, '   \n\n');
    delete require.cache[require.resolve('../scripts/overseer-config.js')];
    assert.strictEqual(require('../scripts/overseer-config.js').rubric(), null);
  } finally {
    fs.writeFileSync(f, saved);
    delete require.cache[require.resolve('../scripts/overseer-config.js')];
  }
});

t('gemini-review: no rubric means exit 2 (DID NOT RUN), never a clean 0', () => {
  // Asserted by RUNNING the script with the rubric pointed at nothing, because the
  // whole risk is that this path returns 0 and reads as a passed review.
  const saved = fs.readFileSync(cfg.CONFIG_FILE, 'utf8');
  try {
    fs.writeFileSync(cfg.CONFIG_FILE, JSON.stringify({ rubricFile: 'no/such/rubric.md' }));
    const r = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'gemini-review.js'), '--dry-run'],
      { cwd: REPO, encoding: 'utf8' });
    assert.strictEqual(r.status, 2, `expected exit 2, got ${r.status}: ${r.stderr}`);
    assert.match(r.stderr, /DID NOT RUN/);
  } finally {
    fs.writeFileSync(cfg.CONFIG_FILE, saved);
  }
});

t('transcript dir is DERIVED from the repo path, not hardcoded', () => {
  // The old literal 'C--dev-Work-Order-Tracker' made the human-approval channel
  // dead in every other checkout, and no-transcript is read as no-approval.
  const { projectKey } = require('../scripts/plan-approve.js');
  assert.strictEqual(projectKey('C:\\dev\\Work-Order-Tracker'), 'C--dev-Work-Order-Tracker');
  assert.strictEqual(projectKey('/home/u/some_proj'), '-home-u-some-proj');
});

console.log(failed ? `\n${failed} failed` : '\nall overseer-config tests pass');
process.exit(failed ? 1 : 0);
