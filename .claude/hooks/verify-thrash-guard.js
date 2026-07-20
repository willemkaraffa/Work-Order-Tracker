// PreToolUse guard (Bash + PowerShell): BLOCKS thrash-retrying the same ad-hoc
// script. Enforces rule C2 ("2 failed attempts -> re-examine the approach, not a 3rd
// fix") as a non-bypassable gate instead of trusting Claude to self-limit -- which
// drifts (see feedback_verify_budget: bad verification ate half a session twice).
//
// WHY REPETITION, NOT FAILURE: the PostToolUse tool_response for Bash exposes NO exit
// code (keys: stdout, stderr, interrupted, ...), verified by probe -- a failing `false`
// is indistinguishable from success. So failure cannot be detected. Repetition can: a
// scratch harness or probe re-run 3+ times IS the waste pattern, pass or fail.
//
// SCOPE: counts only AD-HOC script runs (node X.js / python X.py and the like). The
// sanctioned gate (npm run verify / npm test / npm run build) and git are whitelisted
// and run freely -- re-running the real test suite is not thrash.
//
// Fails OPEN on any error: a broken guard must never brick the session.

const fs = require('fs');
const path = require('path');
const os = require('os');

const WINDOW_MS = 10 * 60 * 1000; // only count runs within the last 10 min (thrash is bursty)
const LIMIT = 2;                  // allow 2 runs of a script; BLOCK the 3rd (C2)

// RETIREMENT WITH TEETH. This guard is rule G1 in the registry. If the accumulated
// evidence retires it (enough architect-labelled false positives at poor
// precision), it stops firing. Without this check, "retired" would be a word in a
// JSON file while the rule kept blocking forever, which is how a rule registry
// decays into the reminder pile nobody reads.
//
// isRuleActive fails ACTIVE: a missing or corrupt registry leaves the guard on. A
// registry problem must never be a silent way to switch off every gate at once.
function ruleRetired() {
  try {
    return !require('../../scripts/rule-registry.js').isRuleActive('G1');
  } catch { return false; } // cannot tell -> keep guarding
}

