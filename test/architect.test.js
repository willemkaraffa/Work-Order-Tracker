'use strict';
// Covers the ARCHITECT: the rank-2 role that rules on reviewer findings and drafts
// plans. Exit codes: 0 pass / 1 fail / 2 skip (see test/run.js).
//
// OFFLINE ON PURPOSE. Every test here exercises the pure helpers and the CLI's
// pre-API argument handling. None of them makes a Gemini call, so the suite stays
// runnable with no key, no network, and no quota. That means the LIVE call path is
// NOT covered here; it has to be proven by actually running the script once, and
// this file must never be mistaken for proof that it was.
//
// Imports the SHIPPED script, never a hand-copy (the false-green this repo already
// got bitten by; see src/orders-logic.js history).
const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseRuling, applyRuling, validatePlan, planId } = require('../scripts/architect.js');
const { evaluate } = require('../scripts/review-gate.js');

let failed = 0;
function t(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}: ${e.message}`); }
}
const throws = (fn, re) => assert.throws(fn, re);

// ============================================================================
// parseRuling: the architect's verdict must survive the trip intact, and anything
// malformed must FAIL rather than degrade into a favourable outcome.
// ============================================================================

t('ruling: a clean JSON verdict parses', () => {
  const r = parseRuling('{"verdict":"dismissed","reason":"guarded by the caller"}');
  assert.deepStrictEqual(r, { verdict: 'dismissed', reason: 'guarded by the caller' });
});

t('ruling: markdown fences and stray prose are tolerated', () => {
  const r = parseRuling('Here you go:\n```json\n{"verdict":"open","reason":"unverifiable"}\n```');
  assert.strictEqual(r.verdict, 'open');
});

t('ruling: verdict case is normalised', () => {
  assert.strictEqual(parseRuling('{"verdict":"FIXED","reason":"resolved in the file"}').verdict, 'fixed');
});

t('ruling: an unknown verdict THROWS (never degrades to a pass)', () => {
  throws(() => parseRuling('{"verdict":"approved","reason":"lgtm"}'), /unknown verdict/);
});

t('ruling: a verdict with NO reason THROWS', () => {
  // A reason-less ruling is exactly the silent drop the whole ledger exists to stop.
  throws(() => parseRuling('{"verdict":"dismissed"}'), /no reason/);
  throws(() => parseRuling('{"verdict":"dismissed","reason":"   "}'), /no reason/);
});

t('ruling: unparseable output THROWS rather than returning something', () => {
  throws(() => parseRuling('the API is down, sorry'), /no JSON object/);
});

// ============================================================================
// applyRuling: what actually lands in the ledger.
// ============================================================================

const doc = () => ({
  diffHash: 'abc123',
  range: 'HEAD',
  findings: [{
    id: 'f1', file: 'a.js', line: 1, symbol: 'sym', severity: 'high', rule: 'correctness',
    problem: 'p', fix: 'x', status: 'open', reason: null,
  }],
});

t('applyRuling: writes the verdict, the reason, and the architect attribution', () => {
  const d = applyRuling(doc(), 'f1', { verdict: 'dismissed', reason: 'false positive' }, 'T');
  const f = d.findings[0];
  assert.strictEqual(f.status, 'dismissed');
  assert.strictEqual(f.reason, 'false positive');
  assert.strictEqual(f.ruledBy, 'architect');
  assert.strictEqual(f.ruledAt, 'T');
});

t('applyRuling: an "open" ruling keeps the finding blocking AND records why', () => {
  // The coder needs the architect's reasoning to act on; "open" is not a no-op.
  const d = applyRuling(doc(), 'f1', { verdict: 'open', reason: 'argument unverifiable' }, 'T');
  assert.strictEqual(d.findings[0].status, 'open');
  assert.strictEqual(d.findings[0].reason, 'argument unverifiable');
});

t('applyRuling: an unknown finding id THROWS', () => {
  throws(() => applyRuling(doc(), 'nope', { verdict: 'fixed', reason: 'r' }), /no finding with id/);
});

t('applyRuling: an architect dismissal SATISFIES the commit gate', () => {
  // The gate refuses a dismissal with no reason. The architect always supplies one,
  // so a ruled dismissal must pass where a bare one would not.
  const d = applyRuling(doc(), 'f1', { verdict: 'dismissed', reason: 'correct by design' });
  const v = evaluate(d, 'abc123');
  assert.strictEqual(v.ok, true, 'a reasoned architect dismissal must clear the gate');
  assert.strictEqual(v.dismissed.length, 1);
});

t('applyRuling: an architect "open" ruling still BLOCKS the commit gate', () => {
  const d = applyRuling(doc(), 'f1', { verdict: 'open', reason: 'stands' });
  assert.strictEqual(evaluate(d, 'abc123').ok, false, 'the finding stands -> commit refused');
});

// ============================================================================
// validatePlan: a plan the gates cannot enforce is worse than no plan, because it
// looks like governance while permitting everything.
// ============================================================================

const plan = (over = {}) => ({
  feasibility: { verdict: 'feasible', why: 'straightforward' },
  scope: { files: ['scripts/**'], allowNewFiles: false },
  verifyBudget: 2,
  steps: [{ n: 1, do: 'write the thing' }],
  ...over,
});

t('plan: a well-formed plan validates and seeds the coder fields empty', () => {
  const p = validatePlan(plan());
  assert.strictEqual(p.verifyBudget, 2);
  assert.deepStrictEqual(p.steps[0], { n: 1, do: 'write the thing', done: false, evidence: null });
});

t('plan: an EMPTY scope THROWS (unbounded scope = no enforceable gate)', () => {
  throws(() => validatePlan(plan({ scope: { files: [] } })), /unbounded scope/);
  throws(() => validatePlan(plan({ scope: {} })), /unbounded scope/);
});

t('plan: infeasible WITHOUT alternatives THROWS (a shrug is not an escalation)', () => {
  throws(
    () => validatePlan(plan({ feasibility: { verdict: 'infeasible', why: 'cannot be done' } })),
    /REQUIRES alternatives/);
});

t('plan: infeasible WITH alternatives validates, and needs no scope or steps', () => {
  const p = validatePlan({
    feasibility: { verdict: 'infeasible', why: 'no API exists', alternatives: ['scrape instead'] },
    scope: { files: [] },
    verifyBudget: 1,
    steps: [],
  });
  assert.strictEqual(p.feasibility.verdict, 'infeasible');
  assert.deepStrictEqual(p.feasibility.alternatives, ['scrape instead']);
});

t('plan: an unknown feasibility verdict THROWS', () => {
  throws(() => validatePlan(plan({ feasibility: { verdict: 'maybe' } })), /unknown feasibility/);
});

t('plan: a non-positive or non-integer verifyBudget THROWS', () => {
  for (const b of [0, -1, 2.5, 'two', null]) {
    throws(() => validatePlan(plan({ verifyBudget: b })), /verifyBudget/);
  }
});

t('plan: a feasible plan with NO steps THROWS', () => {
  throws(() => validatePlan(plan({ steps: [] })), /needs steps/);
});

t('plan: step numbers are backfilled when the model omits them', () => {
  const p = validatePlan(plan({ steps: [{ do: 'a' }, { do: 'b' }] }));
  assert.deepStrictEqual(p.steps.map(s => s.n), [1, 2]);
});

t('planId: slugs the goal and carries the date', () => {
  assert.strictEqual(planId('Ship the Verbose Gate!', '2026-07-20T00:00:00Z'),
    'plan-2026-07-20-ship-the-verbose-gate');
});

// ============================================================================
// review-disposition.js: the coder may ARGUE, never rule. These run the real CLI
// but stop before any API call, so they stay offline.
// ============================================================================

const DISPOSITION = path.join(__dirname, '..', 'scripts', 'review-disposition.js');
const disposition = (...args) =>
  spawnSync(process.execPath, [DISPOSITION, ...args], { encoding: 'utf8' });

t('disposition: passing a VERDICT is refused (the caller no longer decides)', () => {
  // The whole point of step 2: `<id> dismissed "reason"` used to work and made the
  // runner the judge. It must now fail loudly, not silently forward as an argument.
  for (const verdict of ['fixed', 'dismissed', 'open']) {
    const r = disposition('f1', verdict, 'because I said so');
    assert.strictEqual(r.status, 2, `'${verdict}' must be refused`);
    assert.match(r.stderr, /is a VERDICT/);
  }
});

t('disposition: no id at all prints usage and exits 2', () => {
  const r = disposition();
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /usage:/);
});

console.log(failed ? `\n${failed} failed` : '\nall architect tests pass');
process.exit(failed ? 1 : 0);
