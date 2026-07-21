// PreToolUse guard on Agent: route role work to the role that is supposed to do it.
//
// THE MODEL (the user's framing, and it is the right one): Project Overseer is the
// CENTRAL NERVOUS SYSTEM, not the brain. The human is the authority. The Overseer
// carries signals; each role has a receptor, and a signal is picked up only by the
// role whose signature matches. Everything else ignores it.
//
// WHERE THE METAPHOR HAS TO BEND, from a fact probed 2026-07-17: a hook CANNOT tell
// which agent is asking, because a subagent shares the parent's session_id. So the
// signature cannot live in the RECEIVER. It lives in the SIGNAL. This hook reads the
// spawn request and matches on its shape, never on who sent it. That is closer to
// real receptor binding anyway: the nerve does not know the cell, the cell matches
// the ligand.
//
// WHAT IT COSTS TO NOT HAVE THIS: a fresh session with no memory of the design
// reaches for the built-in Claude reviewer, because it is the obvious path and
// nothing forbade it. One such session burned ~40k subscription tokens on a review
// that Gemini does for free, and every gate stayed green, because the gates only
// ever checked that findings were DISPOSITIONED, never that Gemini produced them.
// Blocking at commit would not have helped: the tokens are already spent by then.
// This bites BEFORE the spawn.
//
// TOOL NAME IS `Agent`, NOT `Task` (verified against a real transcript,
// ba6aa8f9, which carried subagent_type "reviewer"). A guard written against `Task`
// would have matched nothing and looked perfectly healthy. Payload shape:
//   { subagent_type, description, prompt, run_in_background }
//
// Fails OPEN on any error: a broken guard must never brick the session.

const fs = require("fs");

// Receptors. Each names a role the Overseer routes AWAY from Claude, the signature
// that identifies the signal, and the script that actually owns the work.
const RECEPTORS = [
  {
    role: "reviewer",
    // subagent_type is the strong signal. The text patterns catch a review spawned
    // under a generic agent type, which is the obvious way around a type-only check.
    types: ["reviewer", "cavecrew-reviewer", "caveman:cavecrew-reviewer"],
    text: /\b(review (this|the|my) (diff|branch|change|pr|code)|code[- ]review|audit (this|the) (diff|change|branch)|look for (bugs|defects) in (this|the) diff)\b/i,
    owner: "node scripts/gemini-review.js",
    why: "The reviewer runs on Gemini, off the Claude subscription. A Claude subagent " +
         "doing this work costs tokens for a review the external reviewer does for free, " +
         "and its findings cannot satisfy the review gate, which requires a Gemini model " +
         "stamp on the ledger.",
  },
  {
    role: "architect",
    types: ["architect"],
    text: /\b(draft (a |the )?plan|rule on (this|the) finding|triage (the )?findings|decide whether this finding)\b/i,
    owner: 'node scripts/architect.js plan "<goal>" | triage | rule <id> | scope <file>',
    why: "The architect is external Gemini ON PURPOSE: independence, so that Claude is " +
         "not judging Claude. A Claude subagent playing architect re-creates the " +
         "sole-judge hole the whole chain exists to close.",
  },
];

function signalMatches(receptor, type, text) {
  if (receptor.types.includes(type)) return "subagent_type";
  if (receptor.text.test(text)) return "request text";
  return null;
}

function main() {
  let input;
  try { input = JSON.parse(fs.readFileSync(0, "utf8")); } catch { return; }

  if ((input.tool_name || "") !== "Agent") return;
  const ti = input.tool_input || {};

  // Rule G5 in the registry. Retired by evidence -> stand down, like any other rule.
  try {
    if (!require("../../scripts/rule-registry.js").isRuleActive("G5")) return;
  } catch { /* cannot tell -> keep routing */ }

  const type = String(ti.subagent_type || "").toLowerCase();
  const text = `${ti.description || ""}\n${ti.prompt || ""}`;

  for (const r of RECEPTORS) {
    const via = signalMatches(r, type, text);
    if (!via) continue;
    process.stderr.write(
      `[role-router] BLOCKED: this is ${r.role.toUpperCase()} work, matched on ${via}.\n` +
      `${r.why}\n` +
      `Run the role's own tool instead:\n  ${r.owner}\n` +
      `The Overseer routes a signal to the role that owns it; spawning a Claude subagent ` +
      `for this is not a shortcut, it is the wrong receptor. If you believe this block is ` +
      `wrong, say so to the user and stop. Rewording the prompt to slip past the match is ` +
      `TAMPERING with the gate, not a judgment call.`
    );
    process.exit(2); // exit 2 = PreToolUse BLOCK; stderr goes to Claude
  }
}

try { main(); } catch { /* fail open */ }
