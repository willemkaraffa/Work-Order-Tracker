'use strict';
// user-authority-gate: vet against the ACTUAL 2026-07-22 edit, not the symptom.
//
// The incident: a captured AMH work order was routed into the 'extension-import'
// channel in main.js. That channel takes portal status for an active WO, while
// applyCapture is fill-only, so a real work order's user-set "Bid Submitted -
// Return" was silently replaced with the portal's "UNSCHEDULED". The offending edit
// named no user-owned field at all; the field was decided by the CHANNEL.
//
// The gate's first version matched only lines naming a user-owned field and was
// tested against the merge line in data.js, which is the symptom. It passed its own
// suite and would have let the real edit through. So this suite leads with the real
// edit and keeps the symptom as a secondary case.
//
// The last three tests record KNOWN GAPS as current behaviour rather than as
// aspirations. They assert status 0, which is what the gate does today. If someone
// closes a gap, the test fails loudly and gets flipped to 2, which is the point: a
// gap that is only described in a comment gets quietly forgotten.
//
// Exit codes: 0 pass / 1 fail (see test/run.js).
const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const GATE = path.join(__dirname, '..', '.claude', 'hooks', 'user-authority-gate.js');
const REPO = path.join(__dirname, '..');
const Q = String.fromCharCode(39);

function run(tool_input, tool_name) {
  const r = spawnSync(process.execPath, [GATE], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name, cwd: REPO, tool_input }),
    encoding: 'utf8',
  });
  return { status: r.status, stderr: r.stderr || '' };
}
const edit = (file_path, new_string) => run({ file_path, old_string: 'x', new_string }, 'Edit');
const write = (file_path, content) => run({ file_path, content }, 'Write');

let failed = 0;
function t(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}: ${e.message}`); }
}

// --- the real incident ---

t('authority: routing capture into extension-import in main.js is BLOCKED', () => {
  const r = edit('main.js', 'win.webContents.send(' + Q + 'extension-import' + Q + ', [wo]);');
  assert.strictEqual(r.status, 2, 'this is the exact 2026-07-22 edit');
  assert.match(r.stderr, /merge channel/);
});

t('authority: the double-quoted channel name is BLOCKED too', () => {
  assert.strictEqual(edit('main.js', 'win.webContents.send("extension-import", [wo]);').status, 2);
});

t('authority: the same routing through Write is BLOCKED', () => {
  assert.strictEqual(write('main.js', 'send(' + Q + 'extension-import' + Q + ', [wo]);').status, 2);
});

t('authority: the merge line itself (the symptom) is still BLOCKED', () => {
  const r = edit('src/data.js', 'status: hardcoded ? old.status : (inc.status || old.status),');
  assert.strictEqual(r.status, 2);
});

// --- it must not fire on ordinary work, or it gets routed around ---

t('authority: an unrelated main.js edit passes', () => {
  assert.strictEqual(edit('main.js', 'app.setName("Work Order Tracker");').status, 0);
});

t('authority: an unrelated app.jsx edit passes', () => {
  assert.strictEqual(edit('src/app.jsx', 'const [open, setOpen] = useState(false);').status, 0);
});

// --- KNOWN GAPS, asserted as they behave today ---

t('GAP: a channel routed through a variable is NOT caught', () => {
  // The match is textual. Nothing regex-shaped can see through indirection.
  const r = edit('main.js', 'const ch = CHANNELS.import; win.webContents.send(ch, [wo]);');
  assert.strictEqual(r.status, 0, 'known gap: literal channel names only');
});

t('GAP: the same routing edit in a file outside AUTHORITY_SITES is NOT caught', () => {
  // The gate tells the reader "Do NOT route around this by editing a different file.
  // The policy is the point, not the location." That instruction is honest about
  // intent and is not enforced: AUTHORITY_SITES is a whitelist of five filenames.
  const r = edit('src/capture.js', 'send(' + Q + 'extension-import' + Q + ', [wo]);');
  assert.strictEqual(r.status, 0, 'known gap: enforcement is per-location, the message is not');
});

console.log(failed ? `\n${failed} failed` : '\nall user-authority-gate tests pass');
process.exit(failed ? 1 : 0);
