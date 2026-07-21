'use strict';
/*
 * ask.js: Gemini reads the files, Claude gets the ANSWER.
 *
 *   node scripts/ask.js "the question" file1 [file2 ...]
 *   node scripts/ask.js "the question" --glob "src/**\/*.jsx"
 *
 * WHY THIS EXISTS. Gating the reviewer subagent moved review OFF the Claude
 * subscription, but it left the real cost driver untouched: ordinary Read and Grep
 * in the main thread. Bulk reading is bulk reading regardless of who does it, and
 * a 3000-line file read to answer one question costs the same whether a subagent
 * or the main session does it. The principle was always "Claude must not dig
 * through ever-growing context"; it had only ever been enforced against subagents.
 *
 * The trade this makes: file CONTENT goes to Gemini and only the ANSWER comes back
 * into Claude's context. A 5000-line file costs a few hundred tokens of answer
 * instead of tens of thousands of tokens of source.
 *
 * HONEST LIMIT, so nobody oversells this. The answer is a SUMMARY, and a summary
 * can be wrong or can omit the thing that mattered. For a question where being
 * wrong is expensive (an exact signature, a precise line to edit), read the
 * specific span directly with offset/limit. This tool is for "where is X", "does
 * this file do Y", "which of these handles Z", not for work that needs verbatim
 * text. Editing still requires reading the real lines.
 *
 * Exit: 0 answered, 2 did not run.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { callGemini } = require('./gemini-call.js');
const { buildFileContext } = require('./gemini-review.js');

const REPO_ROOT = path.join(__dirname, '..');

function expandGlob(pattern) {
  try {
    // git ls-files understands the repo's own tracked set, so this never wanders
    // into node_modules or build output.
    return execFileSync('git', ['ls-files', pattern], { cwd: REPO_ROOT, encoding: 'utf8' })
      .split('\n').map(s => s.trim()).filter(Boolean);
  } catch { return []; }
}

async function main() {
  const args = process.argv.slice(2);
  const question = args.find(a => !a.startsWith('--'));
  if (!question) {
    console.error('usage: node scripts/ask.js "question" <file...> | --glob "<pattern>"');
    return 2;
  }
  const gi = args.indexOf('--glob');
  const files = gi !== -1
    ? expandGlob(args[gi + 1] || '')
    : args.filter(a => a !== question && !a.startsWith('--'));

  if (!files.length) {
    console.error('[ask] no files. Pass paths, or --glob "src/**/*.js".');
    return 2;
  }

  // Accept BOTH repo-relative and absolute paths. path.join(REPO_ROOT, absolute)
  // silently produces a mangled path that fails to read, and the caller sees only
  // "not readable" with no hint why. The read-router's block message quotes the
  // absolute path it was given, so absolute is the common case in practice.
  const ctx = buildFileContext(files, f => {
    const p = path.isAbsolute(f) ? f : path.join(REPO_ROOT, f);
    try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
  });
  if (!ctx.included.length) {
    console.error(`[ask] none of the ${files.length} path(s) were readable.`);
    return 2;
  }

  const prompt = `Answer the question using ONLY the file text below. You are answering on behalf of
another engineer who will NOT see these files, so your answer has to stand alone.

Rules:
- Cite file:line for every claim. The reader needs to jump straight to the code.
- Quote the exact source line when the answer depends on precise wording.
- If the files do not contain the answer, say so plainly. Do NOT guess or fill gaps;
  a confident wrong answer here is worse than "not in these files", because the
  reader cannot check it without re-reading everything you were given.
- Be brief. Prose, no preamble.

=== QUESTION ===
${question}

=== FILES (${ctx.included.length}) ===
${ctx.text}`;

  const call = await callGemini(prompt, { tag: 'ask', json: false });
  if (!call.ok) {
    console.error(`[ask] ${call.why}: NO ANSWER (exit 2). Nothing was read.`);
    return 2;
  }

  console.log(`\n[ask] ${call.model} read ${ctx.included.length} file(s)` +
    (ctx.truncated.length ? `, ${ctx.truncated.length} TRUNCATED (${ctx.truncated.join(', ')})` : '') +
    (ctx.skipped.length ? `, ${ctx.skipped.length} skipped` : '') + ':\n');
  console.log(call.text.trim());
  console.log('\n[ask] This is a SUMMARY. For an exact edit, read the cited span with offset/limit.');
  return 0;
}

if (require.main === module) {
  main().then(c => { process.exitCode = c; })
        .catch(e => { console.error(`[ask] fatal: ${e.message}`); process.exitCode = 2; });
}

module.exports = { expandGlob };
