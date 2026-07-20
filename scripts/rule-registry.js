'use strict';
/*
 * rule-registry.js: the MEASURE and RETIRE half of the adaptivity loop.
 *
 * REUSES THE EXISTING REGISTRY (rule 1/B3). The handoff said the backing store
 * "does not exist yet". It does: ~/.claude/state/tech-debt-protocol.json, with 9
 * rules, per-rule TP/FP/FN counts, an improvements queue, and BOTH promote and
 * retire thresholds already agreed. Building a second `.rules.json` would have
 * split the learning across two files and thrown away the counts already earned.
 * The `tech-debt-status` skill reads this same file.
 *
 * WHAT WAS ACTUALLY MISSING, and what this adds:
 *   1. Nothing ever WROTE to it, so every count is whatever a human last typed.
 *   2. "Retire" was a `(RETIRE?)` suggestion printed in a report. Nothing retired.
 *   3. The real enforcement hooks were not rules in it at all.
 *
 * RETIREMENT IS DERIVED, NEVER TYPED. `effectiveStatus()` computes retirement from
 * the evidence plus the thresholds; it does not read a stored "retired" string.
 * This matters for forge resistance: the registry lives outside the repo, so no
 * PreToolUse guard covers it, and a stored status would be one edit away from
 * Claude switching off a rule it finds inconvenient. Deriving it means switching a
 * rule off requires fabricating five architect-labelled false positives, which is
 * a much louder, more deliberate act than typing a word.
 *
 * FAIL ACTIVE, ALWAYS. A missing, corrupt, or unreadable registry leaves every
 * rule ACTIVE. The failure mode of this file must be "the gate still bites", never
 * "the gates quietly stopped". That is the opposite of the hooks' fail-open stance,
 * and deliberately so: a hook failing open loses one check, but a registry failing
 * open would disarm every rule at once.
 */
const fs = require('fs');
const path = require('path');

const REGISTRY = process.env.WOT_RULE_REGISTRY || path.join(
  process.env.USERPROFILE || process.env.HOME || '',
  '.claude', 'state', 'tech-debt-protocol.json');

const DEFAULT_THRESHOLDS = {
  promote_to_validated: { true_positive_min: 3, precision_min: 0.5 },
  retire: { false_positive_min: 5, precision_max: 0.4 },
  // A rule can be RIGHT and still be worth rebuilding. See needsRedesign.
  redesign: { collateral_rate_min: 0.5, true_positive_min: 2 },
};

function readRegistry(file = REGISTRY) {
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.rules)) return null;
    return doc;
  } catch { return null; }
}

// precision = TP / (TP + FP). null when there is no evidence either way, which is
// NOT the same as zero: a rule that never fired has not been shown to be wrong.
function precision(rule) {
  const tp = Number(rule.true_positive) || 0;
  const fp = Number(rule.false_positive) || 0;
  return tp + fp === 0 ? null : tp / (tp + fp);
}

// Derived, not stored. Returns 'retired' | 'validated' | 'hypothesis'.
//
// Retirement needs BOTH a floor of false positives AND poor precision. Either
// alone retires the wrong rules: a precision floor alone kills a brand-new rule on
// its first mislabelled firing, and an FP count alone kills a high-traffic rule
// that is right 90% of the time.
function effectiveStatus(rule, thresholds = DEFAULT_THRESHOLDS) {
  const ret = (thresholds && thresholds.retire) || DEFAULT_THRESHOLDS.retire;
  const pro = (thresholds && thresholds.promote_to_validated) || DEFAULT_THRESHOLDS.promote_to_validated;
  const p = precision(rule);
  const fp = Number(rule.false_positive) || 0;
  const tp = Number(rule.true_positive) || 0;

  if (fp >= (ret.false_positive_min ?? 5) && p !== null && p <= (ret.precision_max ?? 0.4)) {
    return 'retired';
  }
  if (tp >= (pro.true_positive_min ?? 3) && p !== null && p >= (pro.precision_min ?? 0.5)) {
    return 'validated';
  }
  return 'hypothesis';
}

// collateralRate = correct firings that HURT the user / all correct firings.
//
// WHY A NEW FIELD (rule 5 asks for a stated reason). No existing field holds this.
// `false_negative` is a MISSED detection; this is the opposite, a HIT whose remedy
// cost something. TP/FP measure whether the rule was RIGHT, and nothing measured
// whether being right was worth it.
//
// The gap was found by the style gate on 2026-07-20: it fired 3 times, was correct
// all 3 times, and produced a user-visible double print on 100% of those firings,
// because a Stop hook cannot unsend the message it objects to. Precision 1.00, and
// still the wrong mechanism. On the old scoreboard that rule looked perfect.
function collateralRate(rule) {
  const tp = Number(rule.true_positive) || 0;
  const c = Number(rule.collateral) || 0;
  return tp === 0 ? null : c / tp;
}

