// User-authority gate. The coder may not change who owns a field, or touch the
// scraper, on its own say-so.
//
// WHY THIS EXISTS, precisely. On 2026-07-22 the coder routed extension AMH capture
// into the `extension-import` channel because that channel already merged and
// notified. It did not read what that channel does to an EXISTING record. The import
// path takes portal status for any active WO (`status: hardcoded ? old.status :
// (inc.status || old.status)`), so a real work order's user-set "Bid Submitted -
// Return" was overwritten with the portal's raw "UNSCHEDULED". The in-app path
// (applyCapture) never does that; it is fill-only. Two channels, opposite policies,
// and the coder picked one without checking.
//
// Nothing caught it, and the reason is worth stating: the reviewer never raised it, so
// the architect never ruled on it. `escalate` has never fired once in 53 findings. A
// human gate that waits for a weak reviewer to notice first is not a gate.
//
// So this does not ask anyone's opinion. It is deterministic:
//   - Editing a site that can write a USER-OWNED field  -> BLOCKED.
//   - Editing SCRAPER/capture code                      -> BLOCKED without a plan.
// Both release only on evidence the harness itself wrote, never on a claim.
//
// SCOPE, honestly stated. This is a PreToolUse guard, so it sees only the tools it is
// registered for. The commit-side half is pre-commit, which is tool-agnostic; a
// PowerShell call once walked straight through a Bash-only guard here. Treat this as
// the early warning and the commit hook as the real fence.
//
// Fails OPEN on its own errors: a broken guard must not brick the session. It logs and
// gets out of the way.

const fs = require('fs');
const path = require('path');

// Fields the USER owns. The portal may suggest these; it may not overwrite them.
// `status` is the one that actually burned; the rest are the same class of
// user-curated judgement and would burn the same way.
const USER_OWNED = ['status', 'priority', 'tech', 'notes', 'schedule', 'tab', 'prevStatus'];

// Files holding the merge policy for those fields. Editing any of them can silently
// change which side wins, which is a DESIGN decision and not the coder's to make.
const AUTHORITY_SITES = /(?:^|[\\/])(data\.js|app\.jsx|orders-logic\.js|main\.js|preload\.js)$/i;

// Routing a record into a merge channel IS the policy decision, even when the edit
// names no field. The 2026-07-22 incident was exactly one such line in main.js:
// sending a captured WO down 'extension-import' (portal-wins) instead of the
// applyCapture path (fill-only). The first version of this gate matched only lines
// naming a field, so it would have let that edit through.
const MERGE_CHANNELS = /['"](extension-import|capture-wo|capture-wos|capture-all-amh)['"]/;

// The merge/capture entry points inside those files. A diff that does not touch these
// names is not changing ownership policy, so the gate stays quiet: a guard that fires
// on every app.jsx edit would be noise and would get routed around.
const AUTHORITY_SYMBOLS = /\b(upsertOrders|applyCapture|extension-import|composeNotes|hardcoded)\b/;

// Scraper and capture code. The user's words: being fed wrong data, or none, directly
// costs them working hours, so this is plan-worthy work rather than ad-hoc.
const SCRAPER_SITES = /(?:^|[\\/])(content\.js|background\.js|scrape_amh\.py|amh-runner\.js|parse_amh_remittance\.py|parse_msr_remittance\.py|remittance-runner\.js)$/i;

function planOnDisk(projectRoot) {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(projectRoot, '.plan.json'), 'utf8'));
    return p && p.status === 'approved' ? p : null;
  } catch { return null; }
}

function block(msg) {
  process.stderr.write(msg);
  process.exit(2);
}

function main() {
  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { return; }

  const tool = input.tool_name || '';
  if (tool !== 'Edit' && tool !== 'Write') return;
  const ti = input.tool_input || {};
  const file = String(ti.file_path || '');
  if (!file) return;

  const projectRoot = process.cwd();

  // 1. USER-OWNED FIELD POLICY.
  // Only fires when the edit itself mentions a merge entry point AND a user-owned
  // field. Reading the incoming text (not the file) keeps this about what is being
  // WRITTEN, so an unrelated edit to the same file passes.
  const incoming = String(ti.new_string || ti.content || '');
  if (AUTHORITY_SITES.test(file)) {
    const routing = MERGE_CHANNELS.test(incoming);
    const hit = routing
      ? ['(merge channel: ' + (incoming.match(MERGE_CHANNELS) || [])[1] + ')']
      : (AUTHORITY_SYMBOLS.test(incoming)
          ? USER_OWNED.filter(f => new RegExp('\\b' + f + '\\b').test(incoming))
          : []);
    if (hit.length) {
      block(
        `[user-authority] BLOCKED: this edit changes code that can overwrite a field the USER owns (${hit.join(', ')}).\n` +
        `  file: ${file}\n\n` +
        `On 2026-07-22 exactly this kind of edit replaced a real work order's user-set\n` +
        `status "Bid Submitted - Return" with the portal's "UNSCHEDULED". No reviewer\n` +
        `raised it and no architect ruled on it, because nothing routes a DESIGN decision\n` +
        `to them. Choosing which side wins a field is not the coder's call.\n\n` +
        `Required before this edit:\n` +
        `  1. Ask the USER, with AskUserQuestion, naming the field and both behaviours.\n` +
        `     Their answer is read structurally from the transcript and cannot be forged.\n` +
        `  2. Get the ARCHITECT to rule:\n` +
        `       node node_modules/project-overseer/scripts/architect.js plan "<the decision>"\n\n` +
        `Do NOT route around this by editing a different file. The policy is the point,\n` +
        `not the location.\n`
      );
    }
  }

  // 2. SCRAPER WORK NEEDS A PLAN.
  // Ad-hoc mode exists so small work is not blocked. Capture is not small work: wrong
  // data reaches the user as wrong invoices and missed jobs.
  if (SCRAPER_SITES.test(file) && !planOnDisk(projectRoot)) {
    block(
      `[user-authority] BLOCKED: scraper/capture code needs an APPROVED PLAN, not ad-hoc mode.\n` +
      `  file: ${file}\n\n` +
      `Ad-hoc mode is fine for UI and docs. It is not fine here: bad capture feeds the\n` +
      `user wrong data or none, which costs them working hours directly. Four separate\n` +
      `capture defects shipped on 2026-07-22 alone, every one of them silent.\n\n` +
      `Get a plan (the architect drafts, the HUMAN approves; Claude cannot self-approve):\n` +
      `  node node_modules/project-overseer/scripts/architect.js plan "<goal>"\n` +
      `  node node_modules/project-overseer/scripts/plan-approve.js\n\n` +
      `A plan does NOT mean a handoff document. It means the architect has ruled on the\n` +
      `approach and the human has signed it.\n`
    );
  }
}

try { main(); } catch (e) {
  // Fail open, loudly enough to notice in a transcript, quietly enough not to block.
  process.stderr.write('[user-authority] guard error (failing OPEN): ' + e.message + '\n');
}
