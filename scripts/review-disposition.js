'use strict';
/*
 * review-disposition.js: ask the ARCHITECT to rule on a reviewer finding.
 *
 *   node scripts/review-disposition.js <id> ["the argument for why this is not a defect"]
 *
 * WHAT CHANGED, AND WHY IT IS THE WHOLE POINT. This script used to take the verdict
 * as a CLI argument (`<id> fixed|dismissed "reason"`), which meant whoever ran it
 * decided the outcome. In practice that was Claude dispositioning findings raised
 * against Claude's own code: sole judge, and observed going wrong on 2026-07-16.
 *
 * Now it takes NO verdict. It forwards the finding, the current file text, and your
 * ARGUMENT to the architect (external Gemini), and writes back whatever the
 * architect returns. You can TRIGGER a ruling; you cannot dictate one.
 *
 * The argument is EVIDENCE, not a verdict. Passing a genuinely good reason still
 * works: the architect reads it and can rule "dismissed". What no longer works is
 * asserting the conclusion. Argument versus ruling is the entire distinction.
 *
 * NOT a "who may run it" restriction: that is unimplementable, because a Task
 * subagent shares the parent's session_id and no hook can tell the coder from the
 * overseer. It does not matter WHO runs this, because the runner does not decide.
 *
 * Exit: 0 ruled (fixed/dismissed), 1 the finding STANDS, 2 no ruling (API down).
 * A dead API blocks dispositions on purpose. A knob Claude may turn is not a gate.
 */
const path = require('path');
const { spawnSync } = require('child_process');

function main() {
  const [id, ...rest] = process.argv.slice(2);
  const argument = rest.join(' ').trim();

  if (!id) {
    console.error('usage: node scripts/review-disposition.js <id> ["argument for the architect"]');
    return 2;
  }
  // Catch the OLD calling convention rather than silently forwarding "fixed" as if
  // it were an argument. Muscle memory (and stale docs) will keep producing it.
  if (['fixed', 'dismissed', 'open'].includes(rest[0])) {
    console.error(`[disposition] '${rest[0]}' is a VERDICT, and you no longer supply one.`);
    console.error('[disposition] The architect rules; you may only argue. Re-run with your reasoning:');
    console.error(`[disposition]   node scripts/review-disposition.js ${id} "why you believe this is not a defect"`);
    return 2;
  }

  const r = spawnSync(
    process.execPath,
    [path.join(__dirname, 'architect.js'), 'rule', id, ...(argument ? [argument] : [])],
    { stdio: 'inherit' }
  );
  return r.status === null ? 2 : r.status;
}

process.exitCode = main();
