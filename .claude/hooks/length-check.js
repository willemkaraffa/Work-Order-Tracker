// Stop hook: BLOCKS a stop when the just-finished assistant message breaks a
// MECHANICALLY CHECKABLE style rule (caveman length, em-dash, emoji). A flag was
// decoration -- a Stop systemMessage is invisible to Claude, and even the visible
// UserPromptSubmit length nudge did not stop drift (proven all session). Blocking is
// the only teeth a hook has over assistant TEXT: it refuses the stop and feeds the
// reason back, forcing an immediate terse rewrite. It cannot unsend the bloated
// message, but it makes the rule cost something, which a reminder never did.
//
// Deterministic ONLY: length is a char count, em-dash/emoji are exact codepoints. No
// judgment. Rules that need judgment (is prose "terse enough"?) are NOT enforced here.
//
// Loop-safe: if we are ALREADY inside a stop-hook-forced continuation
// (stop_hook_active), do not block again -- one correction, then let it stop.
// Fails OPEN: a broken hook must never wedge the session.

const fs = require("fs");

const BUDGET = 2200; // chars of PROSE (code fences excluded). Tune here.
const EM_DASH = /—/;                     // CLAUDE.md: no em-dashes
const EMOJI = /\p{Extended_Pictographic}/u;   // CLAUDE.md: no emojis

function lastAssistantText(transcriptPath) {
  let lines;
  try {
    lines = fs.readFileSync(transcriptPath, "utf8").split("\n").filter(Boolean);
  } catch { return ""; }
  for (let i = lines.length - 1; i >= 0; i--) {
    let ev;
    try { ev = JSON.parse(lines[i]); } catch { continue; }
    const msg = ev.message || ev;
    const role = msg.role || ev.type;
    if (role !== "assistant") continue;
    const content = msg.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content.filter(b => b && b.type === "text").map(b => b.text || "").join("");
    }
    return "";
  }
  return "";
}

// The human can lift the LENGTH budget (only the length budget) by answering an
// AskUserQuestion. Claude emits the question; only the harness can write the answer.
//
// FORGE NOTE (probed 2026-07-20, and it killed the original design): the handoff
// spec said "match user-role tool_result entries" -- that is NOT forge-proof. A Bash
// tool_result is ALSO a user-role entry, and its stdout is whatever Claude told the
// command to print, so `echo 'been answered: "..."="Verbose ON"'` would have granted
// Claude its own lift. Confirmed in a live transcript: the phrase appears in a
// tool_result whose originating tool is Bash.
//
// So the grant is read STRUCTURALLY, from two things Claude cannot author:
//   1. the entry's `toolUseResult.answers` map (harness-written, absent on Bash), and
//   2. the tool_use_id resolving to a tool_use block whose name is AskUserQuestion.
// A Bash result cannot carry an AskUserQuestion tool_use_id, so shell output is out.
const GRANT_Q = "Speak verbosely here?";
const GRANT_ON = "Verbose ON";

function lastUserGrant(transcriptPath) {
  let lines;
  try {
    lines = fs.readFileSync(transcriptPath, "utf8").split("\n").filter(Boolean);
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
      if (b && b.type === "tool_use" && b.name === "AskUserQuestion") askIds.add(b.id);
    }
  }

  let grant = null; // last one wins; a later "Stay caveman" revokes an earlier lift
  for (const ev of events) {
    const role = (ev.message && ev.message.role) || ev.type;
    if (role !== "user") continue;
    const answers = ev.toolUseResult && ev.toolUseResult.answers;
    if (!answers || typeof answers !== "object") continue;

    // The answer must have come from an AskUserQuestion call, not any other tool.
    const content = ev.message && ev.message.content;
    const ids = Array.isArray(content)
      ? content.filter(b => b && b.type === "tool_result").map(b => b.tool_use_id)
      : [];
    if (!ids.some(id => askIds.has(id))) continue;

    if (!Object.prototype.hasOwnProperty.call(answers, GRANT_Q)) continue;
    grant = answers[GRANT_Q] === GRANT_ON ? "ON" : "OFF";
  }
  return grant;
}

function main() {
  let input;
  try { input = JSON.parse(fs.readFileSync(0, "utf8")); } catch { return; }

  // Do not re-block a correction we already forced (loop guard).
  if (input.stop_hook_active) return;
  const tp = input.transcript_path;
  if (!tp || !fs.existsSync(tp)) return;

  const text = lastAssistantText(tp);
  if (!text) return;

  // Measure PROSE only: strip fenced code so legit code/long snippets do not trip it.
  const prose = text.replace(/```[\s\S]*?```/g, "");

  // Verbose lift: skips the LENGTH check only. The glyph rules never lift.
  const verbose = lastUserGrant(tp) === "ON";

  const problems = [];
  if (!verbose && prose.length > BUDGET) problems.push(`${prose.length} chars of prose, over the ${BUDGET} budget`);
  if (EM_DASH.test(prose)) problems.push("contains an em-dash (banned)");
  if (EMOJI.test(prose)) problems.push("contains an emoji (banned)");

  if (problems.length) {
    process.stdout.write(JSON.stringify({
      decision: "block",
      reason: `[style-gate] Your last reply violated a hard style rule: ${problems.join("; ")}. ` +
        `Rewrite it now: caveman-terse, no em-dash, no emoji, prose under ${BUDGET} chars ` +
        `(code blocks do not count). This is not advisory -- the stop was refused.`,
    }));
  }
}

try { main(); } catch { /* fail open */ }
