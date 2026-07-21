// PostToolUse nudge (Bash + PowerShell): enforces the VERIFY BUDGET (CLAUDE.md /
// feedback_verify_budget) that every other rule got teeth for but this one never
// did. Bad verification "ate half a session twice"; it did so AGAIN this session.
// Advisory failed, so this makes over-verifying COST something.
//
// WHY A NUDGE, NOT A BLOCK: the sanctioned gate (npm run verify) MUST stay runnable
// before a commit -- a PreToolUse block on gate-reruns could brick the one verify a
// commit needs. And a Stop/PreToolUse systemMessage is invisible to Claude
// (lesson_hook_channels). A PostToolUse `additionalContext` is the one channel that
// is BOTH non-blocking AND visible to Claude. So: count heavy-verify runs, and past
// the budget inject a message Claude reads on its next turn. It cannot force a stop;
// it makes the over-run visible the moment it happens, which a reminder never did.
//
// HEAVY VERIFY ONLY: the full gate / test suite (npm run verify|test|build, node
// test/run.js, node test/*.test.js). A single targeted script run is cheap and not
// counted -- the thrash guard already caps repeated scratch runs. This targets the
// expensive belt-and-suspenders reruns, not normal iteration.
//
// Fails OPEN on any error: a broken nudge must never wedge the session.

const fs = require('fs');
const path = require('path');
const os = require('os');

const WINDOW_MS = 15 * 60 * 1000; // count heavy-verify runs within the last 15 min
const BUDGET = 2;                 // rule: ~2 verify calls unless a NAMED risk; nudge past it

// Heavy-verify signatures: the full gate and the test suite, any spelling.
const HEAVY = [
  /\bnpm\s+run\s+verify\b/i,
  /\bnpm\s+(run\s+build[\w:-]*|test)\b/i,
  /(?:^|\s)(?:node|npx)\s+(?:[^\s]*[\\/])?(?:run\.js|[\w.-]+\.test\.js)\b/i,
];

function main() {
  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { return; }
  if (input.hook_event_name && input.hook_event_name !== 'PostToolUse') return;

  const tool = input.tool_name || '';
  if (tool !== 'Bash' && tool !== 'PowerShell') return;

  const cmd = (input.tool_input && input.tool_input.command) || '';
  if (!cmd || !HEAVY.some(re => re.test(cmd))) return; // not a heavy-verify run

  const session = String(input.session_id || 'nosession').replace(/[^\w.-]/g, '_');
  const stateFile = path.join(os.tmpdir(), `wot-verifybudget-${session}.json`);

  let hits = [];
  try { hits = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
  if (!Array.isArray(hits)) hits = []; // a corrupt file that parses to null/non-array must not throw
  const now = Date.now();
  hits = hits.filter(ts => now - ts < WINDOW_MS);
  hits.push(now);
  try { fs.writeFileSync(stateFile, JSON.stringify(hits)); } catch {}

  // Second, INDEPENDENT tally: a monotonic count for the PLAN, which is what
  // overseer-status reports. It is deliberately not the same number as `hits`. The
  // bucket above is a 15-minute sliding window keyed by session, so it forgets, and
  // it splits across sessions; verifyBudget is a total for the whole plan. Reporting
  // spend off the session bucket would have shown a figure that shrinks while you
  // watch it and resets whenever the session does.
  //
  // Never affects the nudge below: this hook must keep behaving identically whether
  // or not a plan exists, and a reporting counter must not be able to block anything.
  try {
    const lib = require('../../scripts/plan.js');
    const tallyFile = lib.verifyTallyFile(lib.readPlan());
    let runs = 0;
    try { runs = JSON.parse(fs.readFileSync(tallyFile, 'utf8')).runs || 0; } catch {}
    if (!Number.isFinite(runs) || runs < 0) runs = 0; // a corrupt file must not poison the count
    // Write-then-rename, not a bare write. A hook is killed whenever its tool call is
    // interrupted, and a torn write here leaves unparseable JSON, which the reader
    // above silently treats as runs=0: the plan's whole spend history would vanish
    // and the report would say the budget was untouched. Rename is atomic on both
    // NTFS and POSIX when source and target share a directory, which they do.
    const tmp = `${tallyFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ runs: runs + 1, last: now }));
    fs.renameSync(tmp, tallyFile);
  } catch { /* reporting only: never let it break the nudge */ }

  if (hits.length > BUDGET) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext:
          `[verify-budget] You have run the FULL GATE / test suite ${hits.length} times in 15 min ` +
          `(budget is ${BUDGET}). Rule: verify PROPORTIONAL to risk; bad verification has eaten half a ` +
          `session twice. A green gate does not need re-proving; belt-and-suspenders after green is waste. ` +
          `STOP re-running it unless a NAMED, new risk justifies one more. If the gate already passed, you ` +
          `are done -- report and move on.`,
      },
    }));
  }
}

try { main(); } catch { /* fail open */ }
