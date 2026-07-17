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

  const problems = [];
  if (prose.length > BUDGET) problems.push(`${prose.length} chars of prose, over the ${BUDGET} budget`);
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
