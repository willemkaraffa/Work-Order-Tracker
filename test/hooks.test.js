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
// role-router: keeps reviewer/architect work OFF Claude subagents.
//
// The tool is `Agent` (verified against a real transcript), NOT `Task`. A guard
// written against Task would match nothing and look perfectly healthy.
// ============================================================================
const ROUTER = path.join(HOOKS, 'role-router.js');

// Isolate from the real rule registry so these never depend on live TP/FP counts.
// A registry with no G5 leaves it ACTIVE (unknown rule -> active), which is stable.
function registryWith(rules) {
  const p = path.join(os.tmpdir(), `wot-router-reg-${process.pid}-${seq++}.json`);
  fs.writeFileSync(p, JSON.stringify({ version: 1, rules }));
  return p;
}
const EMPTY_REG = registryWith([]);

const spawnAgent = (tool_input, registry = EMPTY_REG) => {
  const r = spawnSync(process.execPath, [ROUTER], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input }),
    encoding: 'utf8',
    env: { ...process.env, WOT_RULE_REGISTRY: registry },
  });
  return { status: r.status, stderr: r.stderr || '' };
};

t('router: a reviewer subagent is BLOCKED and redirected to gemini-review', () => {
  const r = spawnAgent({ subagent_type: 'reviewer', description: 'Review the fix', prompt: 'Review the uncommitted diff.' });
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /BLOCKED/);
  assert.match(r.stderr, /gemini-review\.js/, 'must name the tool that owns the work');
});

t('router: the cavecrew reviewer variant is caught too', () => {
  assert.strictEqual(spawnAgent({ subagent_type: 'caveman:cavecrew-reviewer', prompt: 'x' }).status, 2);
});

t('router: a review-shaped prompt under a GENERIC type is still caught', () => {
  // Type-only matching is trivially avoided by spawning general-purpose instead.
  const r = spawnAgent({ subagent_type: 'general-purpose', description: 'look at my work', prompt: 'Please review this diff and report defects.' });
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /request text/);
});

t('router: architect work is routed to architect.js', () => {
  const r = spawnAgent({ subagent_type: 'general-purpose', prompt: 'Triage the findings and decide which stand.' });
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /architect\.js/);
});

t('router: ordinary agent work passes untouched', () => {
  // The router must not become a tax on every subagent; only role signals bind.
  assert.strictEqual(spawnAgent({ subagent_type: 'Explore', prompt: 'Find where invoices are computed.' }).status, 0);
  assert.strictEqual(spawnAgent({ subagent_type: 'general-purpose', prompt: 'Rename a helper across two files.' }).status, 0);
});

t('router: a non-Agent tool is ignored', () => {
  const r = spawnSync(process.execPath, [ROUTER], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'review this diff' } }),
    encoding: 'utf8', env: { ...process.env, WOT_RULE_REGISTRY: EMPTY_REG },
  });
  assert.strictEqual(r.status, 0);
});

t('router: a RETIRED G5 stands down, like any other rule', () => {
  const retired = registryWith([{ id: 'G5', true_positive: 1, false_positive: 5 }]);
  assert.strictEqual(spawnAgent({ subagent_type: 'reviewer', prompt: 'x' }, retired).status, 0);
});

t('router: an unreadable registry keeps routing (fails toward enforcing)', () => {
  const missing = path.join(os.tmpdir(), 'no-such-registry-xyz.json');
  assert.strictEqual(spawnAgent({ subagent_type: 'reviewer', prompt: 'x' }, missing).status, 2);
});

t('router: malformed input fails OPEN (never bricks the session)', () => {
  const r = spawnSync(process.execPath, [ROUTER], { input: 'not json', encoding: 'utf8' });
  assert.strictEqual(r.status, 0);
});

// ============================================================================
// read-router: bulk reading goes to Gemini, targeted reading stays on Claude.
// The line is UNBOUNDED vs bounded, not big vs small, because a guard that fires
// on ordinary work gets resented and routed around.
// ============================================================================
const READR = path.join(HOOKS, 'read-router.js');

function bigFile(lines = 900) {
  const p = path.join(os.tmpdir(), `wot-big-${process.pid}-${seq++}.js`);
  fs.writeFileSync(p, 'x\n'.repeat(lines));
  return p;
}
function smallFile() {
  const p = path.join(os.tmpdir(), `wot-small-${process.pid}-${seq++}.js`);
  fs.writeFileSync(p, 'x\n'.repeat(20));
  return p;
}
const readCall = (tool_input, registry = EMPTY_REG) => {
  const r = spawnSync(process.execPath, [READR], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input }),
    encoding: 'utf8', env: { ...process.env, WOT_RULE_REGISTRY: registry },
  });
  return { status: r.status, stderr: r.stderr || '' };
};
const grepCall = (tool_input, registry = EMPTY_REG) => {
  const r = spawnSync(process.execPath, [READR], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Grep', tool_input }),
    encoding: 'utf8', env: { ...process.env, WOT_RULE_REGISTRY: registry },
  });
  return { status: r.status, stderr: r.stderr || '' };
};

