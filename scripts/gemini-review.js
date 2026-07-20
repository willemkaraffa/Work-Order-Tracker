'use strict';
/*
 * gemini-review.js: external, advisory code reviewer on Gemini (see MODELS).
 *
 * WHY external: Claude Code subagents are Claude-only (the `model:` field takes
 * sonnet/opus/haiku/fable). To run the reviewer OFF Claude: and off the 5-hour
 * subscription window: it must live outside the Task runtime as a plain REST call.
 *
 * SAFETY: advisory only. It NEVER flips the verify gate. The deterministic
 * `npm run verify` gate + a human are the only green light. Exit-code contract:
 *   0 = ran clean (no findings) OR ran with findings in default advisory mode
 *   1 = ran, found issues, AND --strict was passed (opt-in blocking for CI)
 *   2 = did NOT run (no key / API error / bad response). Loud, never silent -
 *       a skipped review must not read as a clean review (false confidence).
 *
 * USAGE:
 *   node scripts/gemini-review.js                 review `git diff HEAD` (working tree)
 *   node scripts/gemini-review.js origin/main     review diff vs a ref/range
 *   node scripts/gemini-review.js --dry-run       assemble + print the request, no API call
 *   node scripts/gemini-review.js --strict        exit 1 if findings (for optional CI gate)
 *
 * KEY: GEMINI_API_KEY env var, OR a gitignored `.gemini-key` file at the repo
 *      root (paste the key there once: never on the CLI, never in chat). From
 *      Google AI Studio; keep the test project billing-OFF.
 *
 * MODEL: tries MODELS in order, using whichever answers (free-tier availability
 *        swings by the minute). GEMINI_MODEL=<id> pins one instead.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.join(__dirname, '..');
const FINDINGS_FILE = path.join(REPO_ROOT, '.review-findings.json');

// Identity of the reviewed tree. The gate re-derives this at commit time; if it
// moved, the review is stale and the gate refuses. Fixing a finding changes the
// diff, so a fix REQUIRES a fresh review. That is the point, not a bug.
function diffHash(diff) {
  return crypto.createHash('sha256').update(diff).digest('hex').slice(0, 16);
}

// JSON.stringify, not a `|`-joined template: a problem string containing a pipe
// could otherwise collide with a different file/line/problem split. Flagged by the
// reviewer, then LAUNDERED when a re-run of the non-deterministic model dropped
// the finding. Fixed anyway; a finding does not stop being true because the next
// roll forgot it.
// Identity is file+line+problem, NOT symbol. The symbol is the model's verbatim
// copy and can vary run-to-run ("quote" vs "quote(y)"); folding it into the id would
// make a re-raise of the same finding hash differently -> the old one carried open by
// the anti-laundering merge PLUS a new duplicate, both blocking. So symbol is stored
// and refreshed (see mergeFindings), never part of identity.
function findingId(f) {
  return crypto.createHash('sha256')
    .update(JSON.stringify([f.file, f.line, f.problem]))
    .digest('hex').slice(0, 8);
}

// The ledger ACCUMULATES. It used to overwrite, which meant a re-run could DROP a
// previously-raised finding, because the model is non-deterministic. That is
// laundering: re-roll until the reviewer forgets, then commit clean. Observed for
// real on 2026-07-16, when a legitimate findingId collision flag vanished on a
// second run.
//
// So: merge by id. A finding already dispositioned KEEPS its disposition. A
// finding that was open and is absent from this run STAYS OPEN and still blocks.
// A finding does not stop being true because the next roll forgot it. The only
// exit is an explicit disposition with a reason (including "obsolete, code gone"),
// which a human can read.
function mergeFindings(prevDoc, rawFindings, hash, model, range) {
  const byId = new Map(((prevDoc && prevDoc.findings) || []).map(f => [f.id, f]));

  for (const f of rawFindings) {
    const id = findingId(f);
    const existing = byId.get(id);
    if (existing) {
      existing.lastSeen = hash;
      // RE-RAISED AFTER BEING MARKED FIXED -> back to open. The reviewer looking at
      // the CURRENT tree and still seeing the defect is evidence the fix was
      // incomplete or has regressed, and "fixed" would sail through the gate on the
      // strength of a claim the reviewer just contradicted.
      //
      // Only `fixed` is reset. `dismissed` is preserved: a dismissal means the
      // finding is not a real defect, so re-raising it says nothing new (the model is
      // non-deterministic and will re-report false positives forever). Resetting
      // dismissals would make a known-false finding block the gate on every roll.
      if (existing.status === 'fixed') {
        existing.status = 'open';
        existing.reason = null;
      }
      // Backfill a missing symbol so a finding first raised symbol-less (uncitable,
      // blocking) becomes citable once a later run supplies one. Never OVERWRITE an
      // existing symbol: identity is stable (findingId ignores symbol), so a changed
      // symbol on a known finding is noise, and clobbering could unpick a human's cite.
      if (!String(existing.symbol || '').trim() && f.symbol) existing.symbol = f.symbol;
      continue;
    }
    byId.set(id, {
      id,
      file: f.file || '?',
      line: f.line ?? null,
      symbol: f.symbol || '',
      severity: f.severity || '?',
      rule: f.rule || '?',
      problem: f.problem || '',
      fix: f.fix || '',
      status: 'open',
      reason: null,
      firstSeen: hash,
      lastSeen: hash,
    });
  }

  return {
    diffHash: hash,
    // The git range this review covered. The gate re-hashes THIS range, not a
    // hardcoded HEAD, so a review of a custom ref (e.g. origin/main) is not falsely
    // reported STALE. Default HEAD; carry a prior doc's range if this call omits one.
    range: range || (prevDoc && prevDoc.range) || 'HEAD',
    model,
    generatedAt: new Date().toISOString(),
    findings: [...byId.values()],
  };
}

function readFindings() {
  try { return JSON.parse(fs.readFileSync(FINDINGS_FILE, 'utf8')); }
  catch { return null; }
}

function writeFindings(diff, model, findings, range) {
  const hash = diffHash(diff);
  const doc = mergeFindings(readFindings(), findings, hash, model, range);
  fs.writeFileSync(FINDINGS_FILE, JSON.stringify(doc, null, 2));
  return doc;
}

// Key resolution, the model-fallback chain, and the REST call now live in
// gemini-call.js so the architect shares ONE implementation of them.
const { callGemini, loadKey, extractJson, MODELS } = require('./gemini-call.js');

// The audit rubric Gemini reviews against. Ported from the A1-A7 anti-tech-debt
// rules (CLAUDE.md) + basic correctness. This is the MECHANISM, not decoration -
// the reviewer's signal is only as good as these triggers.
const RUBRIC = `You are an INDEPENDENT, ADVISORY code reviewer. You do NOT approve, reject,
or run any gate. You FLAG. Review the unified diff below for defects.

You are given the FULL CURRENT TEXT of every touched file, followed by the diff.
Review the DIFF, but resolve every question against the FULL FILES.

Do NOT report a symbol as missing, undefined, unimplemented, or not-exported
merely because it does not appear in the diff. Unchanged code is absent from a
diff by definition; that is not evidence it does not exist. Search the full file
text first. If a file is marked TRUNCATED, say you cannot tell rather than
guessing. Absence of evidence is not evidence of absence, and a confident wrong
finding costs more than a missed one.

Priority checks (React + JS):
A1 mirror-state: useState(x)+useEffect(()=>setX(derived),[dep]): should be derived/memoized.
A2 stale-init: useState(maybeNull) where init is null on first render; later recomputes are lost.
A3 render-guard-vs-layoutEffect: conditional render hides an element a useLayoutEffect measures.
A4 wrong-deps: effect must run post-mount but deps fire pre-mount.
A5 inline-component: component defined inside another component's render body -> remount/identity loss.
A6 unstable-listener: addEventListener handler is a fresh closure each render -> leaked listeners.
A7 uncleaned-timer: setTimeout/setInterval in an effect with no clearTimeout/clearInterval cleanup.
Also: correctness bugs (off-by-one, wrong operator, null deref, bad boundary), and porting
mismatches (copied pattern whose precondition the new site does not preserve).

Output ONLY a JSON array, no prose, no markdown fences. Each finding:
{"file":"path","line":123,"symbol":"exact source substring","severity":"high|med|low","rule":"A3|correctness|...","problem":"one sentence","fix":"one sentence"}
"symbol" MUST be a short, VERBATIM substring copied from the current file text at the
problem site (a call, declaration, or expression, e.g. "urllib.request.quote" or
"useEffect(() => setX"). It is how a downstream tool locates and verifies your finding
by CONTENT, not by line number (line numbers drift). Copy it exactly, including case and
punctuation; do not paraphrase, summarize, or reconstruct it. A finding whose symbol is
not found verbatim in the file is auto-dismissed as unlocatable, so a wrong symbol is a
dropped finding. Empty array [] if nothing found. Do not invent issues to fill the array.`;

// Returns diff string, or null on failure (caller maps to exit 2).
// execFileSync (arg array, no shell) not execSync: `range` comes from argv, and a
// template-interpolated execSync would run a shell separator plus a second command.
function getDiff(range) {
  try {
    return execFileSync('git', ['diff', range], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  } catch (e) {
    console.error(`[gemini-review] git diff failed: ${e.message}`);
    return null;
  }
}

function touchedFiles(range) {
  try {
    return execFileSync('git', ['diff', range, '--name-only'], { encoding: 'utf8' })
      .split('\n').map(s => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// Budgets. Gemini's context is large but quota and latency are not free, and a
// giant prompt buys nothing once the reviewer has the file it needs.
const MAX_FILE_CHARS = 60000;
const MAX_TOTAL_CHARS = 200000;

// Assembles the FULL CURRENT TEXT of every touched file to sit alongside the diff.
//
// WHY: a diff-only reviewer is blind to everything it does not touch, and it does
// not know that it is blind. Three false positives in a row came from exactly this:
// it claimed parseFindings was "not defined" (it sits at line 132), and claimed a
// test would fail because findingId "was not updated" (it was, in an earlier
// commit). Both are in the file, neither is in the diff. So it reported absence of
// evidence as evidence of absence, twice, with high confidence.
//
// Pure on purpose: `read` is injected so this is testable without git or fs.
// Returns { text, included, skipped, truncated } so callers can report honestly
// when the context is PARTIAL rather than quietly reviewing on less than it says.
function buildFileContext(files, read, maxFile = MAX_FILE_CHARS, maxTotal = MAX_TOTAL_CHARS) {
  const parts = [];
  const included = [], skipped = [], truncated = [];
  let total = 0;

  for (const f of files) {
    const raw = read(f);
    if (raw === null || raw === undefined) { skipped.push(f); continue; } // deleted/unreadable
    if (raw.includes('\0')) { skipped.push(f); continue; }                // binary
    if (total >= maxTotal) { skipped.push(f); continue; }

    let body = raw;
    if (body.length > maxFile) {
      body = body.slice(0, maxFile) + '\n... [TRUNCATED, file longer than the per-file budget]';
      truncated.push(f);
    }
    if (total + body.length > maxTotal) {
      body = body.slice(0, Math.max(0, maxTotal - total)) + '\n... [TRUNCATED, total context budget reached]';
      if (!truncated.includes(f)) truncated.push(f);
    }
    parts.push(`--- ${f} ---\n${body}`);
    total += body.length;
    included.push(f);
  }

  return { text: parts.join('\n\n'), included, skipped, truncated };
}

// Gemini may wrap JSON in ```json fences or add stray prose. Extract the array.
const parseFindings = text => extractJson(text, 'array');

// Returns the exit code. We do NOT call process.exit() after a fetch: on Windows
// that races undici's still-closing keep-alive socket and trips a libuv assertion
// (exit 127, breaking the exit-code contract). Instead we return the code and let
// the event loop drain, setting process.exitCode below.
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const strict = args.includes('--strict');
  const range = args.find(a => !a.startsWith('--')) || 'HEAD';

  const diff = getDiff(range);
  if (diff === null) return 2;
  if (!diff.trim()) {
    console.log(`[gemini-review] empty diff for '${range}': nothing to review.`);
    return 0;
  }

  // Full text of every touched file, so the reviewer stops calling unchanged code
  // "missing" just because a diff does not repeat it.
  // `f` is repo-root-relative (from git diff --name-only). Resolve against REPO_ROOT,
  // not process.cwd(): run from a subdirectory, a cwd-relative read fails and the file
  // is silently skipped as "unreadable" -> the reviewer reviews on partial context.
  const ctx = buildFileContext(touchedFiles(range), f => {
    try { return fs.readFileSync(path.join(REPO_ROOT, f), 'utf8'); } catch { return null; }
  });

  const prompt =
    `${RUBRIC}\n\n=== FULL TEXT OF TOUCHED FILES ===\n${ctx.text}\n\n=== DIFF (${range}) ===\n${diff}`;

  // Report context honestly: a PARTIAL context means the reviewer is still partly
  // blind, and that must be visible rather than implied by silence.
  const ctxNote = `${ctx.included.length} file(s) in context` +
    (ctx.truncated.length ? `, ${ctx.truncated.length} TRUNCATED (${ctx.truncated.join(', ')})` : '') +
    (ctx.skipped.length ? `, ${ctx.skipped.length} skipped/deleted (${ctx.skipped.join(', ')})` : '');

  if (dryRun) {
    console.log(`[gemini-review] DRY RUN: models=[${MODELS.join(', ')}], range=${range}, diff bytes=${diff.length}`);
    console.log(`[gemini-review] context: ${ctxNote}`);
    console.log(`[gemini-review] prompt chars=${prompt.length}`);
    console.log('[gemini-review] (no API call made)');
    return 0;
  }

  const call = await callGemini(prompt, { tag: 'gemini-review' });
  if (!call.ok) {
    console.error(`[gemini-review] ${call.why}: review DID NOT RUN (exit 2, not a clean pass).`);
    return 2;
  }
  const { text, model: usedModel } = call;

  let findings;
  try {
    findings = parseFindings(text);
  } catch (e) {
    console.error(`[gemini-review] could not parse findings: ${e.message}: DID NOT RUN cleanly (exit 2).`);
    console.error(text.slice(0, 500));
    return 2;
  }

  const doc = writeFindings(diff, usedModel, findings, range);

  const open = doc.findings.filter(f => f.status === 'open');

  console.log(`\n[gemini-review] ADVISORY: ${usedModel}. Its OPINION does not gate; a human + \`npm run verify\` decide.`);
  console.log(`[gemini-review] context: ${ctxNote}`);
  console.log(`[gemini-review] But every finding must be DISPOSITIONED before commit. Silence is not an option.\n`);
  if (open.length === 0) {
    console.log(`  Nothing open. (${findings.length} raised this run, all already dispositioned.)`);
    console.log(`  ledger: ${path.basename(FINDINGS_FILE)} (diff ${doc.diffHash})`);
    return 0;
  }
  for (const f of open) {
    // Carried = raised by an EARLIER run and not re-raised by this one. Kept open
    // on purpose: the model forgetting a finding is not the finding being wrong.
    const carried = f.lastSeen !== doc.diffHash ? '  (CARRIED from an earlier review, not re-raised this run)' : '';
    console.log(`  [${f.id}] ${f.file}:${f.line ?? '?'}  [${f.severity}/${f.rule}]  ${f.problem}${carried}`);
    if (f.fix) console.log(`         fix: ${f.fix}`);
  }
  console.log(`\n  ${open.length} finding(s) OPEN in ${path.basename(FINDINGS_FILE)} (diff ${doc.diffHash}).`);
  console.log('  Get the ARCHITECT to rule on each before committing (you argue, it decides):');
  console.log('    node scripts/review-disposition.js <id> "why you believe this is not a defect"');
  return strict ? 1 : 0;
}

// Only run as a CLI. Without this guard, `require()`ing this file from a test
// fires a live API call as a side effect.
if (require.main === module) {
  main().then(code => { process.exitCode = code; })
        .catch(e => { console.error(`[gemini-review] fatal: ${e.message}`); process.exitCode = 2; });
}

module.exports = {
  parseFindings, diffHash, findingId, mergeFindings, writeFindings,
  buildFileContext, loadKey, FINDINGS_FILE,
};
