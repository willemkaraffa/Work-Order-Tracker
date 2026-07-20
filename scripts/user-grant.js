'use strict';
/*
 * user-grant.js: read a HUMAN's answer to an AskUserQuestion out of the session
 * transcript. The only channel in this system that Claude provably cannot forge.
 *
 * EXTRACTED from length-check.js (the verbose-permission gate), which proved the
 * mechanism first. Plan approval needs exactly the same guarantee, so it reuses
 * this rather than growing a second, subtly-different reader (rule B3).
 *
 * FORGE NOTE, the whole reason this is not a grep. The obvious implementation is
 * to search the transcript for the answer text in a `role: user` entry. That is
 * NOT safe: every TOOL RESULT is also a user-role entry, and a Bash result's
 * stdout is whatever Claude told the command to print. `echo` would forge a grant.
 * Confirmed in a live transcript on 2026-07-20, where the same phrase appeared in
 * both AskUserQuestion and Bash results.
 *
 * So a grant is read STRUCTURALLY, from two things only the harness writes:
 *   1. `entry.toolUseResult.answers`, a {question: answer} map. A Bash result has
 *      {stdout, stderr} and no `answers` key at all.
 *   2. The entry's tool_result.tool_use_id resolving to a tool_use block whose
 *      name is AskUserQuestion. A Bash result cannot carry such an id.
 * Claude emits the question; only the human answers it.
 */
const fs = require('fs');

// Returns the LAST answer the human gave to `question`, or null if never asked.
// Last wins, so a later answer revokes an earlier one.
function lastUserGrant(transcriptPath, question) {
  let lines;
  try {
    lines = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);
  } catch { return null; }

  const askIds = new Set();
  const events = [];
  for (const line of lines) {
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    events.push(ev);
    const content = ev.message && ev.message.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b && b.type === 'tool_use' && b.name === 'AskUserQuestion') askIds.add(b.id);
    }
  }

  let answer = null;
  for (const ev of events) {
    const role = (ev.message && ev.message.role) || ev.type;
    if (role !== 'user') continue;
    const answers = ev.toolUseResult && ev.toolUseResult.answers;
    if (!answers || typeof answers !== 'object') continue;

    // Must have come from an AskUserQuestion call, not from any other tool.
    const content = ev.message && ev.message.content;
    const ids = Array.isArray(content)
      ? content.filter(b => b && b.type === 'tool_result').map(b => b.tool_use_id)
      : [];
    if (!ids.some(id => askIds.has(id))) continue;

    if (!Object.prototype.hasOwnProperty.call(answers, question)) continue;
    answer = answers[question];
  }
  return answer;
}

module.exports = { lastUserGrant };
