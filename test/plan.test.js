'use strict';
// Covers plan ENFORCEMENT: the scope matcher, the ruling-absence rule, and the
// PreToolUse guard that blocks out-of-scope writes.
// Exit codes: 0 pass / 1 fail / 2 skip (see test/run.js).
//
// Imports the SHIPPED modules and spawns the SHIPPED hook, never a hand-copy.
// Offline: no Gemini call is made anywhere in this file.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  matchesScope, globToRe, isActive, unruledViolations, ruledVerdict, widenCount, WIDEN_LIMIT,
} = require('../scripts/plan.js');
const { parseScopeRuling } = require('../scripts/architect.js');

let failed = 0;
function t(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}: ${e.message}`); }
}

// ============================================================================
// scope matching
// ============================================================================

t('scope: ** matches across directories, including zero of them', () => {
  assert.ok(matchesScope('scripts/architect.js', ['scripts/**']));
  assert.ok(matchesScope('scripts/deep/nested/x.js', ['scripts/**']));
  assert.ok(matchesScope('src/x.js', ['src/**/x.js']), 'zero intermediate segments must match');
  assert.ok(matchesScope('src/a/b/x.js', ['src/**/x.js']));
});

t('scope: * does NOT cross a directory separator', () => {
  assert.ok(matchesScope('scripts/a.js', ['scripts/*.js']));
  assert.strictEqual(matchesScope('scripts/deep/a.js', ['scripts/*.js']), false);
});

t('scope: a bare directory name covers everything under it', () => {
  // A plan author writing "scripts" means the directory. Reading it as an exact
  // filename would scope the plan to nothing at all, silently.
  assert.ok(matchesScope('scripts/architect.js', ['scripts']));
  assert.ok(matchesScope('scripts/a/b.js', ['scripts']));
  assert.strictEqual(matchesScope('scriptsfoo/b.js', ['scripts']), false, 'prefix must not leak');
});

t('scope: a file outside every pattern does not match', () => {
  assert.strictEqual(matchesScope('src/app.jsx', ['scripts/**', 'test/*.js']), false);
});

t('scope: backslash paths are normalised (Windows)', () => {
  assert.ok(matchesScope('scripts\\architect.js', ['scripts/**']));
  assert.ok(matchesScope('scripts/architect.js', ['scripts\\**']));
});

t('scope: an empty pattern list matches nothing', () => {
  assert.strictEqual(matchesScope('a.js', []), false);
  assert.strictEqual(matchesScope('a.js', undefined), false);
});

t('scope: regex metacharacters in a pattern are literal', () => {
  assert.ok(globToRe('a.b.js').test('a.b.js'));
  assert.strictEqual(globToRe('a.b.js').test('aXbYjs'), false, '. must not act as a wildcard');
});

// ============================================================================
// enforce-when-active, and blocking on the ABSENCE OF A RULING
// ============================================================================

const plan = (over = {}) => ({
  id: 'plan-x', status: 'approved',
  scope: { files: ['scripts/**'] }, steps: [], rulings: [], verifyBudget: 2, ...over,
});

t('active: only an approved plan is enforced', () => {
  assert.strictEqual(isActive(plan()), true);
  assert.strictEqual(isActive(plan({ status: 'draft' })), false, 'a draft nobody approved must not constrain');
  assert.strictEqual(isActive(plan({ status: 'rejected' })), false);
  assert.strictEqual(isActive(plan({ status: 'complete' })), false);
  assert.strictEqual(isActive(null), false, 'no plan at all means no constraint');
});

t('violations: an in-scope file is not a violation', () => {
  assert.deepStrictEqual(unruledViolations(plan(), ['scripts/a.js']), []);
});

t('violations: an out-of-scope file with no ruling IS a violation', () => {
  assert.deepStrictEqual(unruledViolations(plan(), ['src/app.jsx']), ['src/app.jsx']);
});

// CORRECTED 2026-07-20. This used to assert that ANY ruling cleared the file, and
// it was wrong in the same way the code was: a `revert` ruling means "back this
// out", so treating it as clearance unblocked the file the architect had just
// rejected. A live end-to-end test caught it while the unit tests stayed green,
// because the test encoded the same wrong assumption as the code.
t('violations: a REVERT ruling does NOT clear the file', () => {
  const p = plan({ rulings: [{ files: ['src/app.jsx'], verdict: 'revert', reason: 'r', by: 'architect' }] });
  assert.deepStrictEqual(unruledViolations(p, ['src/app.jsx']), ['src/app.jsx'],
    'a ruling against the file is not a permission slip');
});

t('violations: an ESCALATE ruling does NOT clear the file either', () => {
  const p = plan({ rulings: [{ files: ['src/app.jsx'], verdict: 'escalate', reason: 'r', by: 'architect' }] });
  assert.deepStrictEqual(unruledViolations(p, ['src/app.jsx']), ['src/app.jsx']);
});

t('violations: a WIDEN clears the file, because it amends the scope', () => {
  // architect.js appends the file to scope.files on a widen, so the scope match
  // itself is what clears it. This asserts the end state that produces.
  const p = plan({
    scope: { files: ['scripts/**', 'src/app.jsx'] },
    rulings: [{ files: ['src/app.jsx'], verdict: 'widen', reason: 'r', by: 'architect' }],
  });
  assert.deepStrictEqual(unruledViolations(p, ['src/app.jsx']), []);
});

t('ruledVerdict: the LAST ruling on a file wins', () => {
  const p = plan({ rulings: [
    { files: ['src/app.jsx'], verdict: 'escalate' },
    { files: ['src/app.jsx'], verdict: 'widen' },
  ] });
  assert.strictEqual(ruledVerdict(p, 'src/app.jsx'), 'widen');
  assert.strictEqual(ruledVerdict(p, 'never/ruled.js'), null);
});

t('violations: an inactive plan yields no violations at all', () => {
  assert.deepStrictEqual(unruledViolations(plan({ status: 'draft' }), ['anything.js']), []);
});

t('drift: widen rulings are counted toward the escalation threshold', () => {
  const p = plan({ rulings: [
    { files: ['a'], verdict: 'widen' }, { files: ['b'], verdict: 'widen' },
    { files: ['c'], verdict: 'revert' },
  ] });
  assert.strictEqual(widenCount(p), 2);
  assert.ok(WIDEN_LIMIT >= 1);
});

// ============================================================================
// scope rulings: a malformed verdict must never widen a scope
// ============================================================================

t('scope ruling: a valid verdict parses', () => {
  assert.deepStrictEqual(parseScopeRuling('{"verdict":"widen","reason":"belongs to the plan"}'),
    { verdict: 'widen', reason: 'belongs to the plan' });
});

t('scope ruling: an unknown verdict THROWS rather than defaulting to widen', () => {
  assert.throws(() => parseScopeRuling('{"verdict":"approved","reason":"ok"}'), /unknown verdict/);
});

t('scope ruling: a reason is mandatory', () => {
  assert.throws(() => parseScopeRuling('{"verdict":"widen"}'), /no reason/);
});

// ============================================================================
// the PreToolUse guard, spawned for real
// ============================================================================

const GUARD = path.join(__dirname, '..', '.claude', 'hooks', 'plan-scope-guard.js');
const REPO_ROOT = path.join(__dirname, '..');
const PLAN_FILE = path.join(REPO_ROOT, '.plan.json');

// The guard reads the REAL .plan.json, so swap it out and always restore.
function withPlan(doc, fn) {
  const had = fs.existsSync(PLAN_FILE);
  const backup = had ? fs.readFileSync(PLAN_FILE, 'utf8') : null;
  try {
    if (doc === null) { if (had) fs.unlinkSync(PLAN_FILE); }
    else fs.writeFileSync(PLAN_FILE, JSON.stringify(doc, null, 2));
    return fn();
  } finally {
    if (backup !== null) fs.writeFileSync(PLAN_FILE, backup);
    else if (fs.existsSync(PLAN_FILE)) fs.unlinkSync(PLAN_FILE);
  }
}

const edit = (file_path) => {
  const r = spawnSync(process.execPath, [GUARD], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path } }),
    encoding: 'utf8',
  });
  return { status: r.status, stderr: r.stderr || '' };
};

t('guard: NO plan on disk means every edit is allowed', () => {
  // The most important test here. Enforcing with no plan would brick all ad-hoc
  // work and make the repo unusable whenever the human is not present to approve.
  withPlan(null, () => {
    assert.strictEqual(edit(path.join(REPO_ROOT, 'src/app.jsx')).status, 0);
  });
});

t('guard: a DRAFT plan does not constrain anything', () => {
  withPlan(plan({ status: 'draft' }), () => {
    assert.strictEqual(edit(path.join(REPO_ROOT, 'src/app.jsx')).status, 0);
  });
});

t('guard: an in-scope edit under an approved plan is allowed', () => {
  withPlan(plan(), () => {
    assert.strictEqual(edit(path.join(REPO_ROOT, 'scripts/architect.js')).status, 0);
  });
});

t('guard: an OUT-of-scope edit under an approved plan is BLOCKED', () => {
  withPlan(plan(), () => {
    const r = edit(path.join(REPO_ROOT, 'src/app.jsx'));
    assert.strictEqual(r.status, 2, 'must block');
    assert.match(r.stderr, /BLOCKED/);
    assert.match(r.stderr, /plan-rule\.js/, 'must name the way forward');
  });
});

t('guard: a WIDEN ruling (which amends scope) allows the edit', () => {
  const p = plan({
    scope: { files: ['scripts/**', 'src/app.jsx'] },
    rulings: [{ files: ['src/app.jsx'], verdict: 'widen', reason: 'r', by: 'architect' }],
  });
  withPlan(p, () => {
    assert.strictEqual(edit(path.join(REPO_ROOT, 'src/app.jsx')).status, 0);
  });
});

t('guard: a REVERT ruling still BLOCKS, and says the ruling stands', () => {
  // The live-caught bug: the architect prints "still blocked" while the guard was
  // about to allow the write, because it read any ruling as clearance.
  const p = plan({ rulings: [{ files: ['src/app.jsx'], verdict: 'revert', reason: 'r', by: 'architect' }] });
  withPlan(p, () => {
    const r = edit(path.join(REPO_ROOT, 'src/app.jsx'));
    assert.strictEqual(r.status, 2, 'a ruling AGAINST the file must not unblock it');
    assert.match(r.stderr, /already ruled REVERT/);
  });
});

t('guard: an ESCALATE ruling still BLOCKS', () => {
  const p = plan({ rulings: [{ files: ['src/app.jsx'], verdict: 'escalate', reason: 'r', by: 'architect' }] });
  withPlan(p, () => {
    assert.strictEqual(edit(path.join(REPO_ROOT, 'src/app.jsx')).status, 2);
  });
});

t('guard: a file OUTSIDE the repo is none of the plan business', () => {
  withPlan(plan(), () => {
    assert.strictEqual(edit(path.join(os.tmpdir(), 'scratch.js')).status, 0);
  });
});

t('guard: a corrupt .plan.json fails OPEN (never bricks the session)', () => {
  const had = fs.existsSync(PLAN_FILE);
  const backup = had ? fs.readFileSync(PLAN_FILE, 'utf8') : null;
  try {
    fs.writeFileSync(PLAN_FILE, '{ not json');
    assert.strictEqual(edit(path.join(REPO_ROOT, 'src/app.jsx')).status, 0);
  } finally {
    if (backup !== null) fs.writeFileSync(PLAN_FILE, backup);
    else fs.unlinkSync(PLAN_FILE);
  }
});

t('guard: a call with no file_path is ignored', () => {
  withPlan(plan(), () => {
    const r = spawnSync(process.execPath, [GUARD], {
      input: JSON.stringify({ tool_name: 'Edit', tool_input: {} }), encoding: 'utf8',
    });
    assert.strictEqual(r.status, 0);
  });
});

console.log(failed ? `\n${failed} failed` : '\nall plan tests pass');
process.exit(failed ? 1 : 0);