t('read: an unbounded read of a BIG file is blocked and offered ask.js', () => {
  const r = readCall({ file_path: bigFile() });
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /ask\.js/);
});

t('read: a BOUNDED read of the same big file passes (the sanctioned way)', () => {
  // This is the escape the block names, so it must actually work at any size.
  assert.strictEqual(readCall({ file_path: bigFile(5000), offset: 100, limit: 40 }).status, 0);
});

t('read: a small file passes unbounded', () => {
  assert.strictEqual(readCall({ file_path: smallFile() }).status, 0);
});

t('read: a missing file is not this hook problem', () => {
  assert.strictEqual(readCall({ file_path: path.join(os.tmpdir(), 'nope-xyz.js') }).status, 0);
});

t('read: images and PDFs are exempt', () => {
  const p = bigFile(900).replace(/\.js$/, '.png');
  fs.writeFileSync(p, 'x\n'.repeat(900));
  assert.strictEqual(readCall({ file_path: p }).status, 0);
});

t('grep: an unbounded CONTENT sweep is blocked', () => {
  const r = grepCall({ pattern: 'foo', output_mode: 'content' });
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /head_limit/);
});

t('grep: any one bound clears it (head_limit, glob, type, or path)', () => {
  for (const bound of [{ head_limit: 50 }, { glob: '*.js' }, { type: 'js' }, { path: 'src' }]) {
    assert.strictEqual(grepCall({ pattern: 'foo', output_mode: 'content', ...bound }).status, 0,
      `${Object.keys(bound)[0]} must clear the block`);
  }
});

t('grep: the default files_with_matches mode is never blocked', () => {
  // CLAUDE.md says to grep for a fact. Locating files is the cheap path, not the
  // expensive one, and blocking it would push work back toward reading whole files.
  assert.strictEqual(grepCall({ pattern: 'foo' }).status, 0);
  assert.strictEqual(grepCall({ pattern: 'foo', output_mode: 'files_with_matches' }).status, 0);
});

const globCall = (tool_input, registry = EMPTY_REG) => {
  const r = spawnSync(process.execPath, [READR], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Glob', tool_input }),
    encoding: 'utf8', env: { ...process.env, WOT_RULE_REGISTRY: registry },
  });
  return { status: r.status, stderr: r.stderr || '' };
};

t('glob: a pattern with NO narrowing at all is blocked', () => {
  // These enumerate the repo. Paths not content, but the dump scales with matches.
  for (const pattern of ['**/*', '**', '*', '**/*.*']) {
    const r = globCall({ pattern });
    assert.strictEqual(r.status, 2, `'${pattern}' must be blocked`);
    assert.match(r.stderr, /Narrow it/);
  }
});

t('glob: any one narrowing clears it (path, extension, literal directory)', () => {
  // Mirrors the Grep bounds: ONE is enough. Two would fire on ordinary work.
  const ok = [
    { pattern: '**/*', path: 'src' },
    { pattern: '**/*.js' },
    { pattern: '**/*.{ts,tsx}' },
    { pattern: '*.js' },
    { pattern: 'src/**/*' },
    { pattern: 'src\\**\\*' }, // Windows separators still read as a real directory

    { pattern: 'scripts/**/*.test.js' },
  ];
  for (const ti of ok) {
    assert.strictEqual(globCall(ti).status, 0,
      `${JSON.stringify(ti)} is already narrow and must pass`);
  }
});

t('read-router: a RETIRED G6 stands down', () => {
  const retired = registryWith([{ id: 'G6', true_positive: 1, false_positive: 5 }]);
  assert.strictEqual(readCall({ file_path: bigFile() }, retired).status, 0);
  // Glob rides the SAME rule, so retiring G6 must stand it down too. A branch that
  // kept firing after its rule was retired would be unkillable by the registry.
  assert.strictEqual(globCall({ pattern: '**/*' }, retired).status, 0);
});

