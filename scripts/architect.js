'use strict';
/*
 * architect.js: rank-2 of the Overseer chain of command. External Gemini, on
 * purpose: independence (not Claude judging Claude), and Task subagents are
 * Claude-only so the architect must be a SCRIPT, not an agent.
 *
 * THE ONE LOAD-BEARING RULE: the caller supplies EVIDENCE, never a VERDICT.
 * Every subcommand below takes zero verdict arguments and writes whatever the API
 * returns. That is what makes it an architect rather than a rubber stamp Claude
 * holds the pen for. It also sidesteps a problem that is otherwise unsolvable:
 * a hook CANNOT tell the coder from the overseer (a Task subagent shares the
 * parent's session_id, probed 2026-07-17), so "block role X from writing Y" is
 * not implementable. Gate WHAT can be written, not WHO writes it.
 *
 * USAGE:
 *   node scripts/architect.js plan "<goal>"        draft .plan.json from a goal
 *   node scripts/architect.js plan "<goal>" --dry-run
 *   node scripts/architect.js rule <findingId> ["the coder's argument"]
 *
 * EXIT CODES (same contract as gemini-review.js):
 *   0 = ruled / drafted
 *   1 = ruled, and the ruling went AGAINST the caller (finding stands)
 *   2 = did NOT run (no key, API error, bad response). Loud, never silent: a
 *       skipped ruling must never read as a favourable one.
 *
 * NO OVERRIDE KNOB. A dead API blocks dispositions. That is deliberate and
 * consistent with review-gate.js: a knob Claude may turn is not a gate.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { callGemini, extractJson } = require('./gemini-call.js');
const { buildFileContext, FINDINGS_FILE } = require('./gemini-review.js');

const REPO_ROOT = path.join(__dirname, '..');
const PLAN_FILE = path.join(REPO_ROOT, '.plan.json');

// ---------------------------------------------------------------------------
// Ruling on a reviewer finding (replaces the coder's self-disposition)
// ---------------------------------------------------------------------------

const VERDICTS = new Set(['fixed', 'dismissed', 'open']);

const RULING_RUBRIC = `You are the ARCHITECT: the superior of the coder who wrote this change, and
the recipient of an independent reviewer's finding. You decide what happens to the finding.
The coder CANNOT overrule you and CANNOT dismiss its own findings; that sole-judge hole is
exactly why you exist.

You are given: the finding, the coder's ARGUMENT (which is EVIDENCE, not a verdict, and may
be absent or self-serving), the full current text of the cited file, and the diff.

Return exactly one verdict:
- "fixed": the current code genuinely no longer has the defect. You must see it resolved in
  the file text, not merely be told it was fixed.
- "dismissed": the finding is not a real defect (false positive, or correct-by-design).
- "open": the finding stands and the coder must act. Use this when the argument is
  unconvincing, when you cannot verify the claim, OR when you are unsure. Unsure is NOT a
  dismissal; the safe default is that the finding stands.

Judge the CODE, not the confidence of the argument. A fluent rationalisation is still a
rationalisation. If the coder's argument asserts something you cannot confirm in the file
text, that is "open".

Output ONLY a JSON object, no prose, no markdown fences:
{"verdict":"fixed|dismissed|open","reason":"one or two sentences, addressed to a human reader"}`;

// Pure. Validates the model's ruling before it is allowed anywhere near the ledger.
// A malformed or unknown verdict must NOT silently become a favourable one, so this
// throws rather than defaulting. Exported for tests.
function parseRuling(text) {
  const obj = extractJson(text, 'object');
  const verdict = String(obj.verdict || '').trim().toLowerCase();
  if (!VERDICTS.has(verdict)) {
    throw new Error(`unknown verdict '${obj.verdict}' (expected fixed|dismissed|open)`);
  }
  const reason = String(obj.reason || '').trim();
  if (!reason) throw new Error('ruling carried no reason');
  return { verdict, reason };
}

// Pure. Applies a ruling to the findings doc and returns the updated doc.
// Note the ledger's own invariant is preserved: a `dismissed` finding must carry a
// reason (review-gate.js refuses a bare dismissal), and the reason here is the
// ARCHITECT's words, never the caller's. Exported for tests.
function applyRuling(doc, id, ruling, at = new Date().toISOString()) {
  const f = (doc.findings || []).find(x => x.id === id);
  if (!f) throw new Error(`no finding with id ${id}`);
  f.status = ruling.verdict;
  // `reason` is what review-gate.js prints to the human at commit time. Keep it
  // populated for every ruled outcome, not only dismissals: an "open" ruling with
  // the architect's reasoning is the message the coder needs to act on.
  f.reason = ruling.reason;
  f.ruledBy = 'architect';
  f.ruledAt = at;
  return doc;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function gitDiff(range = 'HEAD') {
  try {
    return execFileSync('git', ['diff', range], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  } catch { return ''; }
}

async function ruleOnFinding(args) {
  const [id, ...rest] = args;
  const argument = rest.filter(a => !a.startsWith('--')).join(' ').trim();
  const dryRun = args.includes('--dry-run');

  if (!id) {
    console.error('usage: node scripts/architect.js rule <findingId> ["the coder\'s argument"]');
    return 2;
  }

  const doc = readJson(FINDINGS_FILE);
  if (!doc) {
    console.error('[architect] no findings file. Run: node scripts/gemini-review.js');
    return 2;
  }
  const f = (doc.findings || []).find(x => x.id === id);
  if (!f) {
    console.error(`[architect] no finding with id ${id}. Known: ${(doc.findings || []).map(x => x.id).join(', ') || '(none)'}`);
    return 2;
  }

  const ctx = buildFileContext([f.file], p => {
    try { return fs.readFileSync(path.join(REPO_ROOT, p), 'utf8'); } catch { return null; }
  });

  const prompt = `${RULING_RUBRIC}

=== FINDING ===
${JSON.stringify({ file: f.file, line: f.line, symbol: f.symbol, severity: f.severity, rule: f.rule, problem: f.problem, fix: f.fix }, null, 2)}

=== THE CODER'S ARGUMENT (evidence, not a verdict) ===
${argument || '(none offered)'}

=== FULL TEXT OF THE CITED FILE ===
${ctx.text || '(file unreadable or deleted)'}

=== DIFF (${doc.range || 'HEAD'}) ===
${gitDiff(doc.range || 'HEAD')}`;

  if (dryRun) {
    console.log(`[architect] DRY RUN: would rule on ${id}, prompt chars=${prompt.length}`);
    return 0;
  }

  const call = await callGemini(prompt, { tag: 'architect' });
  if (!call.ok) {
    console.error(`[architect] ${call.why}: NO RULING (exit 2). The finding stands; this is not a pass.`);
    return 2;
  }

  let ruling;
  try {
    ruling = parseRuling(call.text);
  } catch (e) {
    console.error(`[architect] unusable ruling: ${e.message}: NO RULING (exit 2).`);
    console.error(call.text.slice(0, 500));
    return 2;
  }

  applyRuling(doc, id, ruling);
  fs.writeFileSync(FINDINGS_FILE, JSON.stringify(doc, null, 2));

  console.log(`\n[architect] ${call.model} RULED on ${id}: ${ruling.verdict.toUpperCase()}`);
  console.log(`[architect] reason: ${ruling.reason}`);
  if (ruling.verdict === 'open') {
    console.log('[architect] The finding STANDS. Fix it; you cannot dismiss it yourself.');
    return 1;
  }
  const open = (doc.findings || []).filter(x => x.status === 'open').length;
  console.log(`[architect] ${open} finding(s) still open.`);
  return 0;
}

// ---------------------------------------------------------------------------
// Drafting a plan
// ---------------------------------------------------------------------------

const PLAN_RUBRIC = `You are the ARCHITECT in a chain of command: a human sets the goal, an overseer
relays it to you, and a coder implements what you plan. Draft a STRUCTURED plan from the goal.

You have two jobs, and the second matters more than the first:
1. Break the goal into small, ordered, verifiable steps.
2. Judge FEASIBILITY honestly. If the goal is not feasible as stated, say so and give
   alternatives. Rejecting upward with reasons is a legitimate, expected outcome, not a
   failure. Do not pad an infeasible ask into plausible-looking steps.

Constraints you must respect:
- "scope.files" lists the glob patterns the coder may touch. Keep it TIGHT. Anything outside
  it will refuse to commit until you rule on it, so an over-wide scope defeats the mechanism.
- "verifyBudget" is the TOTAL number of heavy verification runs (full test suite / build) the
  whole plan is allowed, shared by every agent. It is NOT per-agent and NOT per-step. Small
  or low-risk plans should budget 1-2. Over-verification has repeatedly cost more than the
  bugs it caught.

Output ONLY a JSON object, no prose, no markdown fences:
{"feasibility":{"verdict":"feasible|infeasible","why":"...","alternatives":["..."]},
 "scope":{"files":["path/glob"],"allowNewFiles":false},
 "verifyBudget":2,
 "steps":[{"n":1,"do":"one concrete action"}]}
"alternatives" is REQUIRED and non-empty when the verdict is infeasible; omit or empty it otherwise.`;

// Pure. Validates + normalises a drafted plan. Throws on anything that would produce
// a plan the gates cannot enforce (empty scope = everything in scope = no gate).
// Exported for tests.
function validatePlan(obj) {
  const fe = obj.feasibility || {};
  const verdict = String(fe.verdict || '').trim().toLowerCase();
  if (!['feasible', 'infeasible'].includes(verdict)) {
    throw new Error(`unknown feasibility verdict '${fe.verdict}'`);
  }
  const alternatives = Array.isArray(fe.alternatives) ? fe.alternatives.filter(Boolean) : [];
  // The reject-up payload. An "infeasible" with no alternatives is a dead end handed
  // to the human with no options, which is not an escalation, it is a shrug.
  if (verdict === 'infeasible' && !alternatives.length) {
    throw new Error('an infeasible verdict REQUIRES alternatives');
  }

  const files = Array.isArray(obj.scope && obj.scope.files)
    ? obj.scope.files.filter(Boolean) : [];
  if (verdict === 'feasible' && !files.length) {
    throw new Error('scope.files is empty: an unbounded scope cannot be enforced');
  }

  const budget = Number(obj.verifyBudget);
  if (!Number.isInteger(budget) || budget < 1) {
    throw new Error(`verifyBudget must be a positive integer, got '${obj.verifyBudget}'`);
  }

  const rawSteps = Array.isArray(obj.steps) ? obj.steps : [];
  if (verdict === 'feasible' && !rawSteps.length) throw new Error('a feasible plan needs steps');

  return {
    feasibility: { verdict, why: String(fe.why || '').trim(), alternatives },
    scope: { files, allowNewFiles: !!(obj.scope && obj.scope.allowNewFiles) },
    verifyBudget: budget,
    // done + evidence are the coder's ONLY writable fields, seeded empty here.
    steps: rawSteps.map((s, i) => ({
      n: Number(s.n) || i + 1,
      do: String(s.do || '').trim(),
      done: false,
      evidence: null,
    })),
  };
}

function headCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch { return null; }
}

function planId(goal, at) {
  const slug = goal.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
  return `plan-${at.slice(0, 10)}-${slug || 'untitled'}`;
}

async function draftPlan(args) {
  const dryRun = args.includes('--dry-run');
  const goal = args.filter(a => !a.startsWith('--')).join(' ').trim();
  if (!goal) {
    console.error('usage: node scripts/architect.js plan "<goal>"');
    return 2;
  }

  let tree = '';
  try {
    tree = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').slice(0, 400).join('\n');
  } catch { /* not fatal; the model just plans with less context */ }

  const prompt = `${PLAN_RUBRIC}\n\n=== GOAL ===\n${goal}\n\n=== REPO FILES ===\n${tree}`;

  if (dryRun) {
    console.log(`[architect] DRY RUN: would draft a plan for '${goal}', prompt chars=${prompt.length}`);
    return 0;
  }

  const call = await callGemini(prompt, { tag: 'architect' });
  if (!call.ok) {
    console.error(`[architect] ${call.why}: NO PLAN (exit 2).`);
    return 2;
  }

  let plan;
  try {
    plan = validatePlan(extractJson(call.text, 'object'));
  } catch (e) {
    console.error(`[architect] unusable plan: ${e.message}: NO PLAN (exit 2).`);
    console.error(call.text.slice(0, 500));
    return 2;
  }

  const at = new Date().toISOString();
  // A plan binds to baseCommit and stays valid until it is complete. It does NOT
  // inherit the review ledger's staleness-on-any-change: review staleness is a
  // feature (the committed tree must be the reviewed tree), but plan staleness
  // would force a re-plan every commit, which is a bug.
  const doc = {
    id: planId(goal, at),
    goal,
    status: plan.feasibility.verdict === 'feasible' ? 'draft' : 'rejected',
    baseCommit: headCommit(),
    model: call.model,
    draftedAt: at,
    ...plan,
    rulings: [],
    approvedBy: null,
    approvedAt: null,
  };
  fs.writeFileSync(PLAN_FILE, JSON.stringify(doc, null, 2));

  console.log(`\n[architect] ${call.model} drafted ${doc.id} (status: ${doc.status})`);
  console.log(`[architect] feasibility: ${plan.feasibility.verdict}: ${plan.feasibility.why}`);
  if (plan.feasibility.verdict === 'infeasible') {
    console.log('[architect] REJECTED UP. Alternatives for the human:');
    for (const a of plan.feasibility.alternatives) console.log(`  - ${a}`);
    console.log('[architect] Do NOT proceed. This goes to the human, not around them.');
    return 1;
  }
  console.log(`[architect] scope: ${plan.scope.files.join(', ')} (new files: ${plan.scope.allowNewFiles ? 'allowed' : 'no'})`);
  console.log(`[architect] verify budget: ${plan.verifyBudget} TOTAL for the plan, shared by every agent.`);
  for (const s of plan.steps) console.log(`  ${s.n}. ${s.do}`);
  console.log(`\n[architect] draft written to ${path.basename(PLAN_FILE)}. A HUMAN approves it; Claude cannot.`);
  return 0;
}

