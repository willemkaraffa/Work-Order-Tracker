'use strict';
// scraper-data-gate: the ONE hook that stays in this app.
//
// The rest of the guards moved to the project-overseer package, because they are
// about the workflow and not about work orders. This one is about THIS app's
// scraper: it blocks editing extraction code until a real DOM dump has been read
// this session, so a selector is never rewritten from memory of a page nobody
// looked at.
//
// Split out of test/hooks.test.js during that extraction. The frame's hook tests
// live with the frame now; keeping a copy here would have been two suites drifting
// apart, and the app's suite would have been testing files it no longer owns.
//
// Exit codes: 0 pass / 1 fail (see test/run.js).
const assert = require('assert');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const DATAGATE = path.join(__dirname, '..', '.claude', 'hooks', 'scraper-data-gate.js');

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

console.log(failed ? `\n${failed} failed` : '\nall scraper-data-gate tests pass');
process.exit(failed ? 1 : 0);
