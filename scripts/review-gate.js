'use strict';
/*
 * review-gate.js: refuses a commit while any reviewer finding is unaddressed.
 *
 * WHY: the reviewer is advisory, and on 2026-07-16 that meant Claude was the sole
 * judge of its findings, with no record of the verdict. Claude dismissed one as a
 * false positive and was right, but nobody could check that. Independence that
 * terminates in the reviewed party's private judgment is not independence.
 *
 * WHAT THIS DOES AND DOES NOT DO. It cannot judge whether a dismissal reason is
 * GOOD; that needs judgment. It CAN guarantee no finding is dropped silently:
 * every one must end as `fixed`, or `dismissed` with a written reason carrying
 * Claude's name on it, which a human can then read and overrule. It converts
 * invisible discretion into an auditable record. That is the whole claim; it is
 * not a correctness gate.
 *
 * STALENESS IS DELIBERATE. Findings are bound to a diff hash. Fixing a finding
 * changes the diff, which invalidates the review, which forces a fresh one. That
 * loop is the point: the tree that gets committed is a tree that was reviewed.
 *
 * NO OVERRIDE KNOB, ON PURPOSE. If Gemini is down (429/503) the reviewer records
 * nothing and this gate blocks. There is deliberately no flag for Claude to
 * self-serve past it: a knob Claude may turn is not a gate. The escape is a human
 * action that is visible and deliberate (unset core.hooksPath). Claude must never
 * do that; doing so is tampering, not a judgment call.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FINDINGS_FILE = path.join(__dirname, '..', '.review-findings.json');

// Pure: takes state, returns a verdict. Kept free of fs/git so it is testable.
// doc = parsed findings file (or null). currentHash = hash of the tree being committed.
function evaluate(doc, currentHash) {
  if (!doc) {
    return { ok: false, reason: 'no review on record for this tree. Run: node scripts/gemini-review.js' };
  }
  if (doc.diffHash !== currentHash) {
    return {
      ok: false,
      reason: `review is STALE (reviewed ${doc.diffHash}, committing ${currentHash}). The code moved since review. Re-run: node scripts/gemini-review.js`,
    };
  }
  const open = (doc.findings || []).filter(f => f.status === 'open');
  // An OPEN finding with no symbol cannot be located or verified by cite.js. It is
  // NOT auto-dropped (that would bias toward silencing true findings); it blocks,
  // open, until a human gets a real citation or dispositions it with a reason. Same
  // spirit as the bare-dismissal check: a claim the pipeline cannot check must not
  // pass silently. Reported first so its message is the actionable one.
  const uncitable = open.filter(f => !String(f.symbol || '').trim());
  if (uncitable.length) {
    return {
      ok: false,
      reason: `${uncitable.length} OPEN finding(s) with NO symbol (cannot be cite-verified): ${uncitable.map(f => f.id).join(', ')}. Re-run review so it emits a verbatim symbol, or disposition manually: node scripts/review-disposition.js <id> fixed|dismissed "reason"`,
    };
  }
  if (open.length) {
    return {
      ok: false,
      reason: `${open.length} finding(s) still OPEN: ${open.map(f => f.id).join(', ')}. Cite them: node scripts/cite.js. Then disposition each: node scripts/review-disposition.js <id> fixed|dismissed "reason"`,
    };
  }
  const bare = (doc.findings || []).filter(
    f => f.status === 'dismissed' && !String(f.reason || '').trim()
  );
  if (bare.length) {
    return {
      ok: false,
      reason: `${bare.length} finding(s) dismissed with NO reason: ${bare.map(f => f.id).join(', ')}. A dismissal without a stated reason is a silent drop.`,
    };
  }
  const dismissed = (doc.findings || []).filter(f => f.status === 'dismissed');
  return { ok: true, dismissed };
}

function currentDiffHash() {
  const diff = execFileSync('git', ['diff', 'HEAD'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  return require('./gemini-review.js').diffHash(diff);
}

function readDoc() {
  try {
    return JSON.parse(fs.readFileSync(FINDINGS_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function main() {
  const verdict = evaluate(readDoc(), currentDiffHash());
  if (!verdict.ok) {
    console.error(`[review-gate] COMMIT REFUSED: ${verdict.reason}`);
    return 1;
  }
  // Surface dismissals so a human sees what Claude waved off, and why.
  if (verdict.dismissed.length) {
    console.log(`[review-gate] passed. ${verdict.dismissed.length} finding(s) DISMISSED by Claude, read the reasons:`);
    for (const f of verdict.dismissed) {
      console.log(`  [${f.id}] ${f.file}:${f.line ?? '?'} ${f.problem}`);
      console.log(`         reason: ${f.reason}`);
    }
  } else {
    console.log('[review-gate] passed. All findings fixed, none dismissed.');
  }
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { evaluate };