// ---------------------------------------------------------------------------
// Ruling on a SCOPE violation
// ---------------------------------------------------------------------------

const SCOPE_VERDICTS = new Set(['widen', 'revert', 'escalate']);

const SCOPE_RUBRIC = `You are the ARCHITECT. You wrote a plan with a deliberately TIGHT file scope.
The coder has tried to modify a file OUTSIDE that scope and must justify it. Rule on it.

Return exactly one verdict:
- "widen": the change genuinely belongs to this plan and the scope was simply drawn too
  narrowly. The file is added to the plan's scope.
- "revert": the file does not belong to this plan. The coder backs the change out.
- "escalate": this is not a scope tweak, it is a change to what the plan IS. Goes to the human.

Bias toward "revert" or "escalate" when the justification is vague, when the file belongs to a
different concern than the plan's goal, or when widening would make the scope so broad it stops
constraining anything. A scope that grows to fit whatever was done is not a scope.

Output ONLY a JSON object, no prose, no markdown fences:
{"verdict":"widen|revert|escalate","reason":"one or two sentences for a human reader"}`;

// Pure, exported for tests. Same discipline as parseRuling: an unknown verdict
// THROWS rather than defaulting, so a malformed response can never widen a scope.
function parseScopeRuling(text) {
  const obj = extractJson(text, 'object');
  const verdict = String(obj.verdict || '').trim().toLowerCase();
  if (!SCOPE_VERDICTS.has(verdict)) {
    throw new Error(`unknown verdict '${obj.verdict}' (expected widen|revert|escalate)`);
  }
  const reason = String(obj.reason || '').trim();
  if (!reason) throw new Error('ruling carried no reason');
  return { verdict, reason };
}