// A rule that is ACCURATE but whose intervention keeps hurting. Reported, never
// enforced.
//
// CRITICAL: this must NOT disarm the guard, which is why it is separate from
// effectiveStatus and why isRuleActive ignores it entirely. Retirement means the
// rule is WRONG, so silencing it is right. Redesign means the rule is RIGHT and the
// remedy is wrong, so silencing it would remove a correct check and keep the defect
// it catches. The answer is to rebuild the mechanism, and that is a human's call.
function needsRedesign(rule, thresholds = DEFAULT_THRESHOLDS) {
  const cfg = (thresholds && thresholds.redesign) || DEFAULT_THRESHOLDS.redesign;
  const rate = collateralRate(rule);
  const tp = Number(rule.true_positive) || 0;
  if (rate === null) return false;
  return tp >= (cfg.true_positive_min ?? 2) && rate >= (cfg.collateral_rate_min ?? 0.5);
}

// THE ONE FUNCTION THAT MAKES RETIREMENT REAL. A guard calls this and stands down
// when its rule has been retired by the evidence. Without this, "retired" is a word
// in a file nobody consults and the rule keeps firing forever.
//
// Unknown rule id -> ACTIVE. A guard whose rule was never registered must keep
// working; silence in the registry is not permission to stop enforcing.
function isRuleActive(ruleId, file = REGISTRY) {
  const doc = readRegistry(file);
  if (!doc) return true;                       // no registry -> everything active
  const rule = doc.rules.find(r => r.id === ruleId);
  if (!rule) return true;                      // unregistered -> active
  return effectiveStatus(rule, doc.thresholds) !== 'retired';
}

// Record one labelled firing. `label` is 'tp' or 'fp'.
//
// The CALLER DOES NOT GET TO PICK THE LABEL casually: rule-label.js routes the
// judgement through the architect, same no-verdict-from-caller discipline as
// finding dispositions and scope rulings. A coder labelling its own constraints
// would retire whichever rule annoyed it most, which is precisely the incentive
// the doc warns about ("NOT the coder; it is biased toward killing rules that
// constrain it").
function recordFiring(ruleId, label, note, file = REGISTRY, collateral = false) {
  const doc = readRegistry(file);
  if (!doc) throw new Error(`no rule registry at ${file}`);
  const rule = doc.rules.find(r => r.id === ruleId);
  if (!rule) throw new Error(`no rule '${ruleId}'. Known: ${doc.rules.map(r => r.id).join(', ')}`);
  if (label !== 'tp' && label !== 'fp') throw new Error(`label must be tp or fp, got '${label}'`);

  const before = effectiveStatus(rule, doc.thresholds);
  const redesignBefore = needsRedesign(rule, doc.thresholds);
  if (label === 'tp') rule.true_positive = (Number(rule.true_positive) || 0) + 1;
  else rule.false_positive = (Number(rule.false_positive) || 0) + 1;
  // Collateral is only meaningful on a CORRECT firing. A false positive already
  // counts as harm through precision; counting it twice would retire and flag the
  // same rule for the same failure.
  if (collateral && label === 'tp') rule.collateral = (Number(rule.collateral) || 0) + 1;

  rule.notes = rule.notes || [];
  if (note) rule.notes.push(`${new Date().toISOString().slice(0, 10)} [${label}] ${note}`);
  rule.last_audited = new Date().toISOString().slice(0, 10);

  const after = effectiveStatus(rule, doc.thresholds);
  // Keep the stored status in step with the derived one so the existing
  // tech-debt-status skill reports the same answer. The stored value is a MIRROR,
  // never the source of truth: isRuleActive always re-derives.
  rule.status = after;
  doc.updated_at = new Date().toISOString();

  fs.writeFileSync(file, JSON.stringify(doc, null, 2));
  const redesignAfter = needsRedesign(rule, doc.thresholds);
  return {
    rule, before, after, changed: before !== after,
    redesign: redesignAfter,
    // Surfaced separately so a caller can announce the moment a correct rule
    // crosses into "the remedy is the problem", which is easy to miss when the
    // precision column still looks healthy.
    redesignTripped: redesignAfter && !redesignBefore,
  };
}

function scoreboard(file = REGISTRY) {
  const doc = readRegistry(file);
  if (!doc) return null;
  return doc.rules.map(r => ({
    id: r.id,
    name: r.name,
    stored: r.status,
    derived: effectiveStatus(r, doc.thresholds),
    tp: Number(r.true_positive) || 0,
    fp: Number(r.false_positive) || 0,
    collateral: Number(r.collateral) || 0,
    precision: precision(r),
    collateralRate: collateralRate(r),
    redesign: needsRedesign(r, doc.thresholds),
  }));
}

module.exports = {
  readRegistry, precision, effectiveStatus, isRuleActive, recordFiring, scoreboard,
  collateralRate, needsRedesign,
  REGISTRY, DEFAULT_THRESHOLDS,
};
