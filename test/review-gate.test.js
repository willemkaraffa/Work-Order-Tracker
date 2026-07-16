'use strict';
// Covers the review dismissal gate + the reviewer's pure helpers.
// Exit codes: 0 pass / 1 fail / 2 skip (see test/run.js).
//
// These import the SHIPPED scripts, never a hand-copy: a hand-copied gate would
// pass while the real one is broken, which is exactly the false-green this repo
// already got bitten by (see src/orders-logic.js history).
const assert = require('assert');
const { evaluate } = require('../scripts/review-gate.js');
const { parseFindings, diffHash, findingId } = require('../scripts/gemini-review.js');

let failed = 0;
function t(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}: ${e.message}`); }
}

const HASH = 'abc123';
const doc = (findings, hash = HASH) => ({ diffHash: hash, findings });
const finding = (over = {}) => ({
  id: 'f1', file: 'a.js', line: 1, severity: 'high', rule: 'correctness',
  problem: 'p', fix: 'x', status: 'open', reason: null, ...over,
});

// --- the gate's whole reason for existing -----------------------------------
t('no review on record blocks the commit', () => {
  const v = evaluate(null, HASH);
  assert.strictEqual(v.ok, false);
  assert.match(v.reason, /no review on record/);
});

t('stale review blocks (code moved after review)', () => {
  const v = evaluate(doc([], 'OLDHASH'), HASH);
  assert.strictEqual(v.ok, false);
  assert.match(v.reason, /STALE/);
});

t('an open finding blocks', () => {
  const v = evaluate(doc([finding()]), HASH);
  assert.strictEqual(v.ok, false);
  assert.match(v.reason, /OPEN/);
});

t('dismissal with NO reason blocks (the silent drop)', () => {
  const v = evaluate(doc([finding({ status: 'dismissed', reason: '' })]), HASH);
  assert.strictEqual(v.ok, false);
  assert.match(v.reason, /NO reason/);
});

t('dismissal with whitespace-only reason blocks', () => {
  const v = evaluate(doc([finding({ status: 'dismissed', reason: '   ' })]), HASH);
  assert.strictEqual(v.ok, false);
});

t('dismissal WITH a reason passes and is surfaced for the human', () => {
  const v = evaluate(doc([finding({ status: 'dismissed', reason: 'callers wrap it in try' })]), HASH);
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.dismissed.length, 1);
  assert.strictEqual(v.dismissed[0].reason, 'callers wrap it in try');
});

t('fixed findings pass and are not reported as dismissed', () => {
  const v = evaluate(doc([finding({ status: 'fixed' })]), HASH);
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.dismissed.length, 0);
});

t('clean review with zero findings passes', () => {
  const v = evaluate(doc([]), HASH);
  assert.strictEqual(v.ok, true);
});

t('one open among several dispositioned still blocks', () => {
  const v = evaluate(doc([
    finding({ id: 'a', status: 'fixed' }),
    finding({ id: 'b', status: 'dismissed', reason: 'ok' }),
    finding({ id: 'c', status: 'open' }),
  ]), HASH);
  assert.strictEqual(v.ok, false);
  assert.match(v.reason, /c/);
});

// --- reviewer helpers --------------------------------------------------------
t('parseFindings handles a bare array', () => {
  assert.strictEqual(parseFindings('[{"file":"a"}]').length, 1);
});

t('parseFindings strips json fences', () => {
  assert.strictEqual(parseFindings('```json\n[{"file":"a"}]\n```').length, 1);
});

t('parseFindings tolerates prose around the array', () => {
  assert.strictEqual(parseFindings('Findings:\n```json\n[]\n```\ndone').length, 0);
});

t('parseFindings throws when there is no array (routes to exit 2)', () => {
  assert.throws(() => parseFindings('no array here'));
});

t('diffHash is stable and content-sensitive', () => {
  assert.strictEqual(diffHash('abc'), diffHash('abc'));
  assert.notStrictEqual(diffHash('abc'), diffHash('abd'));
});

t('findingId is stable per file+line+problem', () => {
  const a = { file: 'x.js', line: 3, problem: 'boom' };
  assert.strictEqual(findingId(a), findingId({ ...a }));
  assert.notStrictEqual(findingId(a), findingId({ ...a, line: 4 }));
});

console.log(failed ? `\n${failed} failed` : '\nall review-gate tests pass');
process.exit(failed ? 1 : 0);