async function ruleOnScope(args) {
  const positional = args.filter(a => !a.startsWith('--'));
  const file = positional[0];
  const argument = positional.slice(1).join(' ').trim();
  if (!file) {
    console.error('usage: node scripts/architect.js scope <file> ["why it needs to change"]');
    return 2;
  }

  const { readPlan, PLAN_FILE, isActive, widenCount, WIDEN_LIMIT } = require('./plan.js');
  const plan = readPlan();
  if (!isActive(plan)) {
    console.error('[architect] no ACTIVE plan; nothing to rule on. Scope is only enforced once a plan is approved.');
    return 2;
  }

  const rel = String(file).replace(/\\/g, '/');
  const prompt = `${SCOPE_RUBRIC}

=== THE PLAN ===
goal: ${plan.goal}
scope.files: ${JSON.stringify((plan.scope || {}).files || [])}
steps: ${JSON.stringify((plan.steps || []).map(s => s.do))}

=== THE OUT-OF-SCOPE FILE ===
${rel}

=== THE CODER'S JUSTIFICATION (evidence, not a verdict) ===
${argument || '(none offered)'}

=== RULINGS ALREADY MADE ON THIS PLAN ===
${JSON.stringify(plan.rulings || [], null, 2)}`;

  const call = await callGemini(prompt, { tag: 'architect' });
  if (!call.ok) {
    console.error(`[architect] ${call.why}: NO RULING (exit 2). The file stays blocked.`);
    return 2;
  }

  let ruling;
  try {
    ruling = parseScopeRuling(call.text);
  } catch (e) {
    console.error(`[architect] unusable ruling: ${e.message}: NO RULING (exit 2).`);
    console.error(call.text.slice(0, 500));
    return 2;
  }

  plan.rulings = plan.rulings || [];
  plan.rulings.push({
    files: [rel],
    verdict: ruling.verdict,
    reason: ruling.reason,
    by: 'architect',
    at: new Date().toISOString(),
  });
  // `widen` amends the scope; the other verdicts deliberately do NOT, so a revert
  // or escalate leaves the file still outside and still blocked.
  if (ruling.verdict === 'widen') {
    plan.scope = plan.scope || {};
    plan.scope.files = [...((plan.scope.files) || []), rel];
  }
  fs.writeFileSync(PLAN_FILE, JSON.stringify(plan, null, 2));

  console.log(`\n[architect] ${call.model} RULED on ${rel}: ${ruling.verdict.toUpperCase()}`);
  console.log(`[architect] reason: ${ruling.reason}`);

  // Drift counter: repeated widening means the PLAN was wrong, not that the coder
  // found N surprises. Deterministic, no judgment required.
  const widens = widenCount(plan);
  if (widens >= WIDEN_LIMIT) {
    console.log(`\n[architect] ${widens} WIDEN rulings on this plan (limit ${WIDEN_LIMIT}).`);
    console.log('[architect] The plan itself is wrong, not the scope. ESCALATE to the human:');
    console.log('[architect] stop and re-plan rather than widening a fourth time.');
    return 1;
  }
  if (ruling.verdict === 'widen') {
    console.log(`[architect] Scope widened to include ${rel}. Proceed.`);
    return 0;
  }
  console.log(`[architect] ${rel} is still OUT of scope and still blocked.`);
  if (ruling.verdict === 'escalate') console.log('[architect] This goes to the human, not around them.');
  return 1;
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'rule') return ruleOnFinding(args);
  if (cmd === 'plan') return draftPlan(args);
  if (cmd === 'scope') return ruleOnScope(args);
  console.error('usage: node scripts/architect.js plan "<goal>" | rule <findingId> ["argument"] | scope <file> ["argument"]');
  return 2;
}

// CLI only: without this guard, require()ing from a test fires a live API call.
if (require.main === module) {
  main().then(code => { process.exitCode = code; })
        .catch(e => { console.error(`[architect] fatal: ${e.message}`); process.exitCode = 2; });
}

module.exports = {
  parseRuling, applyRuling, validatePlan, planId, parseScopeRuling,
  PLAN_FILE, VERDICTS, SCOPE_VERDICTS,
};
