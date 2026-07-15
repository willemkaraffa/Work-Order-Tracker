'use strict';
/*
 * gemini-review.js — external, advisory code reviewer running on gemini-2.5-flash.
 *
 * WHY external: Claude Code subagents are Claude-only (the `model:` field takes
 * sonnet/opus/haiku/fable). To run the reviewer OFF Claude — and off the 5-hour
 * subscription window — it must live outside the Task runtime as a plain REST call.
 *
 * SAFETY: advisory only. It NEVER flips the verify gate. The deterministic
 * `npm run verify` gate + a human are the only green light. Exit-code contract:
 *   0 = ran clean (no findings) OR ran with findings in default advisory mode
 *   1 = ran, found issues, AND --strict was passed (opt-in blocking for CI)
 *   2 = did NOT run (no key / API error / bad response). Loud, never silent —
 *       a skipped review must not read as a clean review (false confidence).
 *
 * USAGE:
 *   node scripts/gemini-review.js                 review `git diff HEAD` (working tree)
 *   node scripts/gemini-review.js origin/main     review diff vs a ref/range
 *   node scripts/gemini-review.js --dry-run       assemble + print the request, no API call
 *   node scripts/gemini-review.js --strict        exit 1 if findings (for optional CI gate)
 *
 * ENV: GEMINI_API_KEY (from Google AI Studio; keep the test project billing-OFF).
 */
const { execSync } = require('child_process');

const MODEL = 'gemini-2.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// The audit rubric Gemini reviews against. Ported from the A1-A7 anti-tech-debt
// rules (CLAUDE.md) + basic correctness. This is the MECHANISM, not decoration —
// the reviewer's signal is only as good as these triggers.
const RUBRIC = `You are an INDEPENDENT, ADVISORY code reviewer. You do NOT approve, reject,
or run any gate. You FLAG. Review the unified diff below for defects.

Priority checks (React + JS):
A1 mirror-state: useState(x)+useEffect(()=>setX(derived),[dep]) — should be derived/memoized.
A2 stale-init: useState(maybeNull) where init is null on first render; later recomputes are lost.
A3 render-guard-vs-layoutEffect: conditional render hides an element a useLayoutEffect measures.
A4 wrong-deps: effect must run post-mount but deps fire pre-mount.
A5 inline-component: component defined inside another component's render body -> remount/identity loss.
A6 unstable-listener: addEventListener handler is a fresh closure each render -> leaked listeners.
A7 uncleaned-timer: setTimeout/setInterval in an effect with no clearTimeout/clearInterval cleanup.
Also: correctness bugs (off-by-one, wrong operator, null deref, bad boundary), and porting
mismatches (copied pattern whose precondition the new site does not preserve).

Output ONLY a JSON array, no prose, no markdown fences. Each finding:
{"file":"path","line":123,"severity":"high|med|low","rule":"A3|correctness|...","problem":"one sentence","fix":"one sentence"}
Empty array [] if nothing found. Do not invent issues to fill the array.`;

function getDiff(range) {
  try {
    return execSync(`git diff ${range}`, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  } catch (e) {
    console.error(`[gemini-review] git diff failed: ${e.message}`);
    process.exit(2);
  }
}

// Gemini may wrap JSON in ```json fences or add stray prose. Extract the array.
function parseFindings(text) {
  const fenced = text.replace(/```(?:json)?/gi, '').trim();
  const start = fenced.indexOf('[');
  const end = fenced.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) throw new Error('no JSON array in response');
  return JSON.parse(fenced.slice(start, end + 1));
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const strict = args.includes('--strict');
  const range = args.find(a => !a.startsWith('--')) || 'HEAD';

  const diff = getDiff(range);
  if (!diff.trim()) {
    console.log(`[gemini-review] empty diff for '${range}' — nothing to review.`);
    process.exit(0);
  }

  const body = {
    contents: [{ parts: [{ text: `${RUBRIC}\n\n=== DIFF (${range}) ===\n${diff}` }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  };

  if (dryRun) {
    console.log(`[gemini-review] DRY RUN — model=${MODEL}, range=${range}, diff bytes=${diff.length}`);
    console.log(`[gemini-review] prompt chars=${body.contents[0].parts[0].text.length}`);
    console.log('[gemini-review] (no API call made)');
    process.exit(0);
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error('[gemini-review] GEMINI_API_KEY not set — review DID NOT RUN (exit 2, not a clean pass).');
    process.exit(2);
  }

  let data;
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`[gemini-review] API ${res.status} ${res.statusText} — review DID NOT RUN (exit 2).`);
      console.error((await res.text()).slice(0, 500));
      process.exit(2);
    }
    data = await res.json();
  } catch (e) {
    console.error(`[gemini-review] network/API error: ${e.message} — review DID NOT RUN (exit 2).`);
    process.exit(2);
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    console.error('[gemini-review] empty/blocked response — review DID NOT RUN (exit 2).');
    process.exit(2);
  }

  let findings;
  try {
    findings = parseFindings(text);
  } catch (e) {
    console.error(`[gemini-review] could not parse findings: ${e.message} — DID NOT RUN cleanly (exit 2).`);
    console.error(text.slice(0, 500));
    process.exit(2);
  }

  console.log(`\n[gemini-review] ADVISORY — ${MODEL}. Does NOT gate. Human + \`npm run verify\` decide.\n`);
  if (findings.length === 0) {
    console.log('  No findings.');
    process.exit(0);
  }
  for (const f of findings) {
    console.log(`  ${f.file || '?'}:${f.line ?? '?'}  [${f.severity || '?'}/${f.rule || '?'}]  ${f.problem}`);
    if (f.fix) console.log(`      fix: ${f.fix}`);
  }
  console.log(`\n  ${findings.length} finding(s).`);
  process.exit(strict ? 1 : 0);
}

main();
