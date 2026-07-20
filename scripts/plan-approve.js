'use strict';
/*
 * plan-approve.js: flip a drafted plan to `approved`. THE HUMAN DECIDES, not Claude.
 *
 *   node scripts/plan-approve.js            approve the current .plan.json
 *   node scripts/plan-approve.js --status   show the plan without changing it
 *
 * HOW THE AUTHORITY IS REAL. Claude runs this script, but running it is not the
 * same as deciding. The script refuses unless it finds, in the session transcript,
 * a human answer to the AskUserQuestion "Approve plan <id>?" -- a channel Claude
 * provably cannot author (see scripts/user-grant.js for the forge analysis).
 * So the flow is: Claude ASKS via AskUserQuestion, the human presses a button,
 * then this script can see the answer. No answer, no approval, no exceptions.
 *
 * WHY NOT JUST LET CLAUDE WRITE status:approved? Because then the plan gate would
 * be a gate Claude opens for itself, which is not a gate. Same reason the review
 * gate has no override flag.
 *
 * Exit: 0 approved (or status shown), 1 refused, 2 usage/no plan.
 */
const fs = require('fs');
const path = require('path');
const { lastUserGrant } = require('./user-grant.js');
const { readPlan, PLAN_FILE, isActive } = require('./plan.js');

const APPROVE = 'Approve';
const questionFor = id => `Approve plan ${id}?`;

// The transcript path is supplied by the harness to hooks, but a plain script has
// to find it. Newest .jsonl in this project's transcript dir is the live session.
// Overridable for tests.
function currentTranscript() {
  if (process.env.WOT_TRANSCRIPT) return process.env.WOT_TRANSCRIPT;
  const dir = path.join(
    process.env.USERPROFILE || process.env.HOME || '',
    '.claude', 'projects', 'C--dev-Work-Order-Tracker');
  try {
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    return files.length ? path.join(dir, files[0].f) : null;
  } catch { return null; }
}

function show(plan) {
  console.log(`[plan] ${plan.id}`);
  console.log(`[plan] status: ${plan.status}${isActive(plan) ? ' (ENFORCED)' : ' (not enforced)'}`);
  console.log(`[plan] goal: ${plan.goal}`);
  console.log(`[plan] scope: ${((plan.scope || {}).files || []).join(', ') || '(none)'}`);
  console.log(`[plan] verify budget: ${plan.verifyBudget}`);
  for (const s of plan.steps || []) {
    console.log(`  ${s.done ? '[x]' : '[ ]'} ${s.n}. ${s.do}`);
  }
}

function main() {
  const plan = readPlan();
  if (!plan) {
    console.error('[plan] no .plan.json. Draft one: node scripts/architect.js plan "<goal>"');
    return 2;
  }
  if (process.argv.includes('--status')) { show(plan); return 0; }

  if (plan.status === 'approved') {
    console.log(`[plan] ${plan.id} is already approved.`);
    return 0;
  }
  if (plan.status === 'rejected') {
    console.error(`[plan] ${plan.id} was REJECTED as infeasible by the architect. It cannot be approved.`);
    console.error('[plan] Take the alternatives to the human, or draft a different plan.');
    return 1;
  }

  const tp = currentTranscript();
  const answer = tp ? lastUserGrant(tp, questionFor(plan.id)) : null;

  if (answer !== APPROVE) {
    console.error(`[plan] REFUSED: no human approval on record for ${plan.id}.`);
    console.error('[plan] Claude cannot approve a plan. Ask the human with AskUserQuestion,');
    console.error(`[plan] question EXACTLY: "${questionFor(plan.id)}", option "${APPROVE}".`);
    console.error('[plan] Then run this again. Editing .plan.json by hand is tampering, not a shortcut.');
    return 1;
  }

  plan.status = 'approved';
  plan.approvedBy = 'human';
  plan.approvedAt = new Date().toISOString();
  fs.writeFileSync(PLAN_FILE, JSON.stringify(plan, null, 2));

  console.log(`[plan] ${plan.id} APPROVED by the human.`);
  console.log('[plan] Scope is now ENFORCED: edits outside scope.files will be blocked.');
  show(plan);
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { questionFor, APPROVE, currentTranscript };
