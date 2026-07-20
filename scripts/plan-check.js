'use strict';
/*
 * plan-check.js: the commit-time half of plan enforcement. Runs from pre-commit,
 * which is tool-agnostic: a PowerShell call once walked straight through a
 * Bash-only PreToolUse guard, but git hooks do not care which shell invoked git.
 *
 * Checks, all deterministic (no judgment, nothing for an LLM to decide):
 *   1. Touched files are inside scope.files, or carry a ruling.
 *   2. Every step marked done cites evidence, and the cited files are really in
 *      the diff. A step claimed done whose evidence does not exist is not done.
 *
 * NOT CHECKED, and stated rather than quietly skipped: the verify BUDGET. The
 * budget counter (verify-budget-guard.js) is keyed by session_id in tmpdir, and a
 * git hook has no session_id, so it cannot read the right bucket. Writing a check
 * that silently passes because it looked in the wrong place would be worse than no
 * check: it would LOOK enforced. Enforcing it needs the counter moved to
 * plan-scoped state first. Until then the budget is advisory, via the PostToolUse
 * nudge that already fires.
 *
 * Exit: 0 pass (or no active plan), 1 refuse the commit.
 */
const { execFileSync } = require('child_process');
const { readPlan, isActive, unruledViolations } = require('./plan.js');

function stagedFiles() {
  try {
    return execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' })
      .split('\n').map(s => s.trim()).filter(Boolean);
  } catch { return []; }
}

function main() {
  const plan = readPlan();
  if (!isActive(plan)) return 0; // enforce-when-active; no plan means no constraint

  const files = stagedFiles();

  // 1. scope
  const violations = unruledViolations(plan, files);
  if (violations.length) {
    console.error(`[plan-check] COMMIT REFUSED: ${violations.length} file(s) outside plan ${plan.id} with NO RULING:`);
    for (const f of violations) console.error(`  ${f}`);
    console.error(`[plan-check] scope: ${((plan.scope || {}).files || []).join(', ') || '(empty)'}`);
    console.error('[plan-check] Get the architect to rule on each:');
    console.error('[plan-check]   node scripts/plan-rule.js <file> "why it needs to change"');
    return 1;
  }

  // 2. step evidence must correspond to reality
  const done = (plan.steps || []).filter(s => s.done);
  const staged = new Set(files.map(f => f.replace(/\\/g, '/')));
  const bad = [];
  for (const s of done) {
    const cited = (s.evidence && s.evidence.files) || [];
    if (!cited.length) { bad.push(`step ${s.n}: marked done with NO evidence`); continue; }
    // At least one cited file must actually be in the commit. Requiring ALL of them
    // would misfire on a multi-commit plan where earlier steps already landed.
    const present = cited.some(f => staged.has(String(f).replace(/\\/g, '/')));
    if (!present && !s.evidence.committed) {
      bad.push(`step ${s.n}: cites ${cited.join(', ')}, none of which is in this commit`);
    }
  }
  if (bad.length) {
    console.error(`[plan-check] COMMIT REFUSED: step evidence does not match the diff:`);
    for (const b of bad) console.error(`  ${b}`);
    console.error('[plan-check] A step is done when the work exists, not when it is declared.');
    return 1;
  }

  const left = (plan.steps || []).filter(s => !s.done).length;
  console.log(`[plan-check] passed. Plan ${plan.id}: ${done.length} step(s) done, ${left} remaining.`);
  console.log(`[plan-check] NOTE: verify budget (${plan.verifyBudget}) is NOT enforced here; see the header.`);
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { main };
