// Scraper data-gate. Two hook events, one script (branch on hook_event_name):
//
//   PostToolUse (Read/Bash/PowerShell): if a REAL captured DOM dump was touched
//     (path matches wo-dump*.json), record it to session state.
//   PreToolUse (Edit/Write): if the target is EXTRACTION code and NO real dump has
//     been read this session, BLOCK.
//
// WHY: the worst, most expensive failures this project (this session's 03907321, and
// a long trail of "NOT live-tested" in memory) are all the same shape -- editing
// extraction logic against synthetic/guessed DOM instead of a real capture. The
// quality gates (review/verify) cannot catch it: synthetic tests go green. Only a real
// captured DOM can. This makes "get real data first" mechanical: you cannot touch
// extraction code until a real dump is in the session. If none exists, that is the
// signal to ASK the user for one -- exactly the step that keeps being skipped.
//
// Fails OPEN. Not a judgment gate: it checks a dump was READ, not that it was read
// WELL. That last mile is still on the human/model. But it stops blind edits cold.

const fs = require('fs');
const path = require('path');
const os = require('os');

// Extraction files: editing these needs real DOM. Extend as the scraper grows.
const EXTRACTION = /(?:^|[\\/])(content\.js|scrape_amh\.py|scraper-extract\.js|scraper\.js|orders-scrape[\w.-]*)$/i;
// A real captured dump (NOT a synthetic fixture the model just wrote).
const REAL_DUMP = /wo-dump[\w.-]*\.json/i;

function stateFile(input) {
  const s = String(input.session_id || 'nosession').replace(/[^\w.-]/g, '_');
  return path.join(os.tmpdir(), `wot-datagate-${s}.json`);
}
function load(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return { dumps: [] }; } }

function main() {
  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { return; }
  const ev = input.hook_event_name;
  const ti = input.tool_input || {};
  const f = stateFile(input);

  if (ev === 'PostToolUse') {
    // Record any real-dump path seen in a Read path or a shell command.
    const hay = `${ti.file_path || ''} ${ti.command || ''}`;
    if (REAL_DUMP.test(hay)) {
      const st = load(f);
      st.dumps.push({ when: Date.now(), ref: (hay.match(REAL_DUMP) || [''])[0] });
      try { fs.writeFileSync(f, JSON.stringify(st)); } catch {}
    }
    return;
  }

  if (ev === 'PreToolUse') {
    const target = ti.file_path || '';
    if (!EXTRACTION.test(target)) return;       // not extraction code -> free
    const st = load(f);
    if (st.dumps && st.dumps.length) return;     // a real dump is in the session -> allow
    process.stderr.write(
      `[scraper-data-gate] BLOCKED editing extraction code (${path.basename(target)}) with NO real ` +
      `DOM dump read this session. Editing scrapers against synthetic/guessed DOM is THE recurring ` +
      `failure (03907321: 2 blind edits, wrong both). Get a real capture first: have the user run the ` +
      `extension "Dump DOM" on the failing page, then Read the wo-dump*.json. If you have one, Read it ` +
      `and retry. This gate cannot be self-waived.`
    );
    process.exit(2);
  }
}

try { main(); } catch { /* fail open */ }
