'use strict';
/*
 * plan-rule.js: ask the ARCHITECT to rule on an out-of-scope file.
 *
 *   node scripts/plan-rule.js <file> ["why this file genuinely needs to change"]
 *
 * Takes NO verdict, same as review-disposition.js. You supply the justification;
 * the architect returns widen, revert, or escalate, and this writes what it says.
 * If Claude could type the verdict, there would be no architect.
 *
 * Exit: 0 widened (proceed), 1 still blocked / escalated, 2 no ruling.
 */
const path = require('path');
const { spawnSync } = require('child_process');

function main() {
  const [file, ...rest] = process.argv.slice(2);
  const argument = rest.join(' ').trim();

  if (!file) {
    console.error('usage: node scripts/plan-rule.js <file> ["why it needs to change"]');
    return 2;
  }
  // Catch someone reaching for the verdict, same as review-disposition.js does.
  if (['widen', 'revert', 'escalate'].includes(file)) {
    console.error(`[plan-rule] '${file}' is a VERDICT, and you do not supply one.`);
    console.error('[plan-rule] usage: node scripts/plan-rule.js <file> ["your justification"]');
    return 2;
  }

  const r = spawnSync(
    process.execPath,
    [path.join(__dirname, 'architect.js'), 'scope', file, ...(argument ? [argument] : [])],
    { stdio: 'inherit' }
  );
  return r.status === null ? 2 : r.status;
}

process.exitCode = main();
