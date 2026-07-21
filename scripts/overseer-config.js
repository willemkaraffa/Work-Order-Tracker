'use strict';
/*
 * overseer-config.js: the ONE place the frame asks the project what it is.
 *
 * WHY THIS EXISTS. Project Overseer is a general dev-workflow frame that happens to
 * live in an app repo. Two things in it were this app spelled out in the frame's own
 * source, so the frame only ever worked here:
 *   1. `.githooks/pre-commit` ran the literal `npm run verify`. A Python repo has no
 *      such command, and the gate would fail on every commit for the wrong reason.
 *   2. `gemini-review.js` hardcoded the A1-A7 React rules from this repo's CLAUDE.md.
 *      Pointed at a Go service, the reviewer would hunt for useEffect all day.
 * Both are now read from `overseer.json` at the repo root.
 *
 * DEFAULTS ARE THIS REPO'S ANSWERS, on purpose: an absent overseer.json must leave
 * behaviour exactly as it was, so adding the seam cannot itself change what the gate
 * does here. In a new repo you write the file; here you do not have to.
 *
 * NOT A FEATURE FLAG SYSTEM. Nothing here may switch a gate off. Every key names WHAT
 * to run or WHAT to review against, never WHETHER. A config Claude could edit to
 * disable a gate would not be a gate.
 */
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const CONFIG_FILE = path.join(REPO_ROOT, 'overseer.json');

const DEFAULTS = {
  verifyCommand: 'npm run verify',
  rubricFile: '.claude/rubric.md',
  // Guards the PROJECT owns, as [{ file, label }]. The frame reports its own guards
  // from its own list and must not know a given app has a scraper; this is where an
  // app says "I also expect this hook to be live".
  //
  // It stays an EXPECTATION rather than being read back from settings.json, because
  // the entire job of the status report is to catch a guard that is missing or
  // unregistered. A list derived from what IS registered can never report anything
  // absent: a deleted, unregistered hook would just quietly stop appearing.
  guards: [],
};

// A malformed overseer.json falls back to defaults rather than throwing: this loader
// sits under the commit gate, and a stray comma must not take the gate down. The
// caller that needs loudness (the rubric) gets it from rubric(), below.
function config() {
  let user = {};
  try { user = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { user = {}; }
  return { ...DEFAULTS, ...user };
}

// Returns null when the rubric file is missing or empty. The caller MUST treat null as
// "the review did not run", never as "review with no rules". A reviewer silently
// falling back to a generic checklist is the failure this seam exists to prevent: it
// would still print findings, so the loss of the project's real rules would be
// invisible.
function rubric() {
  const f = path.resolve(REPO_ROOT, config().rubricFile);
  try {
    const text = fs.readFileSync(f, 'utf8').trim();
    return text ? text : null;
  } catch { return null; }
}

module.exports = { config, rubric, REPO_ROOT, CONFIG_FILE, DEFAULTS };
