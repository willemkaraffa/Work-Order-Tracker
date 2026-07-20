'use strict';
// Covers the MEASURE/RETIRE half of the adaptivity loop: derived rule status, and
// the part that makes retirement REAL, a guard standing down when its rule dies.
// Exit codes: 0 pass / 1 fail / 2 skip (see test/run.js).
//
// Every test uses a TEMP registry via WOT_RULE_REGISTRY. Nothing here touches the
// real ~/.claude/state/tech-debt-protocol.json, which holds cumulative learning
// across sessions and must never be clobbered by a test run.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  precision, effectiveStatus, isRuleActive, recordFiring, scoreboard,
  collateralRate, needsRedesign, DEFAULT_THRESHOLDS,
} = require('../scripts/rule-registry.js');

let failed = 0;
function t(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}: ${e.message}`); }
}

let seq = 0;
function tmpRegistry(rules) {
  const p = path.join(os.tmpdir(), `wot-rules-${process.pid}-${seq++}.json`);
  fs.writeFileSync(p, JSON.stringify({
    version: 1, rules, thresholds: DEFAULT_THRESHOLDS,
  }, null, 2));
  return p;
}
const rule = (over = {}) => ({
  id: 'G1', name: 'r', category: 'gate', status: 'hypothesis',
  true_positive: 0, false_positive: 0, false_negative: 0, ...over,
});

// ============================================================================
// precision + derived status
// ============================================================================

t('precision: no evidence yields null, NOT zero', () => {
  // A rule that never fired has not been shown to be wrong. Treating that as 0.0
  // precision would retire every new rule the moment thresholds were applied.
  assert.strictEqual(precision(rule()), null);
  assert.strictEqual(precision(rule({ true_positive: 3, false_positive: 1 })), 0.75);
});

t('status: a rule with no evidence stays a hypothesis, never retired', () => {
  assert.strictEqual(effectiveStatus(rule()), 'hypothesis');
});

t('status: enough true positives at good precision promotes to validated', () => {
  assert.strictEqual(effectiveStatus(rule({ true_positive: 3, false_positive: 0 })), 'validated');
});

t('status: many false positives at poor precision RETIRES', () => {
  assert.strictEqual(effectiveStatus(rule({ true_positive: 1, false_positive: 5 })), 'retired');
});

t('status: poor precision alone does NOT retire a low-traffic rule', () => {
  // 0/2 is bad precision but only two data points. Retiring here would kill a new
  // rule on a couple of mislabelled firings.
  assert.strictEqual(effectiveStatus(rule({ true_positive: 0, false_positive: 2 })), 'hypothesis');
});

t('status: many false positives alone does NOT retire an accurate rule', () => {
  // 50 TP / 6 FP is 0.89 precision. A raw FP count would kill a high-traffic rule
  // that is right nine times out of ten.
  assert.strictEqual(effectiveStatus(rule({ true_positive: 50, false_positive: 6 })), 'validated');
});

// ============================================================================
// collateral: a rule can be RIGHT and still be worth rebuilding
//
// The gap this closes, found by the style gate on 2026-07-20: it fired 3 times,
// was correct all 3 times, and produced a user-visible double print on every one,
// because a Stop hook cannot unsend the message it objects to. Precision 1.00, and
// still the wrong mechanism. On a TP/FP-only scoreboard that rule looks perfect.
// ============================================================================

t('collateral: rate is null with no correct firings, NOT zero', () => {
  assert.strictEqual(collateralRate(rule()), null);
  assert.strictEqual(collateralRate(rule({ true_positive: 4, collateral: 1 })), 0.25);
});

t('collateral: an accurate rule whose remedy always hurts is flagged for REDESIGN', () => {
  const r = rule({ true_positive: 3, false_positive: 0, collateral: 3 });
  assert.strictEqual(precision(r), 1, 'precision is perfect');
  assert.strictEqual(needsRedesign(r), true, 'and it still needs rebuilding');
});

t('collateral: a rule that fires cleanly is NOT flagged', () => {
  assert.strictEqual(needsRedesign(rule({ true_positive: 5, collateral: 0 })), false);
});

t('collateral: one costly firing is not enough to flag (needs a floor)', () => {
  assert.strictEqual(needsRedesign(rule({ true_positive: 1, collateral: 1 })), false);
});

t('collateral: REDESIGN NEVER DISARMS THE GUARD', () => {
  // The whole point. Retired means the rule is WRONG, so silencing it is right.
  // Redesign means the rule is RIGHT and the remedy is wrong, so silencing it would
  // drop a correct check and keep the defect it catches.
  const f = tmpRegistry([rule({ true_positive: 3, collateral: 3 })]);
  assert.strictEqual(needsRedesign(rule({ true_positive: 3, collateral: 3 })), true);
  assert.strictEqual(isRuleActive('G1', f), true, 'a flagged rule must keep firing');
});

t('collateral: only counted on a CORRECT firing, never on a false positive', () => {
  // An FP already counts as harm through precision. Counting it twice would retire
  // and flag the same rule for the same failure.
  const f = tmpRegistry([rule()]);
  recordFiring('G1', 'fp', 'wrong hit that also annoyed the user', f, true);
  assert.strictEqual(JSON.parse(fs.readFileSync(f, 'utf8')).rules[0].collateral || 0, 0);
});

t('collateral: recordFiring announces the moment a rule crosses into redesign', () => {
  const f = tmpRegistry([rule({ true_positive: 1, collateral: 1 })]);
  const res = recordFiring('G1', 'tp', 'correct again, and hurt again', f, true);
  assert.strictEqual(res.redesign, true);
  assert.strictEqual(res.redesignTripped, true, 'the crossing must be announced, not just the state');
});

t('collateral: an already-flagged rule does not re-announce every firing', () => {
  const f = tmpRegistry([rule({ true_positive: 3, collateral: 3 })]);
  const res = recordFiring('G1', 'tp', 'still hurting', f, true);
  assert.strictEqual(res.redesign, true);
  assert.strictEqual(res.redesignTripped, false, 'announce the crossing once, not forever');
});

t('collateral: scoreboard surfaces it beside precision, not folded into it', () => {
  const f = tmpRegistry([rule({ true_positive: 3, collateral: 3 })]);
  const s = scoreboard(f)[0];
  assert.strictEqual(s.precision, 1);
  assert.strictEqual(s.redesign, true, 'a perfect precision score must not hide it');
});

// ============================================================================
// isRuleActive: the function guards actually call
// ============================================================================

t('active: a healthy rule is active', () => {
  const f = tmpRegistry([rule({ true_positive: 3 })]);
  assert.strictEqual(isRuleActive('G1', f), true);
});

t('active: a RETIRED rule is not active (this is what disarms the guard)', () => {
  const f = tmpRegistry([rule({ true_positive: 1, false_positive: 5 })]);
  assert.strictEqual(isRuleActive('G1', f), false);
});

t('active: a stored status of "retired" does NOT retire a rule on its own', () => {
  // Retirement is DERIVED from evidence, never read from a typed string. The
  // registry sits outside the repo where no PreToolUse guard covers it, so a
  // stored status would be one edit away from switching off an inconvenient rule.
  const f = tmpRegistry([rule({ status: 'retired', true_positive: 3, false_positive: 0 })]);
  assert.strictEqual(isRuleActive('G1', f), true, 'evidence outranks the stored word');
});

t('active: an UNKNOWN rule id is active (silence is not permission to stop)', () => {
  const f = tmpRegistry([rule()]);
  assert.strictEqual(isRuleActive('NOPE', f), true);
});

t('active: a MISSING registry leaves every rule active (fail ACTIVE)', () => {
  assert.strictEqual(isRuleActive('G1', path.join(os.tmpdir(), 'does-not-exist-xyz.json')), true);
});

t('active: a CORRUPT registry leaves every rule active (fail ACTIVE)', () => {
  // The opposite of the hooks' fail-open stance, deliberately: a hook failing open
  // loses one check, but a registry failing open would disarm every rule at once.
  const p = path.join(os.tmpdir(), `wot-rules-corrupt-${process.pid}.json`);
  fs.writeFileSync(p, '{ not json at all');
  assert.strictEqual(isRuleActive('G1', p), true);
});

t('active: a registry with no rules array is treated as unreadable', () => {
  const p = path.join(os.tmpdir(), `wot-rules-shape-${process.pid}.json`);
  fs.writeFileSync(p, JSON.stringify({ version: 1 }));
  assert.strictEqual(isRuleActive('G1', p), true);
});

// ============================================================================
// recordFiring: the MEASURE step
// ============================================================================

t('record: a true positive increments TP and reports no status change', () => {
  const f = tmpRegistry([rule()]);
  const res = recordFiring('G1', 'tp', 'caught a real thrash loop', f);
  assert.strictEqual(res.rule.true_positive, 1);
  assert.strictEqual(res.changed, false);
});

t('record: the 5th false positive at poor precision RETIRES the rule', () => {
  const f = tmpRegistry([rule({ true_positive: 1, false_positive: 4 })]);
  const res = recordFiring('G1', 'fp', 'fired on a crash that never ran', f);
  assert.strictEqual(res.after, 'retired');
  assert.strictEqual(res.changed, true, 'the caller must be told the rule died');
  assert.strictEqual(isRuleActive('G1', f), false, 'and it must actually stop firing');
});

t('record: the stored status mirrors the derived one so the skill agrees', () => {
  const f = tmpRegistry([rule({ true_positive: 2 })]);
  recordFiring('G1', 'tp', 'third real catch', f);
  assert.strictEqual(JSON.parse(fs.readFileSync(f, 'utf8')).rules[0].status, 'validated');
});

t('record: an unknown rule or bad label THROWS rather than silently counting', () => {
  const f = tmpRegistry([rule()]);
  assert.throws(() => recordFiring('NOPE', 'tp', 'x', f), /no rule/);
  assert.throws(() => recordFiring('G1', 'maybe', 'x', f), /label must be tp or fp/);
});

t('scoreboard: reports stored and derived side by side', () => {
  const f = tmpRegistry([rule({ status: 'hypothesis', true_positive: 3 })]);
  const s = scoreboard(f);
  assert.strictEqual(s[0].stored, 'hypothesis');
  assert.strictEqual(s[0].derived, 'validated', 'divergence must be visible, not hidden');
});

// ============================================================================
// THE POINT: a retired rule stops firing, in the REAL guard
// ============================================================================

const THRASH = path.join(__dirname, '..', '.claude', 'hooks', 'verify-thrash-guard.js');
const bash = (session, command, registry) => {
  const r = spawnSync(process.execPath, [THRASH], {
    input: JSON.stringify({ tool_name: 'Bash', session_id: session, tool_input: { command } }),
    encoding: 'utf8',
    env: { ...process.env, WOT_RULE_REGISTRY: registry },
  });
  return r.status;
};
const sid = () => `rr-${process.pid}-${Date.now()}-${seq++}`;

t('RETIREMENT HAS TEETH: a retired G1 stops blocking the 3rd run', () => {
  // Without this the whole registry is decoration: "retired" would be a word in a
  // JSON file while the rule kept blocking forever.
  const f = tmpRegistry([rule({ id: 'G1', true_positive: 1, false_positive: 5 })]);
  const s = sid();
  assert.strictEqual(bash(s, 'node scratch/x.js', f), 0);
  assert.strictEqual(bash(s, 'node scratch/x.js', f), 0);
  assert.strictEqual(bash(s, 'node scratch/x.js', f), 0, 'retired -> the 3rd run is allowed');
});

t('a LIVE G1 still blocks the 3rd run (retirement is the exception, not the rule)', () => {
  const f = tmpRegistry([rule({ id: 'G1', true_positive: 3, false_positive: 0 })]);
  const s = sid();
  bash(s, 'node scratch/y.js', f);
  bash(s, 'node scratch/y.js', f);
  assert.strictEqual(bash(s, 'node scratch/y.js', f), 2, 'a healthy rule must still bite');
});

t('a guard with an unreadable registry still blocks (fail ACTIVE end to end)', () => {
  const s = sid();
  const missing = path.join(os.tmpdir(), 'no-registry-here-xyz.json');
  bash(s, 'node scratch/z.js', missing);
  bash(s, 'node scratch/z.js', missing);
  assert.strictEqual(bash(s, 'node scratch/z.js', missing), 2,
    'a registry problem must never be a silent way to switch every gate off');
});

console.log(failed ? `\n${failed} failed` : '\nall rule-registry tests pass');
process.exit(failed ? 1 : 0);
