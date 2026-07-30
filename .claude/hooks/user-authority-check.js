'use strict';
/*
 * user-authority-check.js: the COMMIT-side half of the user-authority gate.
 *
 * The PreToolUse guard (user-authority-gate.js) sees only the tools it is registered
 * for, and that is a real hole: on 2026-07-16 a PowerShell call walked straight
 * through a Bash-only guard in this repo. git runs pre-commit itself no matter which
 * shell invoked git, so this is the fence and the guard is the early warning.
 *
 * Two deterministic checks against the STAGED diff:
 *   1. Added lines that touch a merge entry point AND name a user-owned field ->
 *      refuse unless the commit message carries an explicit human sign-off line.
 *   2. Scraper/capture files in the diff -> refuse unless an approved plan is on disk.
 *
 * WHY A SIGN-OFF LINE rather than reading the transcript: a git hook has no session
 * and cannot call user-grant.js, which needs the transcript to prove a human answered.
 * The trailer is weaker (Claude can type it) and is deliberately paired with the
 * PreToolUse guard, which CAN read the unforgeable grant. Stated plainly because a
 * gate whose weakness is hidden is worse than one without the gate.
 *
 * Exit 0 = allowed, 1 = refused.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const USER_OWNED = ['status', 'priority', 'tech', 'notes', 'schedule', 'tab', 'prevStatus'];
const AUTHORITY_SITES = /(?:^|\/)(src\/data\.js|src\/app\.jsx|src\/orders-logic\.js|main\.js|preload\.js)$/i;
const AUTHORITY_SYMBOLS = /\b(upsertOrders|applyCapture|composeNotes|hardcoded)\b/;

// ROUTING INTO A MERGE CHANNEL IS ITSELF A POLICY DECISION, and this is the check that
// would actually have caught the 2026-07-22 incident. The offending edit named no
// field at all; it was one line in main.js sending a captured record down
// 'extension-import'. That channel applies portal-wins merging, while applyCapture is
// fill-only, so the choice of channel decided that the portal could overwrite a
// user-set status.
//
// The first version of this gate matched only lines naming a user-owned field, and was
// tested against the SYMPTOM (the merge line in data.js) rather than against the real
// edit. It passed its own tests and would have let the incident through.
const MERGE_CHANNELS = /'(extension-import|capture-wo|capture-wos|capture-all-amh)'|"(extension-import|capture-wo|capture-wos|capture-all-amh)"/;
const SCRAPER_SITES = /(?:^|\/)(extension\/content\.js|extension\/background\.js|scrape_amh\.py|amh-runner\.js|parse_amh_remittance\.py|parse_msr_remittance\.py|remittance-runner\.js)$/i;
const SIGNOFF = /^\s*User-Authority-Approved:\s*\S+/mi;

const REPO = process.cwd();
const git = (args) => {
  try { return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }); }
  catch { return ''; }
};

function stagedFiles() {
  return git(['diff', '--cached', '--name-only']).split('\n').map(s => s.trim()).filter(Boolean);
}

// Only ADDED lines. A diff that merely moves existing code past these symbols is not
// changing policy, and flagging it would train people to ignore this gate.
function addedLines(file) {
  return git(['diff', '--cached', '-U0', '--', file])
    .split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
}

function commitMessage() {
  // pre-commit runs before the message is final, but git has written it to
  // COMMIT_EDITMSG by the time -m or -F content is known.
  for (const p of ['.git/COMMIT_EDITMSG']) {
    try { return fs.readFileSync(path.join(REPO, p), 'utf8'); } catch { /* next */ }
  }
  return '';
}

function approvedPlan() {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(REPO, '.plan.json'), 'utf8'));
    return p && p.status === 'approved' ? p : null;
  } catch { return null; }
}

function main() {
  const files = stagedFiles();
  if (!files.length) return 0;

  const authorityHits = [];
  for (const f of files.filter(f => AUTHORITY_SITES.test(f))) {
    for (const line of addedLines(f)) {
      // Either shape counts: naming a user-owned field at a merge site, OR routing a
      // record into a merge channel at all.
      if (MERGE_CHANNELS.test(line)) {
        authorityHits.push({ file: f, fields: ['(merge channel)'], line: line.slice(1).trim().slice(0, 100) });
        continue;
      }
      if (!AUTHORITY_SYMBOLS.test(line)) continue;
      const fields = USER_OWNED.filter(u => new RegExp('\\b' + u + '\\b').test(line));
      if (fields.length) authorityHits.push({ file: f, fields, line: line.slice(1).trim().slice(0, 100) });
    }
  }

  if (authorityHits.length && !SIGNOFF.test(commitMessage())) {
    console.error('[user-authority] COMMIT REFUSED: this diff changes code that can overwrite a USER-OWNED field.');
    for (const h of authorityHits.slice(0, 6)) {
      console.error(`    ${h.file}  [${h.fields.join(', ')}]  ${h.line}`);
    }
    console.error('');
    console.error('  On 2026-07-22 this exact class of change replaced a real work order\'s user-set');
    console.error('  status "Bid Submitted - Return" with the portal\'s "UNSCHEDULED". Deciding which');
    console.error('  side wins a field is the architect\'s call with the human, never the coder\'s.');
    console.error('');
    console.error('  Ask the user with AskUserQuestion, get the architect to rule, then record it:');
    console.error('    User-Authority-Approved: <what the human agreed to>');
    console.error('  as a line in the commit message. Typing that line without having asked is');
    console.error('  forging a human decision, not a shortcut.');
    return 1;
  }

  const scraperFiles = files.filter(f => SCRAPER_SITES.test(f));
  if (scraperFiles.length && !approvedPlan()) {
    console.error('[user-authority] COMMIT REFUSED: scraper/capture changes need an APPROVED PLAN.');
    console.error('    ' + scraperFiles.join('\n    '));
    console.error('');
    console.error('  Ad-hoc mode is for small work. Capture is not small: wrong data, or none,');
    console.error('  costs the user working hours. Four capture defects shipped on 2026-07-22,');
    console.error('  every one silent.');
    console.error('');
    console.error('  node node_modules/project-overseer/scripts/architect.js plan "<goal>"');
    console.error('  node node_modules/project-overseer/scripts/plan-approve.js   (HUMAN approves)');
    return 1;
  }

  return 0;
}

if (require.main === module) process.exitCode = main();
module.exports = { AUTHORITY_SYMBOLS, MERGE_CHANNELS, AUTHORITY_SITES, SCRAPER_SITES, USER_OWNED };
