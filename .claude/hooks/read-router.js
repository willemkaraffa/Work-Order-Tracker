// PreToolUse guard on Read + Grep: send BULK reading to Gemini, keep targeted
// reading on Claude.
//
// THE GAP THIS CLOSES. role-router.js moved review off the Claude subscription by
// blocking reviewer subagents. That fixed the instance and missed the class: the
// real cost driver is bulk READING, and the main thread's Read and Grep were
// completely ungated. Bulk reading costs the same whether a subagent or the main
// session does it. The standing principle was always "Claude must not dig through
// ever-growing context"; it had only ever been enforced against subagents.
//
// WHAT IS BLOCKED, and what deliberately is not. Blocking Read outright would brick
// the session, so this draws the line at UNBOUNDED reads:
//   Read  -> blocked only when there is NO limit AND the file is over BIG_FILE lines.
//            A targeted read (offset/limit) always passes, at any file size.
//            A small file always passes.
//   Grep  -> blocked only when output_mode is "content" AND there is no head_limit
//            AND nothing narrows the search (no glob, no path, no type). That is an
//            unbounded sweep of the whole repo dumped into context.
// Everything else passes untouched. A guard that fires on ordinary work gets
// resented and routed around, and CLAUDE.md itself says to grep for a fact.
//
// The escape is not "read it anyway", it is scripts/ask.js: Gemini reads the file
// and returns the ANSWER, so a 5000-line file costs a few hundred tokens instead of
// tens of thousands. For an exact edit, read the cited span with offset/limit,
// which this guard allows by design.
//
// Fails OPEN on any error: a broken guard must never brick the session.

const fs = require("fs");

const BIG_FILE = 400; // lines. Under this, a whole-file read is cheap enough.

function lineCount(p) {
  try {
    const st = fs.statSync(p);
    if (!st.isFile()) return 0;
    // Cheap guard: anything over ~2MB is definitely big, do not read it to count.
    if (st.size > 2 * 1024 * 1024) return Infinity;
    return fs.readFileSync(p, "utf8").split("\n").length;
  } catch { return 0; } // unreadable/absent -> not our problem, let Read report it
}

function main() {
  let input;
  try { input = JSON.parse(fs.readFileSync(0, "utf8")); } catch { return; }

  const tool = input.tool_name || "";
  if (tool !== "Read" && tool !== "Grep") return;
  const ti = input.tool_input || {};

  // Rule G6 in the registry. Retired by evidence -> stand down.
  try {
    if (!require("../../scripts/rule-registry.js").isRuleActive("G6")) return;
  } catch { /* cannot tell -> keep routing */ }

  if (tool === "Read") {
    const p = ti.file_path || "";
    // A bounded read is always fine: that IS the sanctioned way to read a span.
    if (ti.limit) return;
    // Non-text targets (images, PDFs, notebooks) are not what this is about.
    if (/\.(png|jpe?g|gif|webp|svg|pdf|ipynb)$/i.test(p)) return;
    const n = lineCount(p);
    if (n <= BIG_FILE) return;

    process.stderr.write(
      `[read-router] BLOCKED: '${p}' is ${n === Infinity ? "very large" : n + " lines"} and you asked for ALL of it.\n` +
      `Bulk reading is the main token cost in this project, and it costs the same in the main\n` +
      `thread as in a subagent. Two sanctioned ways forward:\n` +
      `  1. Ask Gemini, and get back an answer instead of a file:\n` +
      `       node scripts/ask.js "your question" ${p}\n` +
      `  2. Read only the span you need (always allowed, any file size):\n` +
      `       Read with offset + limit, after grepping for the line number.\n` +
      `If you genuinely need the whole file verbatim, say so to the user and explain why.\n` +
      `Splitting it into consecutive limit-reads to swallow the file anyway is TAMPERING.`
    );
    process.exit(2);
  }

  // Grep: only an UNBOUNDED CONTENT sweep is blocked.
  const contentMode = ti.output_mode === "content";
  const bounded = ti.head_limit || ti.glob || ti.type || ti.path;
  if (!contentMode || bounded) return;

  process.stderr.write(
    `[read-router] BLOCKED: an unbounded content grep dumps every match into context.\n` +
    `Narrow it or bound it (any ONE of these clears this block):\n` +
    `  head_limit: 50        cap the output\n` +
    `  path / glob / type    search a subtree or file kind\n` +
    `  output_mode: "files_with_matches"   locate first, then read the span\n` +
    `Or let Gemini read and answer instead:\n` +
    `  node scripts/ask.js "your question" --glob "src/**/*.js"`
  );
  process.exit(2);
}

try { main(); } catch { /* fail open */ }
