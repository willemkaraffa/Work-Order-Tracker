'use strict';
/*
 * plan-step.js: the coder's ONLY write path into the plan.
 *
 *   node scripts/plan-step.js <n> --files src/a.js,src/b.js --ran "npm run verify"
 *
 * Touches exactly two fields: steps[n].done and steps[n].evidence. Scope, budget,
 * status and rulings are unreachable from here, so the coder cannot widen its own
 * leash. Same shape as review-disposition.js: the narrow sanctioned write.
 *
 * EVIDENCE, NOT ATTESTATION. A step is not "done" because it says so; it carries
 * what changed and what was run, and plan-check.js verifies those files actually
 * appear in the diff at commit time. This is the discipline cite.js already applies
 * to reviewer findings, pointed downward at the coder.
 *
 * Honest limit, same one cite.js states about itself: citation proves work HAPPENED,
 * not that it was the RIGHT work. A coder can cite real changes made for wrong
 * reasons. Catching that is the reviewer's and architect's job, not this script's.
 */
const fs = require('fs');
const { readPlan, PLAN_FILE, isActive } = require('./plan.js');

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : (process.argv[i + 1] || null);
}

function main() {
  const n = Number(process.argv[2]);
  const files = (argValue('--files') || '').split(',').map(s => s.trim()).filter(Boolean);
  const ran = argValue('--ran');

  if (!Number.isInteger(n)) {
    console.error('usage: node scripts/plan-step.js <n> --files a.js,b.js --ran "npm run verify"');
    return 2;
  }
  const plan = readPlan();
  if (!plan) { console.error('[plan-step] no .plan.json.'); return 2; }
  if (!isActive(plan)) {
    console.error('[plan-step] the plan is not approved yet; there is nothing to report progress against.');
    return 2;
  }

  const step = (plan.steps || []).find(s => s.n === n);
  if (!step) {
    console.error(`[plan-step] no step ${n}. Steps: ${(plan.steps || []).map(s => s.n).join(', ') || '(none)'}`);
    return 2;
  }
  if (!files.length) {
    console.error('[plan-step] --files is REQUIRED. A step marked done with no cited files is an attestation, not evidence.');
    return 2;
  }

  step.done = true;
  step.evidence = { files, ran: ran || null, at: new Date().toISOString() };
  fs.writeFileSync(PLAN_FILE, JSON.stringify(plan, null, 2));

  const left = (plan.steps || []).filter(s => !s.done).length;
  console.log(`[plan-step] step ${n} done: ${step.do}`);
  console.log(`[plan-step] evidence: ${files.join(', ')}${ran ? ` | ran: ${ran}` : ''}`);
  console.log(`[plan-step] ${left} step(s) remaining.`);
  return 0;
}

process.exitCode = main();
