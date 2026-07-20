'use strict';
// Covers the three enforcement HOOKS that had no test: the verify-thrash guard,
// the scraper data-gate, and the caveman/style length-check. The review gate was
// already tested (review-gate.test.js); these three were the audit's blind spot.
//
// BLACK-BOX ON PURPOSE. These hooks read a JSON tool-call on stdin and act by exit
// code / stdout, with main() firing at module load -- they export nothing pure to
// import. So the test spawns the ACTUAL shipped hook file and feeds it stdin,
// exactly how Claude Code invokes it. That tests the real mechanism (not a
// hand-copy, the false-green this repo already got bitten by) with no refactor of
// a working hook. Exit codes: 0 pass / 1 fail / 2 skip (see test/run.js).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOKS = path.join(__dirname, '..', '.claude', 'hooks');
const THRASH = path.join(HOOKS, 'verify-thrash-guard.js');
const DATAGATE = path.join(HOOKS, 'scraper-data-gate.js');
const LENGTH = path.join(HOOKS, 'length-check.js');
const BUDGET = path.join(HOOKS, 'verify-budget-guard.js');

let failed = 0;
function t(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}: ${e.message}`); }
}

// Run a hook with a stdin payload. Returns { status, stdout, stderr }.
function run(hook, input) {
  const r = spawnSync(process.execPath, [hook], { input: JSON.stringify(input), encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// A unique session id per test so state files in tmpdir never cross-contaminate.
let seq = 0;
const sid = () => `test-${process.pid}-${Date.now()}-${seq++}`;

// ============================================================================
// verify-thrash-guard: BLOCKS the 3rd run of the SAME ad-hoc script in 10 min,
// but never counts the sanctioned gate, git, or the Overseer's own tools.
// ============================================================================
const bash = (session, command) => run(THRASH, { tool_name: 'Bash', session_id: session, tool_input: { command } });
const pwsh = (session, command) => run(THRASH, { tool_name: 'PowerShell', session_id: session, tool_input: { command } });

t('thrash: a non-shell tool is ignored', () => {
  const r = run(THRASH, { tool_name: 'Read', session_id: sid(), tool_input: { file_path: 'x' } });
  assert.strictEqual(r.status, 0);
});

t('thrash: a command with no script target is ignored', () => {
  const r = bash(sid(), 'echo hello');
  assert.strictEqual(r.status, 0);
});

t('thrash: an ad-hoc scratch script BLOCKS on the 3rd run', () => {
  const s = sid();
  assert.strictEqual(bash(s, 'node scratch/probe.js').status, 0);
  assert.strictEqual(bash(s, 'node scratch/probe.js').status, 0);
  const third = bash(s, 'node scratch/probe.js');
  assert.strictEqual(third.status, 2, '3rd run must block');
  assert.match(third.stderr, /BLOCKED/);
});

t('thrash: basename collapses different cwd spellings of the same script', () => {
  const s = sid();
  assert.strictEqual(bash(s, 'node scripts/foo.js').status, 0);
  assert.strictEqual(bash(s, 'node ./foo.js').status, 0);
  assert.strictEqual(bash(s, 'node ../x/foo.js').status, 2, 'same basename -> 3rd blocks');
});

t('thrash: PowerShell shell is guarded too (not just Bash)', () => {
  const s = sid();
  assert.strictEqual(pwsh(s, 'python probe.py').status, 0);
  assert.strictEqual(pwsh(s, 'python probe.py').status, 0);
  assert.strictEqual(pwsh(s, 'python probe.py').status, 2);
});

t('thrash: two different scripts each get their own count (no cross-block)', () => {
  const s = sid();
  bash(s, 'node a.js'); bash(s, 'node a.js');
  const b = bash(s, 'node b.js'); // b's first run, must NOT block on a's count
  assert.strictEqual(b.status, 0);
});

// --- the FIX under audit: sanctioned tools are re-run BY DESIGN, never counted ---
t('thrash: npm run verify is never counted (runs freely)', () => {
  const s = sid();
  for (let i = 0; i < 4; i++) assert.strictEqual(bash(s, 'npm run verify').status, 0);
});

t('thrash: git is never counted', () => {
  const s = sid();
  for (let i = 0; i < 4; i++) assert.strictEqual(bash(s, 'git diff HEAD').status, 0);
});

for (const tool of ['gemini-review.js', 'review-gate.js', 'review-disposition.js', 'cite.js', 'run.js']) {
  t(`thrash: sanctioned ${tool} runs freely past the limit (review loop must not self-block)`, () => {
    const s = sid();
    for (let i = 0; i < 4; i++) {
      assert.strictEqual(bash(s, `node scripts/${tool}`).status, 0, `${tool} run ${i + 1} must not block`);
    }
  });
}

t('thrash: a sanctioned tool does not shield a scratch script in the same session', () => {
  const s = sid();
  bash(s, 'node scripts/cite.js');       // sanctioned, uncounted
  bash(s, 'node scratch/harness.js');    // 1
  bash(s, 'node scratch/harness.js');    // 2
  assert.strictEqual(bash(s, 'node scratch/harness.js').status, 2, 'scratch still blocks on its own 3rd');
});

// --- a run that never EXECUTED is not an attempt (false positive, 2026-07-20) ---
// A file with a syntax error crashed twice, and the 3rd run -- the first that would
// have actually tested anything -- was blocked. Two crashes on an unparseable file
// are one broken file, not two failed verification attempts.
const postBash = (session, command, tool_response) =>
  run(THRASH, { hook_event_name: 'PostToolUse', tool_name: 'Bash', session_id: session, tool_input: { command }, tool_response });

t('thrash: a run that died on a SyntaxError is not counted', () => {
  const s = sid();
  bash(s, 'node test/broken.test.js');
  postBash(s, 'node test/broken.test.js', { stderr: 'SyntaxError: Identifier already declared' });
  bash(s, 'node test/broken.test.js');
  postBash(s, 'node test/broken.test.js', { stderr: 'SyntaxError: Identifier already declared' });
  // Both crashes un-counted, so a real run is still allowed.
  assert.strictEqual(bash(s, 'node test/broken.test.js').status, 0, 'crashes must not burn the budget');
});

t('thrash: a missing-module crash is not counted either', () => {
  const s = sid();
  bash(s, 'node scratch/x.js');
  postBash(s, 'node scratch/x.js', { stderr: "Error: Cannot find module 'foo'" });
  bash(s, 'node scratch/x.js');
  postBash(s, 'node scratch/x.js', { stderr: 'MODULE_NOT_FOUND' });
  assert.strictEqual(bash(s, 'node scratch/x.js').status, 0);
});

t('thrash: a RUNTIME failure IS a real attempt and stays counted', () => {
  // The guard exists for this case: the script ran, the approach failed, twice.
  const s = sid();
  bash(s, 'node scratch/probe.js');
  postBash(s, 'node scratch/probe.js', { stderr: 'AssertionError: expected 1 to equal 2' });
  bash(s, 'node scratch/probe.js');
  postBash(s, 'node scratch/probe.js', { stderr: 'AssertionError: expected 1 to equal 2' });
  assert.strictEqual(bash(s, 'node scratch/probe.js').status, 2, '3rd real attempt still blocks');
});

t('thrash: PostToolUse never blocks, whatever the output', () => {
  const s = sid();
  for (let i = 0; i < 5; i++) {
    assert.strictEqual(postBash(s, 'node scratch/y.js', { stderr: 'SyntaxError: x' }).status, 0);
  }
});

t('thrash: un-counting never underflows past an empty history', () => {
  const s = sid();
  // PostToolUse with no matching PreToolUse entry must not corrupt state or throw.
  postBash(s, 'node scratch/z.js', { stderr: 'SyntaxError: x' });
  assert.strictEqual(bash(s, 'node scratch/z.js').status, 0);
});

// ============================================================================
// scraper-data-gate: BLOCKS editing extraction code until a real DOM dump has
// been read this session. Fails open on anything unrelated.
// ============================================================================
const preEdit = (session, file_path) =>
  run(DATAGATE, { hook_event_name: 'PreToolUse', session_id: session, tool_input: { file_path } });
const postRead = (session, file_path) =>
  run(DATAGATE, { hook_event_name: 'PostToolUse', session_id: session, tool_input: { file_path } });

t('datagate: editing non-extraction code is free', () => {
  const r = preEdit(sid(), 'src/app.jsx');
  assert.strictEqual(r.status, 0);
});

t('datagate: editing extraction code with NO dump read this session BLOCKS', () => {
  const r = preEdit(sid(), 'scrape_amh.py');
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /BLOCKED/);
});

t('datagate: reading a real wo-dump then editing extraction code is ALLOWED', () => {
  const s = sid();
  const rec = postRead(s, path.join(os.tmpdir(), 'wo-dump-123.json'));
  assert.strictEqual(rec.status, 0);
  const edit = preEdit(s, 'scrape_amh.py');
  assert.strictEqual(edit.status, 0, 'a real dump is in the session -> allow');
});

t('datagate: a dump read in ONE session does not unlock ANOTHER session', () => {
  postRead(sid(), 'wo-dump-x.json');        // session A records
  const r = preEdit(sid(), 'scrape_amh.py'); // session B still blocked
  assert.strictEqual(r.status, 2);
});

t('datagate: content.js is recognized as extraction code', () => {
  const r = preEdit(sid(), 'content.js');
  assert.strictEqual(r.status, 2);
});

// ============================================================================
// length-check (Stop hook): BLOCKS a stop when the last assistant message breaks
// a mechanical style rule (over budget, em-dash, emoji). Reads a transcript file.
// ============================================================================
const EM_DASH = String.fromCharCode(0x2014); // build banned chars via code so the
const EMOJI = String.fromCodePoint(0x1F600); // test SOURCE stays clean (CLAUDE.md).

// Write a one-line transcript whose last assistant message is `text`; return path.
function transcript(text) {
  const p = path.join(os.tmpdir(), `wot-transcript-${process.pid}-${seq++}.jsonl`);
  const line = JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
  fs.writeFileSync(p, line + '\n');
  return p;
}
const stop = (text, extra = {}) =>
  run(LENGTH, { transcript_path: transcript(text), ...extra });
const blocked = (r) => r.stdout.includes('"decision":"block"');

t('length: a short clean reply does not block', () => {
  assert.strictEqual(blocked(stop('fix applied. gate green.')), false);
});

t('length: prose over the budget blocks', () => {
  const r = stop('x'.repeat(2300));
  assert.ok(blocked(r), 'over-budget prose must block');
  assert.match(r.stdout, /budget/);
});

t('length: an em-dash blocks', () => {
  assert.ok(blocked(stop(`done ${EM_DASH} gate green`)));
});

t('length: an emoji blocks', () => {
  assert.ok(blocked(stop(`done ${EMOJI}`)));
});

t('length: text inside a code fence is excluded from the budget', () => {
  const big = '```\n' + 'x'.repeat(3000) + '\n```\nshort tail';
  assert.strictEqual(blocked(stop(big)), false, 'fenced code must not count toward prose budget');
});

t('length: stop_hook_active suppresses re-blocking (loop guard)', () => {
  const r = stop('x'.repeat(3000), { stop_hook_active: true });
  assert.strictEqual(blocked(r), false, 'already inside a forced correction -> do not block again');
});

t('length: a missing transcript path fails open (no block, no crash)', () => {
  const r = run(LENGTH, { transcript_path: path.join(os.tmpdir(), 'does-not-exist-xyz.jsonl') });
  assert.strictEqual(blocked(r), false);
});

// --- the verbose-permission lift: the human, and ONLY the human, can lift the
// LENGTH budget by answering an AskUserQuestion. Every forge path must still block.
const GRANT_Q = 'Speak verbosely here?';

// Build a transcript: `grants` is a list of {answer, tool} entries replayed in order,
// followed by an assistant message `text`. tool defaults to AskUserQuestion (the real
// path); pass 'Bash' to simulate Claude printing the grant from shell output.
function transcriptWithGrants(grants, text, opts = {}) {
  const p = path.join(os.tmpdir(), `wot-transcript-${process.pid}-${seq++}.jsonl`);
  const lines = [];
  grants.forEach((g, i) => {
    const id = `toolu_${i}`;
    const tool = g.tool || 'AskUserQuestion';
    lines.push(JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_use', id, name: tool, input: {} }] },
    }));
    const entry = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'x' }] },
      toolUseResult: { questions: [], answers: { [GRANT_Q]: g.answer } },
    };
    if (opts.assistantRole) { entry.type = 'assistant'; entry.message.role = 'assistant'; }
    lines.push(JSON.stringify(entry));
  });
  lines.push(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } }));
  fs.writeFileSync(p, lines.join('\n') + '\n');
  return p;
}
const stopWithGrants = (grants, text, opts) =>
  run(LENGTH, { transcript_path: transcriptWithGrants(grants, text, opts) });

t('length: a human "Verbose ON" grant lifts the length budget', () => {
  const r = stopWithGrants([{ answer: 'Verbose ON' }], 'x'.repeat(5000));
  assert.strictEqual(blocked(r), false, 'granted verbose -> no length block');
});

t('length: FORGE -- the same grant carried by a Bash tool_result still blocks', () => {
  // Bash stdout is a user-role tool_result whose content Claude dictates. This is the
  // hole the original spec would have shipped; the grant must be tied to the
  // AskUserQuestion tool_use id, not merely to a user-role entry.
  const r = stopWithGrants([{ answer: 'Verbose ON', tool: 'Bash' }], 'x'.repeat(5000));
  assert.ok(blocked(r), 'a shell-authored grant must NOT lift the budget');
});

t('length: FORGE -- the grant in an ASSISTANT entry still blocks', () => {
  const r = stopWithGrants([{ answer: 'Verbose ON' }], 'x'.repeat(5000), { assistantRole: true });
  assert.ok(blocked(r), 'Claude-authored entries can never grant');
});

t('length: "Stay caveman" after an earlier grant revokes the lift', () => {
  const r = stopWithGrants([{ answer: 'Verbose ON' }, { answer: 'Stay caveman' }], 'x'.repeat(5000));
  assert.ok(blocked(r), 'last answer wins -> budget is back');
});

t('length: a re-grant after a revoke lifts again (last answer wins)', () => {
  const r = stopWithGrants(
    [{ answer: 'Verbose ON' }, { answer: 'Stay caveman' }, { answer: 'Verbose ON' }],
    'x'.repeat(5000));
  assert.strictEqual(blocked(r), false);
});

t('length: an em-dash blocks even under a verbose grant (glyph rule never lifts)', () => {
  const r = stopWithGrants([{ answer: 'Verbose ON' }], `done ${EM_DASH} gate green`);
  assert.ok(blocked(r), 'verbosity lifts LENGTH only');
});

t('length: an emoji blocks even under a verbose grant', () => {
  assert.ok(blocked(stopWithGrants([{ answer: 'Verbose ON' }], `done ${EMOJI}`)));
});

t('length: an answer to some OTHER question does not lift the budget', () => {
  const p = path.join(os.tmpdir(), `wot-transcript-${process.pid}-${seq++}.jsonl`);
  fs.writeFileSync(p, [
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a1', name: 'AskUserQuestion', input: {} }] } }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a1', content: 'x' }] }, toolUseResult: { answers: { 'Ship it?': 'Verbose ON' } } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'x'.repeat(5000) }] } }),
  ].join('\n') + '\n');
  assert.ok(blocked(run(LENGTH, { transcript_path: p })), 'only the grant question counts');
});

// ============================================================================
// verify-budget-guard (PostToolUse nudge): past ~2 heavy-verify runs per window,
// injects a VISIBLE additionalContext message. Never blocks (exit 0 always).
// ============================================================================
const verifyRun = (session, command) =>
  run(BUDGET, { hook_event_name: 'PostToolUse', tool_name: 'Bash', session_id: session, tool_input: { command } });
const nudged = (r) => r.stdout.includes('verify-budget');

t('budget: never blocks (exit 0) even when nudging', () => {
  const s = sid();
  verifyRun(s, 'npm run verify'); verifyRun(s, 'npm run verify');
  const third = verifyRun(s, 'npm run verify');
  assert.strictEqual(third.status, 0, 'a nudge hook must never block');
});

t('budget: a non-verify command is not counted and never nudges', () => {
  const s = sid();
  for (let i = 0; i < 5; i++) assert.strictEqual(nudged(verifyRun(s, 'echo hi')), false);
});

t('budget: first two heavy-verify runs pass quietly, the 3rd nudges', () => {
  const s = sid();
  assert.strictEqual(nudged(verifyRun(s, 'npm run verify')), false);
  assert.strictEqual(nudged(verifyRun(s, 'npm test')), false);
  assert.ok(nudged(verifyRun(s, 'node test/run.js')), '3rd heavy-verify must nudge');
});

t('budget: a .test.js run counts as heavy verify', () => {
  const s = sid();
  verifyRun(s, 'node test/hooks.test.js'); verifyRun(s, 'node test/hooks.test.js');
  assert.ok(nudged(verifyRun(s, 'node test/hooks.test.js')));
});

t('budget: the nudge is visible via PostToolUse additionalContext', () => {
  const s = sid();
  verifyRun(s, 'npm run verify'); verifyRun(s, 'npm run verify');
  const r = verifyRun(s, 'npm run verify');
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(out.hookSpecificOutput.additionalContext, /PROPORTIONAL to risk/);
});

t('budget: counts are per-session (one session does not nudge another)', () => {
  verifyRun(sid(), 'npm run verify'); // isolated
  const r = verifyRun(sid(), 'npm run verify');
  assert.strictEqual(nudged(r), false);
});

console.log(failed ? `\n${failed} failed` : '\nall hook tests pass');
process.exit(failed ? 1 : 0);
