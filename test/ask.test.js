'use strict';
// Covers ask.js: the read-displacement tool (Gemini reads the files, Claude gets the
// answer). Exit codes: 0 pass / 1 fail / 2 skip (see test/run.js).
//
// OFFLINE ON PURPOSE, same contract as architect.test.js. Every case here either
// calls the pure glob helper or drives the real CLI down a path that returns BEFORE
// callGemini. No key, no network, no quota. The LIVE answer path is therefore NOT
// covered here and must still be proven by running the script for real; this file is
// not evidence that it was.
//
// Imports the SHIPPED script, never a hand-copy.
const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const { expandGlob } = require('../scripts/ask.js');

let failed = 0;
function t(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}: ${e.message}`); }
}

// ============================================================================
// expandGlob: decides WHAT gets shipped to Gemini. Over-matching here is not a
// cosmetic bug, it is a bill.
// ============================================================================

t('glob: an exact tracked path resolves to itself', () => {
  assert.deepStrictEqual(expandGlob('scripts/ask.js'), ['scripts/ask.js']);
});

t('glob: a pattern resolves to the tracked files under it', () => {
  const files = expandGlob('scripts/*.js');
  assert.ok(files.includes('scripts/ask.js'), 'scripts/*.js must match ask.js');
  assert.ok(files.length > 1, 'scripts/ holds more than one .js');
  assert.ok(files.every(f => f.startsWith('scripts/')), 'no path may escape the pattern');
});

t('glob: a pattern matching nothing returns EMPTY, not everything', () => {
  assert.deepStrictEqual(expandGlob('no/such/dir/*.js'), []);
});

t('glob: a MISSING pattern returns empty (never the whole repo)', () => {
  // `node scripts/ask.js "q" --glob` with the pattern forgotten hands undefined ->
  // '' down to git, which REFUSES an empty pathspec ("please use . instead"). The
  // catch turns that into []. If git ever accepted it, a typo would ship every
  // tracked file in the repo to the API in one call.
  assert.deepStrictEqual(expandGlob(''), []);
  assert.deepStrictEqual(expandGlob(undefined), []);
});

t('glob: untracked trees stay out (git ls-files knows only the tracked set)', () => {
  // node_modules is the expensive one. It is never tracked, so it can never match.
  assert.deepStrictEqual(expandGlob('node_modules/*'), []);
});

// ============================================================================
// The CLI's pre-API refusals. Each of these must exit 2 having called NOTHING:
// "no answer" is the correct outcome, and it must be cheap.
// ============================================================================

const ASK = path.join(__dirname, '..', 'scripts', 'ask.js');
const ask = (...args) => spawnSync(process.execPath, [ASK, ...args], { encoding: 'utf8' });

t('cli: no arguments prints usage and exits 2', () => {
  const r = ask();
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /usage:/);
});

t('cli: a question with no files exits 2', () => {
  const r = ask('where is the invoice total computed');
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /no files/);
});

t('cli: --glob matching nothing exits 2', () => {
  const r = ask('what does this do', '--glob', 'no/such/dir/*.js');
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /no files/);
});

t('cli: --glob with the pattern omitted exits 2 (does not ship the repo)', () => {
  const r = ask('what does this do', '--glob');
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /no files/);
});

t('cli: paths that are all unreadable exit 2 before any API call', () => {
  const r = ask('what does this do', 'no/such/file.js');
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /none of the 1 path/);
});

console.log(failed ? `\n${failed} failed` : '\nall ask tests pass');
process.exit(failed ? 1 : 0);
