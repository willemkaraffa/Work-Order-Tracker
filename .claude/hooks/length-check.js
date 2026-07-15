// Stop hook: FLAG-ONLY. Fires when Claude stops. Measures the length of the assistant's
// last message and surfaces a non-blocking notice if it exceeds the budget. It NEVER
// blocks, never forces a rewrite -- a hook fires after generation, so it cannot truncate.
// Its whole job is to make verbosity drift VISIBLE and countable, which a reminder cannot.
//
// Deterministic: a char count does not rely on Claude's judgement. That is the point --
// caveman STYLE is judgement and drifts, but "message length" is a rule and is measurable.

const fs = require("fs");

const BUDGET = 2200; // chars. Tune here. Terse answers sit well under; tables/lists may exceed.

function main() {
  let raw = "";
  try {
    raw = fs.readFileSync(0, "utf8"); // stdin
  } catch {
    return; // no input -> say nothing, never block
  }

  let transcriptPath;
  try {
    transcriptPath = JSON.parse(raw).transcript_path;
  } catch {
    return;
  }
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return;

  // The transcript is JSONL. Walk from the end for the last assistant text.
  let lines;
  try {
    lines = fs.readFileSync(transcriptPath, "utf8").split("\n").filter(Boolean);
  } catch {
    return;
  }

  let text = "";
  for (let i = lines.length - 1; i >= 0; i--) {
    let ev;
    try {
      ev = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    const msg = ev.message || ev;
    const role = msg.role || ev.type;
    if (role !== "assistant") continue;
    const content = msg.content;
    if (typeof content === "string") {
      text = content;
    } else if (Array.isArray(content)) {
      text = content.filter((b) => b && b.type === "text").map((b) => b.text || "").join("");
    }
    break; // first assistant message from the end = the one just finished
  }

  const n = text.length;
  if (n > BUDGET) {
    const over = Math.round(((n - BUDGET) / BUDGET) * 100);
    process.stdout.write(
      JSON.stringify({
        systemMessage:
          `[length] that reply was ${n} chars, ${over}% over the ${BUDGET} budget. ` +
          `Caveman/brevity drift -- tighten the next one.`,
      })
    );
  }
  // Under budget: print nothing, exit 0. Silent when compliant.
}

try {
  main();
} catch {
  // A broken length check must never break the session.
}
