// PreToolUse guard (Edit + Write): BLOCKS a write to a file outside the approved
// plan's scope. This is the point where the plan stops being a document.
//
// ENFORCE ONLY WHILE A PLAN IS ACTIVE. No .plan.json, or one still in `draft`,
// means no constraint at all. The handoff originally specified blocking every edit
// whenever no approved plan exists; built literally that bricks all ad-hoc work and
// makes the repo unusable whenever the human is not present to approve something.
// The human chose enforce-when-active on 2026-07-20. A gate that cannot be passed
// without a human standing by is not a gate, it is an outage.
//
// WHY BLOCK AT PreToolUse and not only at commit: it bites BEFORE tokens burn on a
// change that will be refused anyway. The commit-time check still exists (git hooks
// are tool-agnostic, and a PowerShell call once walked straight through a Bash-only
// PreToolUse guard), but catching it here is what makes it cheap.
//
// The block is on the ABSENCE OF A RULING, not on the violation. An out-of-scope
// file is legitimate discovery often enough; what is not acceptable is proceeding
// with no record. The architect rules widen/revert/escalate, and the ruling is what
// unblocks. If escalation were the soft path, Claude would simply walk it.
//
// Fails OPEN on any error: a broken guard must never brick the session.

const fs = require("fs");
const path = require("path");

function main() {
  let input;
  try { input = JSON.parse(fs.readFileSync(0, "utf8")); } catch { return; }

  const file = (input.tool_input && input.tool_input.file_path) || "";
  if (!file) return;

  // Required lazily so a missing/broken lib cannot wedge every Edit in the repo.
  let plan, isActive, matchesScope, ruledVerdict;
  try {
    const lib = require("../../scripts/plan.js");
    plan = lib.readPlan();
    isActive = lib.isActive;
    matchesScope = lib.matchesScope;
    ruledVerdict = lib.ruledVerdict;
  } catch { return; }

  if (!isActive(plan)) return; // no active plan -> no constraint

  // Compare repo-relative, forward-slashed. tool_input.file_path is absolute.
  const REPO_ROOT = path.join(__dirname, "..", "..");
  let rel = path.isAbsolute(file) ? path.relative(REPO_ROOT, file) : file;
  rel = rel.replace(/\\/g, "/");
  // Outside the repo entirely (a scratchpad, a temp dir) is none of the plan's business.
  if (rel.startsWith("../")) return;

  const scope = (plan.scope && plan.scope.files) || [];
  if (matchesScope(rel, scope)) return;

  // A ruling is NOT a permission slip. Only `widen` clears the file, and a widen
  // already put it in scope.files above, so reaching here means the architect
  // either has not ruled or ruled AGAINST this file. Caught by a live test: the
  // first cut treated any ruling as clearing, so a `revert` unblocked the very
  // file it rejected, while the architect was printing "still blocked".
  const verdict = ruledVerdict(plan, rel);

  const already = verdict
    ? `The architect already ruled ${verdict.toUpperCase()} on this file. That ruling stands; ` +
      `it is not a permission slip. ${verdict === "revert"
        ? "Back the change out."
        : "This is the human's call now, and going around them is not an option."}\n`
    : `This is not a refusal to let you touch it. It is a refusal to let you touch it with ` +
      `NO RULING ON RECORD. Get the architect to rule:\n` +
      `  node scripts/plan-rule.js "${rel}" "why this file genuinely needs to change"\n` +
      `It will answer widen (scope grows), revert (back it out), or escalate (goes to the human).\n`;

  process.stderr.write(
    `[plan-scope-guard] BLOCKED: '${rel}' is OUTSIDE the scope of approved plan ${plan.id}.\n` +
    `Scope: ${scope.join(", ") || "(empty)"}\n` +
    already +
    `Hand-editing .plan.json to widen your own scope is TAMPERING, not a judgment ` +
    `call. If you believe this block is wrong, say so to the user and stop.`
  );
  process.exit(2); // exit 2 = PreToolUse BLOCK; stderr goes to Claude
}

try { main(); } catch { /* fail open */ }
