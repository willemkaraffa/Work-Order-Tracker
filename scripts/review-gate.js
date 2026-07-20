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

// Files whose change carries no code risk an LLM reviewer could catch: docs, and the
// Overseer's own config/hooks (markdown, .claude/**, roadmap-handoffs/**). A commit
// touching ONLY these skips the gemini review REQUIREMENT -- the LLM adds nothing on
// prose or JSON and running it there is pure tax. The deterministic gates (tests, this
// findings gate for code) are untouched: they are cheap guards, not the tax. If even
// one code file is in the set, the full review is required as before.
function reviewExempt(files) {
  if (!files || !files.length) return false;
  return files.every(f =>
    /\.md$/i.test(f) || f.startsWith('.claude/') || f.startsWith('roadmap-handoffs/'));
}

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
      reason: `${uncitable.length} OPEN finding(s) with NO symbol (cannot be cite-verified): ${uncitable.map(f => f.id).join(', ')}. Re-run review so it emits a verbatim symbol, or send it to the architect: node scripts/review-disposition.js <id> "argument"`,
    };
  }
  if (open.length) {
    return {
      ok: false,
      reason: `${open.length} finding(s) still OPEN: ${open.map(f => f.id).join(', ')}. Cite them: node scripts/cite.js. Then get the architect to rule on each: node scripts/review-disposition.js <id> "your argument"`,
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

// Hash the SAME range the review covered (persisted as doc.range), not a hardcoded
// HEAD: a review run against a custom ref (e.g. origin/main) would otherwise be
// falsely reported STALE because the gate diffed a different range. Default HEAD for
// older ledgers that predate the range field.
// Returns the hash, or null if git fails (e.g. a persisted range that names a ref
// which no longer exists). A null must REFUSE with a clear message, never crash the
// gate with a raw stack -- the caller handles that.
function currentDiffHash(range = 'HEAD') {
  let diff;
  try {
    diff = execFileSync('git', ['diff', range], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  } catch {
    return null;
  }
  return require('./gemini-review.js').diffHash(diff);
}

function readDoc() {
  try {
    return JSON.parse(fs.readFileSync(FINDINGS_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function changedFiles(range = 'HEAD') {
  try {
    return execFileSync('git', ['diff', range, '--name-only'], { encoding: 'utf8' })
      .split('\n').map(s => s.trim()).filter(Boolean);
  } catch { return []; }
}

function main() {
  const doc = readDoc();
  // Docs/config-only commit: skip the LLM-review requirement (see reviewExempt).
  // doc?.range (not doc && doc.range): a docs-only commit usually has NO review doc,
  // so doc is null -> undefined -> HEAD default fires and changedFiles returns the real
  // files. `doc && doc.range` would pass null -> `git diff null` fails -> [] -> the
  // exemption never triggers for the exact case it exists to serve.
  if (reviewExempt(changedFiles(doc?.range))) {
    console.log('[review-gate] passed. Docs/config-only change; LLM review not required.');
    return 0;
  }
  // Only hash when there is a doc: a null doc is refused by evaluate regardless, so
  // spawning git first is wasted. When there IS a doc, a null hash means git failed
  // on its range -> refuse with a clear message, not a stack trace.
  const hash = doc ? currentDiffHash(doc.range) : null;
  if (doc && hash === null) {
    console.error(`[review-gate] COMMIT REFUSED: could not diff range '${doc.range}' (git failed; ref gone?). Re-run: node scripts/gemini-review.js`);
    return 1;
  }
  const verdict = evaluate(doc, hash);
  if (!verdict.ok) {
    console.error(`[review-gate] COMMIT REFUSED: ${verdict.reason}`);
    return 1;
  }
  // Surface dismissals so a human sees what was waved off, and why.
  //
  // ATTRIBUTE PER FINDING, never blanket. A blanket "DISMISSED by the architect"
  // banner shipped briefly and was wrong: findings dismissed by Claude in earlier
  // sessions (before the architect existed) were retro-credited to a superior that
  // never ruled on them. That is exactly the false provenance this chain exists to
  // stop, so the label reads off `ruledBy`, which only architect.js writes.
  if (verdict.dismissed.length) {
    const ruled = verdict.dismissed.filter(f => f.ruledBy === 'architect').length;
    const selfJudged = verdict.dismissed.length - ruled;
    console.log(`[review-gate] passed. ${verdict.dismissed.length} finding(s) DISMISSED, read the reasons:`);
    if (selfJudged) {
      console.log(`  NOTE: ${selfJudged} of these were self-dispositioned by Claude, NOT ruled by the architect.`);
    }
    for (const f of verdict.dismissed) {
      const by = f.ruledBy === 'architect' ? 'architect' : 'Claude (self-judged)';
      console.log(`  [${f.id}] ${f.file}:${f.line ?? '?'} ${f.problem}`);
      console.log(`         dismissed by: ${by}`);
      console.log(`         reason: ${f.reason}`);
    }
  } else {
    console.log('[review-gate] passed. All findings fixed, none dismissed.');
  }
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { evaluate, reviewExempt };