t('read-router: malformed input fails OPEN', () => {
  const r = spawnSync(process.execPath, [READR], { input: 'not json', encoding: 'utf8' });
  assert.strictEqual(r.status, 0);
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

// G4 was flagged NEEDS REDESIGN: detection right (precision 1.00), remedy harmful.
// A Stop hook cannot unsend what already streamed, so the remedy is whatever the
// reader sees NEXT. Demanding a full rewrite is proportionate when the LENGTH is the
// defect and absurd when one codepoint is, which reprints a correct reply to fix a
// character. Both cases were observed live 2026-07-21.
t('length: a glyph-only violation demands a DELTA, not a restatement', () => {
  const r = stop(`the reply was fine ${EM_DASH} except for this`);
  assert.ok(blocked(r), 'still blocks: the rule keeps its teeth');
  assert.match(r.stdout, /Do NOT restate/);
  assert.doesNotMatch(r.stdout, /Rewrite it now/);
});

t('length: an over-budget reply still demands a full rewrite', () => {
  const r = stop('x'.repeat(2300));
  assert.match(r.stdout, /Rewrite it now/);
  assert.doesNotMatch(r.stdout, /Do NOT restate/);
});

t('length: over-budget AND a glyph is a rewrite (length is the dominant defect)', () => {
  const r = stop('x'.repeat(2300) + ` tail ${EM_DASH} end`);
  assert.match(r.stdout, /Rewrite it now/);
  assert.match(r.stdout, /em-dash/, 'the glyph is still named in the reason');
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

t('length: under a lift, a long reply with a glyph is a DELTA, not a rewrite', () => {
  // The lift removes the LENGTH defect, so the glyph is the only one left and the
  // remedy must follow the surviving defect rather than the raw char count.
  const r = stopWithGrants([{ answer: 'Verbose ON' }], 'x'.repeat(2300) + ` ${EM_DASH} tail`);
  assert.ok(blocked(r), 'the glyph rule never lifts');
  assert.match(r.stdout, /Do NOT restate/);
  assert.doesNotMatch(r.stdout, /Rewrite it now/);
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
// EVERY budget-guard spawn gets a private tmpdir. The guard writes two files there,
// and one of them is the plan tally that overseer-status shows a human as project
// spend. Left on the machine's tmpdir, a single suite run added ~14 phantom
// heavy-verify runs to that report: the tests were being counted as the work.
// os.tmpdir() honours TEMP/TMP/TMPDIR, so redirecting the child is enough.
const SESSION_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wot-budget-test-'));
const budgetRun = (dir, session, command) => {
  const r = spawnSync(process.execPath, [BUDGET], {
    input: JSON.stringify({
      hook_event_name: 'PostToolUse', tool_name: 'Bash', session_id: session, tool_input: { command },
    }),
    encoding: 'utf8',
    env: { ...process.env, TEMP: dir, TMP: dir, TMPDIR: dir },
  });
  return { status: r.status, stdout: r.stdout || '' };
};
const verifyRun = (session, command) => budgetRun(SESSION_DIR, session, command);
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

// The plan-scoped tally that overseer-status reports. Separate from the session
// bucket above ON PURPOSE: that one is a 15-min sliding window per session, this one
// is a monotonic total per plan. Asserted as a DELTA, never an absolute, because the
// tally is shared with every other run on this machine.
// A SECOND private dir, separate from SESSION_DIR. The budget tests above already
// bumped the tally in theirs, so sharing one dir would make these start at a count
// that shifts whenever a test is added above.
//
// Each case still reads the tally BEFORE and AFTER and asserts the difference. The
// private dir makes the starting count stable, it does not make it 0: these cases run
// in sequence and each one leaves the tally where the next one finds it, so absolute
// assertions silently encoded the order of the tests above them.
const planLib = require('../scripts/plan.js');
const TALLY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wot-tally-test-'));
const tallyRun = (session, command) => budgetRun(TALLY_DIR, session, command);
const tallyRuns = () => {
  const f = path.join(TALLY_DIR, path.basename(planLib.verifyTallyFile(planLib.readPlan())));
  try { return JSON.parse(fs.readFileSync(f, 'utf8')).runs || 0; } catch { return 0; }
};

t('budget: a heavy-verify run increments the PLAN tally by exactly one', () => {
  const before = tallyRuns();
  tallyRun(sid(), 'npm run verify');
  assert.strictEqual(tallyRuns() - before, 1);
});

t('budget: the plan tally counts ACROSS sessions (the session bucket does not)', () => {
  // This is the whole reason the second counter exists: verifyBudget is a total for
  // the plan, shared by every session, so two fresh sessions must both land in it.
  const before = tallyRuns();
  tallyRun(sid(), 'npm run verify');
  tallyRun(sid(), 'npm run verify');
  assert.strictEqual(tallyRuns() - before, 2, 'two fresh sessions, same bucket');
});

t('budget: a non-verify command does not touch the plan tally', () => {
  const before = tallyRuns();
  tallyRun(sid(), 'git status');
  assert.strictEqual(tallyRuns() - before, 0);
});

console.log(failed ? `\n${failed} failed` : '\nall hook tests pass');
process.exit(failed ? 1 : 0);
