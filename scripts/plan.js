'use strict';
/*
 * plan.js: shared reader + scope matcher for the plan artifact (.plan.json).
 *
 * Pure and dependency-free ON PURPOSE. A hook imports this, and hooks must never
 * break because an undeclared transitive package moved. minimatch IS present in
 * node_modules, but only via eslint, so depending on it would let a dep bump
 * silently disarm a gate. The pattern vocabulary a plan scope needs is small.
 *
 * ENFORCEMENT STANCE (decided by the human 2026-07-20): scope is enforced only
 * while a plan is ACTIVE. No plan on disk means no constraint. Blocking every
 * edit whenever no plan exists would brick ad-hoc work and, more to the point,
 * would make the repo unusable whenever the human is not present to approve one.
 * A gate nobody can pass without a human in the loop stops being a gate and
 * becomes an outage.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO_ROOT = path.join(__dirname, '..');
const PLAN_FILE = path.join(REPO_ROOT, '.plan.json');

// A plan constrains work only in these states. `draft` does NOT: it has not been
// approved by anyone, so enforcing it would let the ARCHITECT (or a forged draft)
// constrain the tree with no human in the loop.
const ACTIVE = new Set(['approved']);

function readPlan(file = PLAN_FILE) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

const isActive = plan => !!plan && ACTIVE.has(plan.status);

// Glob -> RegExp. Supports the three things a scope actually uses:
//   **  any number of path segments
//   *   any run of characters within one segment (does not cross /)
//   ?   one character
// Everything else is escaped literally. Paths are compared with forward slashes.
function globToRe(pattern) {
  let re = '';
  const p = String(pattern).replace(/\\/g, '/');
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        // `**/` should also match zero segments, so "src/**/x.js" matches "src/x.js".
        if (p[i + 2] === '/') { re += '(?:.*/)?'; i += 2; }
        else { re += '.*'; i += 1; }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

// True when `file` (repo-relative) is inside any of the scope patterns.
// A bare directory pattern ("scripts") covers everything under it, because a plan
// author writing "scripts" plainly means the directory, and reading it as an exact
// filename would silently scope the plan to nothing.
function matchesScope(file, patterns) {
  const f = String(file).replace(/\\/g, '/').replace(/^\.\//, '');
  return (patterns || []).some(pat => {
    const p = String(pat).replace(/\\/g, '/').replace(/^\.\//, '');
    if (globToRe(p).test(f)) return true;
    if (!p.includes('*') && (f === p || f.startsWith(p.replace(/\/$/, '') + '/'))) return true;
    return false;
  });
}

// Files touched outside the plan's scope that are not cleared to be there.
//
// ONLY `widen` CLEARS. This was wrong in the first cut and a live test caught it:
// the code treated ANY ruling as clearing the block, so a `revert` ruling -- which
// means "back this change out" -- unblocked the very file it rejected. The
// architect printed "still OUT of scope and still blocked" while the guard was
// about to allow the write. A ruling is not a permission slip; only a favourable
// one is.
//
// A `widen` needs no special case here: architect.js appends the file to
// scope.files, so matchesScope already covers it. Checking the verdict as well
// would be belt-and-braces on the same fact. `revert` and `escalate` deliberately
// leave the file outside, which is what keeps them from being the soft path.
function ruledVerdict(plan, file) {
  const f = String(file).replace(/\\/g, '/');
  let verdict = null; // last ruling on this file wins
  for (const r of plan.rulings || []) {
    for (const rf of r.files || []) {
      if (String(rf).replace(/\\/g, '/') === f) verdict = r.verdict;
    }
  }
  return verdict;
}

function unruledViolations(plan, files) {
  if (!isActive(plan)) return [];
  const scope = (plan.scope && plan.scope.files) || [];
  return (files || [])
    .map(f => String(f).replace(/\\/g, '/'))
    .filter(f => !matchesScope(f, scope));
}

// Repeated `widen` rulings mean the PLAN was wrong, not that the coder found N
// surprises. Deterministic, no judgment: at the threshold it goes to the human.
const WIDEN_LIMIT = 3;
const widenCount = plan =>
  ((plan && plan.rulings) || []).filter(r => r.verdict === 'widen').length;

// Where the plan-scoped heavy-verify tally lives.
//
// KEYED BY PLAN ID, NOT session_id. verifyBudget is documented as a TOTAL for the
// plan, shared by every agent and every session (architect.js). The counter in
// verify-budget-guard.js is keyed by session_id over a 15-minute sliding window: it
// answers "is this session bursting right now", which is the right question for a
// nudge and the wrong one for "how much has this plan cost". Neither counter can be
// derived from the other, which is why both exist.
//
// IN tmpdir, NOT in .plan.json. A hook that wrote the tracked plan artifact on every
// test run would dirty the tree mid-work and invalidate the review diff hash, so the
// act of measuring would keep re-triggering the gates that measure.
//
// A missing plan gets its own bucket rather than being refused: ad-hoc work is the
// normal mode here, and a spend readout that only works under an approved plan would
// report nothing exactly when nobody is watching.
const verifyTallyFile = plan =>
  path.join(os.tmpdir(),
    `wot-verifytally-${String((plan && plan.id) || 'noplan').replace(/[^\w.-]/g, '_')}.json`);

module.exports = {
  readPlan, isActive, matchesScope, globToRe, unruledViolations, ruledVerdict,
  widenCount, WIDEN_LIMIT, PLAN_FILE, ACTIVE, verifyTallyFile,
};
