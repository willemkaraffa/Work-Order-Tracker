'use strict';
// Covers cite.js, the reviewer's minion: verify-by-content + verbatim serve.
// Exit codes: 0 pass / 1 fail / 2 skip (see test/run.js).
// Imports the SHIPPED script; `read` is injected so this needs no fs/git.
const assert = require('assert');
const { cite, offsetToLine, allIndexes, renderSpan } = require('../scripts/cite.js');

let failed = 0;
function t(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}: ${e.message}`); }
}

const finding = (over = {}) => ({
  id: 'f1', file: 'a.js', line: 1, symbol: 'sym', severity: 'high', rule: 'correctness',
  problem: 'p', fix: 'x', status: 'open', reason: null, ...over,
});
const reader = (map) => (f) => (f.file in map ? map[f.file] : null);

// --- pure helpers ------------------------------------------------------------
t('offsetToLine maps char offset to 1-based line', () => {
  const text = 'a\nb\nTARGET\nd';
  assert.strictEqual(offsetToLine(text, text.indexOf('TARGET')), 3);
  assert.strictEqual(offsetToLine(text, 0), 1);
});

t('allIndexes finds every occurrence', () => {
  assert.deepStrictEqual(allIndexes('xAxAx', 'A'), [1, 3]);
  assert.deepStrictEqual(allIndexes('abc', 'zzz'), []);
  assert.deepStrictEqual(allIndexes('abc', ''), []);
});

t('renderSpan marks the hit line and shows real line numbers', () => {
  const text = 'l1\nl2\nHIT\nl4\nl5';
  const span = renderSpan(text, text.indexOf('HIT'), 1, 'id9', 'a.js');
  assert.match(span, /> {1,}3 {2}HIT/); // hit line marked '>'
  assert.match(span, /\[cite id9 a\.js:2-4\]/); // span is hit +/- 1
});

// --- verify by content: absent symbol is a POSITIVE disproof -> auto-dismiss --
t('symbol not found verbatim -> auto-dismissed with grep proof as reason', () => {
  const doc = { findings: [finding({ symbol: 'does.not.exist' })] };
  const r = cite(doc, { read: reader({ 'a.js': 'const x = realThing()' }) });
  assert.deepStrictEqual(r.dismissed, ['f1']);
  assert.strictEqual(doc.findings[0].status, 'dismissed');
  assert.match(doc.findings[0].reason, /not found verbatim/);
  assert.match(doc.findings[0].reason, /cite\.js/);
});

t('missing/unreadable file -> auto-dismissed (symbol cannot exist there)', () => {
  const doc = { findings: [finding({ file: 'gone.js', symbol: 'anything' })] };
  const r = cite(doc, { read: reader({}) });
  assert.deepStrictEqual(r.dismissed, ['f1']);
  assert.match(doc.findings[0].reason, /missing\/unreadable/);
});

// --- found symbol: SERVE, do not judge --------------------------------------
t('symbol found -> served verbatim, finding stays OPEN (cite does not resolve it)', () => {
  const doc = { findings: [finding({ symbol: 'urllib.request.quote' })] };
  const r = cite(doc, { context: 1, read: reader({ 'a.js': 'l1\nx = urllib.request.quote(y)\nl3' }) });
  assert.strictEqual(r.dismissed.length, 0);
  assert.strictEqual(doc.findings[0].status, 'open', 'a real-code finding is NOT auto-killed');
  assert.strictEqual(r.blocks.length, 1);
  assert.match(r.blocks[0], /urllib\.request\.quote/);
  assert.match(r.blocks[0], /\[cite f1 a\.js:/);
});

t('served span is verbatim bytes, not a paraphrase', () => {
  const doc = { findings: [finding({ symbol: 'NEEDLE' })] };
  const src = 'alpha\nbeta NEEDLE gamma\ndelta';
  const r = cite(doc, { context: 0, read: reader({ 'a.js': src }) });
  assert.match(r.blocks[0], /beta NEEDLE gamma/); // exact source line present
});

// --- symbol-less finding: LEFT OPEN, never dropped (safe bias) ---------------
t('no-symbol open finding is skipped, left open, and flagged for the gate', () => {
  const doc = { findings: [finding({ symbol: '' })] };
  const r = cite(doc, { read: reader({ 'a.js': 'whatever' }) });
  assert.deepStrictEqual(r.missing, ['f1']);
  assert.strictEqual(r.dismissed.length, 0);
  assert.strictEqual(doc.findings[0].status, 'open', 'must NOT be auto-dropped');
});

// --- scope + selection -------------------------------------------------------
t('only OPEN findings are cited (dismissed/fixed are left alone)', () => {
  const doc = { findings: [
    finding({ id: 'a', status: 'dismissed', reason: 'r', symbol: 'zzz' }),
    finding({ id: 'b', status: 'fixed', symbol: 'zzz' }),
    finding({ id: 'c', status: 'open', symbol: 'HIT' }),
  ] };
  const r = cite(doc, { read: reader({ 'a.js': 'HIT here' }) });
  assert.strictEqual(r.blocks.length, 1);
  assert.match(r.blocks[0], /--- c /);
});

t('id filter (prefix) restricts which findings are cited', () => {
  const doc = { findings: [
    finding({ id: 'aaa111', symbol: 'HIT' }),
    finding({ id: 'bbb222', symbol: 'HIT' }),
  ] };
  const r = cite(doc, { ids: ['aaa'], read: reader({ 'a.js': 'HIT' }) });
  assert.strictEqual(r.blocks.length, 1);
  assert.match(r.blocks[0], /aaa111/);
});

t('a too-generic symbol matching many sites is capped and flagged', () => {
  const doc = { findings: [finding({ symbol: 'x' })] };
  const r = cite(doc, { context: 0, read: reader({ 'a.js': 'x\nx\nx\nx\nx' }) });
  assert.match(r.blocks[0], /more occurrence/);
});

console.log(failed ? `\n${failed} failed` : '\nall cite tests pass');
process.exit(failed ? 1 : 0);