function main() {
  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { return; }

  const tool = input.tool_name || '';
  if (tool !== 'Bash' && tool !== 'PowerShell') return; // guard BOTH shells (coverage-hole lesson)
  if (ruleRetired()) return;                            // evidence retired this rule

  const cmd = (input.tool_input && input.tool_input.command) || '';
  if (!cmd) return;

  // Whitelist: sanctioned gate + vcs run freely, never counted.
  if (/\bnpm (run (verify|build[\w:-]*|watch[\w:-]*)|test|ci)\b/.test(cmd)) return;
  if (/^\s*git\b/.test(cmd)) return;

  // The Overseer's OWN tools are re-run BY DESIGN, not thrash. The review gate forces a
  // FRESH gemini-review after every fix (staleness is deliberate: a fix changes the diff),
  // and cite/disposition run once PER finding. Counting them turns the sanctioned review
  // loop into a self-block -- proven: fixing 3 findings one-by-one trips this on the 3rd
  // reviewer run. The test runner is re-run freely too (npm test is whitelisted above;
  // this covers the bare `node test/run.js` spelling). These are not ad-hoc scratch.
  // architect.js rules on findings ONE AT A TIME (review-disposition.js shells out to
  // it), so an N-finding review means N architect runs. Counting it would self-block
  // the very loop this project requires -- the same bug this guard already shipped
  // once against gemini-review.js.
  const SANCTIONED = new Set([
    'gemini-review.js', 'review-gate.js', 'review-disposition.js', 'cite.js', 'run.js',
    'architect.js',
    // Plan tools run once PER FILE or PER STEP, so a plan touching 3+ files would
    // otherwise trip this on its own governance calls.
    'plan-rule.js', 'plan-approve.js', 'plan-step.js', 'plan-check.js',
    'rule-label.js',
  ]);

  // Ad-hoc script targets: node/python invoking a concrete .js/.mjs/.cjs/.py file.
  // Match the file token, take its basename so different cwd spellings collapse.
  const targets = new Set();
  const re = /(?:^|\s)(?:node|python3?|py|deno|bun|ts-node|tsx)\s+(?:[^\s]*[\\/])?([\w.-]+\.(?:m?js|cjs|py|ts))\b/gi;
  let m;
  while ((m = re.exec(cmd))) {
    const base = m[1].toLowerCase();
    if (!SANCTIONED.has(base)) targets.add(base); // sanctioned tools bypass the counter
  }
  if (!targets.size) return; // not an ad-hoc script run

  const session = String(input.session_id || 'nosession').replace(/[^\w.-]/g, '_');
  const stateFile = path.join(os.tmpdir(), `wot-thrash-${session}.json`);

  let state = {};
  try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
  if (!state || typeof state !== 'object') state = {}; // corrupt file (null/non-object) must not throw

  // A run that never EXECUTED is not an attempt. PostToolUse un-counts it.
  //
  // This closes a real false positive (observed 2026-07-20): a test file with a
  // syntax error was run, crashed on parse, re-run once to read the error, and the
  // 3rd invocation -- the first one that would have actually tested anything -- was
  // BLOCKED. Two crashes on a file that never parsed are one broken file, not two
  // failed verification attempts, which is what rule C2 is actually about.
  //
  // KNOWN LIMITS, stated rather than discovered later:
  //  - Detection is by node's crash signature in the output. The probed fact that
  //    Bash tool_response carries NO exit code still holds, so content is all there
  //    is. Python parse errors are NOT matched (different shape).
  //  - A script that legitimately prints these strings gets un-counted. That errs
  //    toward ALLOWING one more run, which is the safe direction for a guard: a
  //    wrongly-permitted run costs a few seconds, a wrongly-blocked one strands work.
  //  - Only ever removes ONE timestamp, and only the one this run just added.
  if (input.hook_event_name === 'PostToolUse') {
    const res = input.tool_response || {};
    const out = `${res.stderr || ''}\n${res.stdout || ''}`;
    // Parse/load failures only: the process died before running a single line.
    // A RUNTIME error (assertion, TypeError mid-test) IS a real attempt and stays counted.
    const neverRan = /\bSyntaxError\b/.test(out) ||
                     /Cannot find module|MODULE_NOT_FOUND/.test(out);
    if (neverRan) {
      for (const t of targets) {
        if (Array.isArray(state[t]) && state[t].length) state[t].pop();
      }
      try { fs.writeFileSync(stateFile, JSON.stringify(state)); } catch {}
    }
    return; // PostToolUse never blocks
  }

  const now = Date.now();
  let blockedTarget = null;
  for (const t of targets) {
    const hits = (state[t] || []).filter(ts => now - ts < WINDOW_MS);
    if (hits.length >= LIMIT) blockedTarget = t;   // already ran LIMIT times -> this is the 3rd
    hits.push(now);
    state[t] = hits;
  }

  try { fs.writeFileSync(stateFile, JSON.stringify(state)); } catch {}

  if (blockedTarget) {
    process.stderr.write(
      `[verify-thrash-guard] BLOCKED: '${blockedTarget}' has already run ${LIMIT}x in 10 min. ` +
      `Rule C2: two attempts on the same verification failed -> the APPROACH is wrong, not the code. ` +
      `Stop re-running it. Re-examine: is the harness wrong-fit (jsdom has no innerText, cannot open a ` +
      `bell-gated modal)? Is the risk even worth proving (a UI string needs a trace, not a live run)? ` +
      `Renaming or relocating the script to get a fresh count is TAMPERING with the gate, not a ` +
      `judgment call. If you believe the block is wrong, say so to the user and stop; do not route ` +
      `around it.`
    );
    process.exit(2); // exit 2 = PreToolUse BLOCK; stderr goes to Claude
  }
}

try { main(); } catch { /* fail open */ }
