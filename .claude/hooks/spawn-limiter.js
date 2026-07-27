#!/usr/bin/env node
// spawn-limiter -- PreToolUse on the Agent tool. Project Overseer item 3.
//
// Enforces coder-spawn discipline (section 5): 1 coder spawn is free, the 2nd
// needs a human grant, the 3rd+ is a hard block -- a declared major system
// failure, no grant path. Read-only spawns (investigators / Explore / Plan)
// run unlimited and are neither counted nor limited.
//
// Counting is derived from transcript_path ALONE. The transcript lives at
//   .../projects/<key>/<sessionId>.jsonl
// and each subagent writes a meta at
//   .../projects/<key>/<sessionId>/subagents/agent-*.meta.json
// at spawn START. The CURRENT spawn's PreToolUse fires BEFORE its own meta
// exists, so a count of coder-typed metas is exactly the number of PRIOR coder
// spawns. n = priorCoders + 1.
//
// The 2nd-spawn grant is read structurally out of the transcript by
// user-grant.js -- the same forge-proof AskUserQuestion channel role-lock uses.
// Echoing the answer into Bash stdout will not honour it.
//
// Fails OPEN on any error. A broken limiter must never block all spawning.

const fs = require('fs');
const path = require('path');

// Write-capable subagent types, lowercased. Only these count and are limited.
const CODER_TYPES = new Set([
  'builder',
  'editor',
  'caveman:cavecrew-builder',
  'general-purpose',
  'claude',
]);

const question = 'Grant a second coder spawn this session?';

// Count PRIOR coder-typed subagent metas for this session. Any filesystem or
// parse problem yields 0 (fail OPEN: no provable count means no block).
function priorCoderCount(transcriptPath) {
  const dir = path.dirname(transcriptPath);
  const sessionId = path.basename(transcriptPath, '.jsonl');
  const subagents = path.join(dir, sessionId, 'subagents');
  let files;
  try { files = fs.readdirSync(subagents); } catch { return 0; }
  let n = 0;
  for (const f of files) {
    if (!/^agent-.*\.meta\.json$/.test(f)) continue;
    let meta;
    try { meta = JSON.parse(fs.readFileSync(path.join(subagents, f), 'utf8')); } catch { continue; }
    if (CODER_TYPES.has(String(meta.agentType || '').toLowerCase())) n++;
  }
  return n;
}

function main() {
  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { return; }

  if ((input.tool_name || '') !== 'Agent') return;

  // Only coder spawns are counted or limited. A read-only or missing type is free.
  const type = String((input.tool_input || {}).subagent_type || '').toLowerCase();
  if (!CODER_TYPES.has(type)) return;

  // No transcript_path -> no provable prior count -> fail OPEN (allow).
  const tp = input.transcript_path;
  if (!tp) return;

  const root = input.cwd || process.cwd();

  const n = priorCoderCount(tp) + 1;

  if (n === 1) return;

  if (n === 2) {
    // Grant machinery missing or broken -> fail OPEN.
    let lastUserGrant;
    try {
      ({ lastUserGrant } = require(path.join(root, 'node_modules', 'project-overseer', 'scripts', 'user-grant.js')));
    } catch { return; }

    let ans = null;
    try { ans = lastUserGrant(tp, question); } catch { ans = null; }
    if (typeof ans === 'string' && /^grant/i.test(ans.trim())) return;

    process.stderr.write(
      '[spawn-limiter] BLOCKED: this is coder spawn 2.\n' +
      '\n' +
      'Per section 5, a second coder spawn needs the roles revised and roughly\n' +
      'patch-level scope, AND the human\'s grant given through the AskUserQuestion\n' +
      'tool using this exact question text:\n' +
      '\n' +
      '  ' + question + '\n' +
      '\n' +
      'Answering it yourself in any way -- echoing it, writing it to a file,\n' +
      'narrating that the human agreed -- is forging a human decision. The grant\n' +
      'is read structurally from the human\'s own answer, so a forgery will not be\n' +
      'honoured; it is only a lie in the transcript.\n'
    );
    process.exit(2);
  }

  // n >= 3: no grant can open this.
  process.stderr.write(
    '[spawn-limiter] BLOCKED: coder spawn 3 is a declared major system failure.\n' +
    '\n' +
    'Stop. Report it, and re-examine the approach itself (rule C2) rather than\n' +
    'attempting a third pass. A grant cannot open this door, and a persisted\n' +
    'Grant from spawn 2 does not carry over.\n'
  );
  process.exit(2);
}

try { main(); } catch (e) {
  process.stderr.write('[spawn-limiter] guard error (failing OPEN): ' + e.message + '\n');
}
