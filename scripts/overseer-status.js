'use strict';
/*
 * overseer-status.js: report what Project Overseer is ACTUALLY enforcing, read
 * from disk. Not a description of the design, a measurement of the installation.
 *
 * WHY THIS EXISTS: the gates fire without being asked, but the architect only runs
 * when invoked, so "is the Overseer running?" has a genuinely ambiguous answer that
 * a human cannot see from the outside. Worse, the failure mode of every guard here
 * is to fail OPEN: a hook with a syntax error, an unregistered hook, or an unset
 * core.hooksPath all produce silence, which is indistinguishable from compliance.
 * This script exists to make silence legible.
 *
 * It must NEVER report health it has not verified. Every line below is derived from
 * a file that exists, a config value that is set, or a count that was read.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const P = (...a) => path.join(REPO, ...a);
const ok = b => (b ? 'OK  ' : 'GAP ');

function git(args) {
  try { return execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim(); }
  catch { return null; }
}
function readJson(f) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}
const exists = f => { try { return fs.existsSync(f); } catch { return false; } };

// --- 1. enforcement layer -----------------------------------------------------
// A hook only bites if BOTH the file exists AND it is registered. Checking one
// without the other is how a disarmed guard reads as healthy.
function enforcement() {
  const lines = [];
  let gaps = 0;

  const hooksPath = git(['config', 'core.hooksPath']);
  const preCommit = hooksPath ? P(hooksPath, 'pre-commit') : null;
  const commitGates = hooksPath === '.githooks' && exists(preCommit);
  lines.push(`  ${ok(commitGates)} commit gates: core.hooksPath=${hooksPath || '(unset)'}` +
    (commitGates ? '' : '  <-- pre-commit will NOT run'));
  if (!commitGates) gaps++;

  const settings = readJson(P('.claude', 'settings.json')) || {};
  const registered = new Set();
  for (const ev of Object.values(settings.hooks || {})) {
    for (const m of ev || []) for (const h of m.hooks || []) {
      const found = /([\w.-]+\.js)/.exec(h.command || '');
      if (found) registered.add(found[1]);
    }
  }
  const guards = [
    ['verify-thrash-guard.js', 'G1', 'thrash guard'],
    ['verify-budget-guard.js', 'G2', 'verify budget nudge'],
    ['plan-scope-guard.js', 'G3', 'plan scope guard'],
    ['length-check.js', 'G4', 'style gate'],
    ['scraper-data-gate.js', null, 'scraper data gate'],
  ];
  let registry = null;
  try { registry = require('./rule-registry.js'); } catch { /* reported below */ }

  for (const [file, ruleId, label] of guards) {
    const onDisk = exists(P('.claude', 'hooks', file));
    const wired = registered.has(file);
    // A rule retired by evidence is a DELIBERATE stand-down, not a gap.
    let retired = false;
    if (registry && ruleId) { try { retired = !registry.isRuleActive(ruleId); } catch { /* active */ } }
    const good = onDisk && wired;
    if (!good) gaps++;
    lines.push(`  ${ok(good)} ${label}: ${onDisk ? 'present' : 'MISSING'}, ${wired ? 'registered' : 'NOT REGISTERED'}` +
      (retired ? '  [RETIRED by evidence: standing down on purpose]' : ''));
  }
  return { lines, gaps };
}

// --- 2. the plan --------------------------------------------------------------
function plan() {
  let lib, doc;
  try { lib = require('./plan.js'); doc = lib.readPlan(); } catch { return ['  (plan module unreadable)']; }
  if (!doc) return ['  no plan on disk. Scope is NOT enforced (this is the normal ad-hoc mode).'];

  const active = lib.isActive(doc);
  const steps = doc.steps || [];
  const done = steps.filter(s => s.done).length;
  const out = [
    `  ${doc.id}`,
    `  status: ${doc.status}${active ? '  <-- SCOPE IS ENFORCED' : '  (not enforced; only an approved plan constrains edits)'}`,
    `  goal: ${doc.goal}`,
    `  scope: ${((doc.scope || {}).files || []).join(', ') || '(none)'}`,
    `  steps: ${done}/${steps.length} done`,
  ];
  const widens = (doc.rulings || []).filter(r => r.verdict === 'widen').length;
  if (doc.rulings && doc.rulings.length) {
    out.push(`  rulings: ${doc.rulings.length} (${widens} widen)` +
      (widens >= (lib.WIDEN_LIMIT || 3) ? '  <-- DRIFT: the plan itself is wrong, re-plan' : ''));
  }
  return out;
}

