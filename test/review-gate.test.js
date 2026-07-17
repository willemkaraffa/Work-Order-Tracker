'use strict';
// Covers the review dismissal gate + the reviewer's pure helpers.
// Exit codes: 0 pass / 1 fail / 2 skip (see test/run.js).
//
// These import the SHIPPED scripts, never a hand-copy: a hand-copied gate would
// pass while the real one is broken, which is exactly the false-green this repo
// already got bitten by (see src/orders-logic.js history).
const assert = require('assert');
const { evaluate } = require('../scripts/review-gate.js');
const {
  parseFindings, diffHash, findingId, mergeFindings, buildFileContext,
} = require('../scripts/gemini-review.js');

let failed = 0;
function t(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}: ${e.message}`); }
}

const HASH = 'abc123';
const doc = (findings, hash = HASH) => ({ diffHash: hash, findings });
const finding = (over = {}) => ({
  id: 'f1', file: 'a.js', line: 1, symbol: 'sym', severity: 'high', rule: 'correctness',
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

// --- symbol discipline: an uncitable open finding blocks, is NOT auto-dropped --
t('open finding with NO symbol blocks as uncitable', () => {
  const v = evaluate(doc([finding({ symbol: '' })]), HASH);
  assert.strictEqual(v.ok, false);
  assert.match(v.reason, /NO symbol/);
});

t('whitespace-only symbol is treated as no symbol', () => {
  const v = evaluate(doc([finding({ symbol: '   ' })]), HASH);
  assert.strictEqual(v.ok, false);
  assert.match(v.reason, /NO symbol/);
});

t('a symbol-less finding that is DISMISSED with a reason passes (uncitable only gates open)', () => {
  const v = evaluate(doc([finding({ symbol: '', status: 'dismissed', reason: 'not real' })]), HASH);
  assert.strictEqual(v.ok, true);
});

t('uncitable is reported before generic-open so its message wins', () => {
  const v = evaluate(doc([
    finding({ id: 'withsym', symbol: 'x' }),
    finding({ id: 'nosym', symbol: '' }),
  ]), HASH);
  assert.strictEqual(v.ok, false);
  assert.match(v.reason, /NO symbol/);
  assert.match(v.reason, /nosym/);
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

t('findingId IGNORES symbol (an unstable symbol must not fracture identity)', () => {
  const a = { file: 'x.js', line: 3, problem: 'boom', symbol: 'quote' };
  const b = { file: 'x.js', line: 3, problem: 'boom', symbol: 'quote(y)' };
  assert.strictEqual(findingId(a), findingId(b), 'same finding, differing symbol -> one id');
});

t('findingId does not collide across a pipe in the problem text', () => {
  // The pipe-joined version made these two identical.
  const a = { file: 'x.js', line: 1, problem: 'a|b' };
  const b = { file: 'x.js', line: '1|a', problem: 'b' };
  assert.notStrictEqual(findingId(a), findingId(b));
});

// --- anti-laundering: a re-roll must not be able to drop a finding ------------
const raw = (over = {}) => ({ file: 'a.js', line: 1, symbol: 'sym', severity: 'high', rule: 'correctness', problem: 'p', fix: 'x', ...over });

t('LAUNDERING BLOCKED: an open finding absent from a re-run stays open', () => {
  const first = mergeFindings(null, [raw()], 'h1', 'm');
  assert.strictEqual(first.findings.length, 1);
  assert.strictEqual(first.findings[0].status, 'open');
  // Re-roll returns NOTHING (the model forgot it).
  const second = mergeFindings(first, [], 'h2', 'm');
  assert.strictEqual(second.findings.length, 1, 'finding must survive the re-roll');
  assert.strictEqual(second.findings[0].status, 'open', 'must still block the commit');
});

t('a carried finding is marked as not-seen-this-run', () => {
  const first = mergeFindings(null, [raw()], 'h1', 'm');
  const second = mergeFindings(first, [], 'h2', 'm');
  assert.strictEqual(second.findings[0].lastSeen, 'h1');
  assert.notStrictEqual(second.findings[0].lastSeen, second.diffHash);
});

t('a re-raised finding keeps its existing disposition (no reset to open)', () => {
  const first = mergeFindings(null, [raw()], 'h1', 'm');
  first.findings[0].status = 'dismissed';
  first.findings[0].reason = 'verified false positive';
  const second = mergeFindings(first, [raw()], 'h2', 'm');
  assert.strictEqual(second.findings.length, 1);
  assert.strictEqual(second.findings[0].status, 'dismissed');
  assert.strictEqual(second.findings[0].reason, 'verified false positive');
  assert.strictEqual(second.findings[0].lastSeen, 'h2', 're-raised, so lastSeen advances');
});

t('re-raise BACKFILLS a missing symbol so an uncitable finding becomes citable', () => {
  const first = mergeFindings(null, [raw({ symbol: '' })], 'h1', 'm');
  assert.strictEqual(first.findings[0].symbol, '');
  const second = mergeFindings(first, [raw({ symbol: 'realSymbol' })], 'h2', 'm');
  assert.strictEqual(second.findings.length, 1, 'same finding, not a duplicate');
  assert.strictEqual(second.findings[0].symbol, 'realSymbol', 'missing symbol filled on re-raise');
});

t('re-raise does NOT overwrite an existing symbol', () => {
  const first = mergeFindings(null, [raw({ symbol: 'original' })], 'h1', 'm');
  const second = mergeFindings(first, [raw({ symbol: 'drifted' })], 'h2', 'm');
  assert.strictEqual(second.findings[0].symbol, 'original', 'a known finding keeps its symbol');
});

t('a fixed finding stays fixed and does not reopen when re-raised', () => {
  const first = mergeFindings(null, [raw()], 'h1', 'm');
  first.findings[0].status = 'fixed';
  const second = mergeFindings(first, [raw()], 'h2', 'm');
  assert.strictEqual(second.findings[0].status, 'fixed');
});

t('genuinely new findings are added alongside carried ones', () => {
  const first = mergeFindings(null, [raw()], 'h1', 'm');
  const second = mergeFindings(first, [raw({ problem: 'different bug' })], 'h2', 'm');
  assert.strictEqual(second.findings.length, 2);
  assert.strictEqual(second.findings.filter(f => f.status === 'open').length, 2);
});

t('merged ledger still blocks the gate while a carried finding is open', () => {
  const first = mergeFindings(null, [raw()], 'h1', 'm');
  const second = mergeFindings(first, [], 'h2', 'm');
  const v = evaluate(second, 'h2');
  assert.strictEqual(v.ok, false, 'carried-open finding must refuse the commit');
});

// --- diff-only blindness: the reviewer must get whole files, not just the diff --
const reader = (map) => (f) => (f in map ? map[f] : null);

t('BLINDNESS FIXED: unchanged code reaches the reviewer via full file text', () => {
  // The exact false positive: parseFindings exists in the file, never in the diff.
  const ctx = buildFileContext(['a.js'], reader({ 'a.js': 'function parseFindings(){}\n' }));
  assert.match(ctx.text, /function parseFindings/);
  assert.deepStrictEqual(ctx.included, ['a.js']);
});

t('each file is labelled with its path', () => {
  const ctx = buildFileContext(['x/y.js'], reader({ 'x/y.js': 'body' }));
  assert.match(ctx.text, /--- x\/y\.js ---/);
});

t('deleted/unreadable files are skipped, not crashed on', () => {
  const ctx = buildFileContext(['gone.js', 'ok.js'], reader({ 'ok.js': 'kept' }));
  assert.deepStrictEqual(ctx.skipped, ['gone.js']);
  assert.deepStrictEqual(ctx.included, ['ok.js']);
});

t('binary files are skipped', () => {
  const ctx = buildFileContext(['b.png'], reader({ 'b.png': 'PNG\0\0data' }));
  assert.deepStrictEqual(ctx.skipped, ['b.png']);
  assert.strictEqual(ctx.included.length, 0);
});

t('an over-budget file is truncated AND reported as truncated', () => {
  const ctx = buildFileContext(['big.js'], reader({ 'big.js': 'x'.repeat(100) }), 10, 1000);
  assert.deepStrictEqual(ctx.truncated, ['big.js']);
  assert.match(ctx.text, /TRUNCATED/);
  assert.ok(ctx.text.length < 100, 'must actually shrink');
});

t('total budget stops runaway context and reports what it dropped', () => {
  const ctx = buildFileContext(
    ['a.js', 'b.js', 'c.js'],
    reader({ 'a.js': 'x'.repeat(60), 'b.js': 'y'.repeat(60), 'c.js': 'z'.repeat(60) }),
    100, 100
  );
  assert.ok(ctx.included.length < 3, 'must not include everything');
  assert.ok(ctx.skipped.length > 0, 'dropped files must be reported, not silent');
});

t('empty file list yields empty context, not a crash', () => {
  const ctx = buildFileContext([], reader({}));
  assert.strictEqual(ctx.text, '');
  assert.strictEqual(ctx.included.length, 0);
});

console.log(failed ? `\n${failed} failed` : '\nall review-gate tests pass');
process.exit(failed ? 1 : 0);