// --- 3. findings, and who actually judged them --------------------------------
function findings() {
  const doc = readJson(P('.review-findings.json'));
  if (!doc) return ['  no review on record for this tree.'];
  const f = doc.findings || [];
  const by = s => f.filter(x => x.status === s).length;
  const untriaged = f.filter(x => x.status === 'open' && x.ruledBy !== 'architect').length;
  const dismissed = f.filter(x => x.status === 'dismissed');
  const selfJudged = dismissed.filter(x => x.ruledBy !== 'architect').length;

  const out = [
    `  ledger: ${f.length} finding(s), diff ${doc.diffHash || '?'}`,
    `  open ${by('open')} | fixed ${by('fixed')} | dismissed ${dismissed.length} | escalated ${by('escalated')}`,
  ];
  if (untriaged) out.push(`  ${untriaged} UNTRIAGED: the architect has not seen these. Commit is blocked.`);
  if (by('escalated')) out.push(`  ${by('escalated')} ESCALATED to you. Not the coder's to fix or dismiss.`);
  // The provenance split is the honest answer to "was the architect involved?"
  out.push(`  dismissals: ${dismissed.length - selfJudged} architect-ruled, ${selfJudged} Claude self-judged`);
  if (selfJudged) out.push('  re-rule the self-judged ones: node scripts/architect.js retriage');

  // THE FULL LIST LIVES HERE. review-gate.js stopped reprinting every dismissal on
  // every commit (its output grew without bound and buried what actually changed),
  // so this is now the place a human reads the whole history. Nothing was pruned
  // from the ledger; dropping dismissals would be laundering on a timer.
  if (dismissed.length) {
    out.push('', '  ALL DISMISSALS:');
    for (const f of dismissed) {
      out.push(`  [${f.id}] ${f.ruledBy === 'architect' ? 'architect' : 'Claude (self-judged)'}  ${f.file}:${f.line ?? '?'}`);
      out.push(`         ${f.problem}`);
      out.push(`         reason: ${f.reason}`);
    }
  }
  return out;
}

// --- 4. rule registry ---------------------------------------------------------
function rules() {
  let board;
  try { board = require('./rule-registry.js').scoreboard(); } catch { return ['  (registry module unreadable)']; }
  if (!board) return ['  no rule registry found. Every rule therefore counts as ACTIVE (fail-active).'];

  const out = [];
  for (const r of board) {
    const p = r.precision === null ? '-' : r.precision.toFixed(2);
    const drift = r.stored !== r.derived ? `  <-- stored says ${r.stored}` : '';
    out.push(`  ${r.derived === 'retired' ? 'DEAD' : 'live'} ${r.id.padEnd(3)} TP=${r.tp} FP=${r.fp} prec=${p}  ${r.derived}${drift}`);
  }
  const dead = board.filter(r => r.derived === 'retired').length;
  out.push(`  ${board.length} rules, ${dead} retired by evidence.`);
  return out;
}

function main() {
  const e = enforcement();
  console.log('\nPROJECT OVERSEER STATUS');
  console.log('(read from disk; nothing here is asserted from memory)\n');

  console.log('ENFORCEMENT (automatic, fires without being asked)');
  e.lines.forEach(l => console.log(l));

  console.log('\nPLAN');
  plan().forEach(l => console.log(l));

  console.log('\nFINDINGS');
  findings().forEach(l => console.log(l));

  console.log('\nRULES');
  rules().forEach(l => console.log(l));

  console.log('\nARCHITECT (manual: runs ONLY when invoked)');
  console.log('  There is no ambient architect. It is a script, not a daemon.');
  console.log('  Evidence it ran THIS session = architect-ruled dismissals above, or a fresh plan.');
  console.log('  Invoke: architect.js plan "<goal>" | triage | rule <id> | scope <file>');

  console.log(`\nVERDICT: ${e.gaps === 0
    ? 'gates ARE enforcing. They cannot be skipped, including by me.'
    : `${e.gaps} GAP(S) ABOVE. Some enforcement is NOT active.`}`);
  console.log('');
  return e.gaps === 0 ? 0 : 1;
}

if (require.main === module) process.exitCode = main();
module.exports = { enforcement, plan, findings, rules };
