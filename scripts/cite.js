'use strict';
/*
 * cite.js: the reviewer's minion. Turns each open finding's `symbol` (a verbatim
 * source substring the reviewer copied) into the actual code, so the coder reads a
 * few cited lines instead of whole files.
 *
 *   node scripts/cite.js                 # cite every open finding
 *   node scripts/cite.js e2e9785c 8ab8   # cite specific ids (prefix match)
 *   node scripts/cite.js --context 25    # widen the served span (default 12)
 *
 * Two jobs, in order:
 *   1. VERIFY BY CONTENT. Grep the symbol in the finding's file. If the file is gone
 *      or the symbol is not present VERBATIM, the finding cites code that does not
 *      exist -> auto-dismiss it, with the disproof as the written reason. This is a
 *      POSITIVE disproof (the claimed substring is provably absent), the only case
 *      safe to auto-drop. A wrong CONCLUSION about real code is NOT caught here; that
 *      still needs running or reasoning. Do not oversell this.
 *   2. SERVE VERBATIM. If found, print the span around it (symbol line +/- context)
 *      with real line numbers. Bytes are copied, never summarized -- a paraphrase the
 *      coder cannot verify is exactly the failure this avoids. The span is a FLOOR,
 *      not a fence: raise --context, or Read wider, when the citation is too narrow
 *      (a real fix often needs adjacent code the finding never named).
 *
 * A symbol-less open finding is left UNTOUCHED (not dropped): the gate blocks on it
 * so a human gets a real citation. Silence would bias toward killing true findings.
 */
const fs = require('fs');
const path = require('path');

const FINDINGS_FILE = path.join(__dirname, '..', '.review-findings.json');
const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_CONTEXT = 12;

// Map a 0-based char offset in `text` to a 1-based line number.
function offsetToLine(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}

// Every 0-based char offset where `needle` occurs in `hay` (verbatim, case-sensitive).
function allIndexes(hay, needle) {
  const out = [];
  if (!needle) return out;
  let from = 0;
  for (;;) {
    const i = hay.indexOf(needle, from);
    if (i === -1) break;
    out.push(i);
    from = i + needle.length;
  }
  return out;
}

// Read a finding's file relative to repo root. Returns text, or null if unreadable/binary.
function readFileFor(finding) {
  const p = path.join(REPO_ROOT, finding.file || '');
  let raw;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
  if (raw.includes('\0')) return null; // binary
  return raw;
}

// Render the cited span for one occurrence: symbol's line +/- context, with line numbers.
function renderSpan(text, offset, context, id, file) {
  const lines = text.split('\n');
  const hit = offsetToLine(text, offset);
  const start = Math.max(1, hit - context);
  const end = Math.min(lines.length, hit + context);
  const width = String(end).length;
  const body = [];
  for (let n = start; n <= end; n++) {
    const mark = n === hit ? '>' : ' ';
    body.push(`${mark} ${String(n).padStart(width)}  ${lines[n - 1]}`);
  }
  return `[cite ${id} ${file}:${start}-${end}]  (line ${hit} marked '>'; span is a floor, widen with --context or Read)\n${body.join('\n')}`;
}

// A vanished symbol has TWO causes, and they are opposites.
//
// Either the reviewer cited bytes that never existed (hallucination, a false
// positive), or the architect ruled the finding STANDS and the coder then removed
// exactly those bytes (a fix, a true positive). Both look identical here: the symbol
// is not in the file. cite.js used to call every one of them a hallucination, so a
// reviewer was recorded as WRONG precisely when it had been right and its finding was
// repaired. That miscount feeds rule-registry precision, and rules retire on
// accumulated false positives, so a working rule could be retired for working.
//
// The discriminator is `ruledBy`, which architect.js is the only writer of and whose
// absence that script already uses as its untriaged marker (isUntriaged). No new
// field: a finding still `open` and stamped by the architect is one that STANDS,
// because that is what TRIAGE_STATUS maps 'stands' onto.
const stoodAndWasFixed = f => f.status === 'open' && f.ruledBy === 'architect';

// Pure core: takes the doc + options, returns { doc, blocks, dismissed, fixed, missing }.
// blocks = strings to print for the coder; dismissed/fixed/missing = ids acted on.
// `read` injected for testability.
function cite(doc, { ids = [], context = DEFAULT_CONTEXT, read = readFileFor } = {}) {
  const open = (doc.findings || []).filter(f => f.status === 'open');
  const want = ids.length
    ? open.filter(f => ids.some(id => String(f.id).startsWith(id)))
    : open;

  const blocks = [];
  const dismissed = [];
  const fixed = [];
  const missing = [];

  // Closes a finding whose cited bytes are gone, as a FIX or as a hallucination
  // depending on whether the architect had already ruled it stands. Both write a
  // reason: review-gate prints it, and a human has to be able to check the call.
  const closeVanished = (f, why) => {
    if (stoodAndWasFixed(f)) {
      f.status = 'fixed';
      f.reason = `closed by cite.js: the architect ruled this STANDS, and ${why} The cited code is gone because it was FIXED, not because it was never there.`;
      fixed.push(f.id);
      blocks.push(`[FIXED ${f.id}]  ${f.reason}`);
    } else {
      f.status = 'dismissed';
      f.reason = `auto-dismissed by cite.js: ${why} The finding cites code that does not exist (hallucinated location); a correct finding cites real bytes.`;
      dismissed.push(f.id);
      blocks.push(`[DISMISS ${f.id}]  ${f.reason}`);
    }
  };

  for (const f of want) {
    const symbol = String(f.symbol || '').trim();
    if (!symbol) {
      missing.push(f.id); // gate blocks these; cite does not drop them
      blocks.push(`[skip ${f.id} ${f.file}]  no symbol on this finding -> cannot cite. Gate will block it until a human re-cites or dispositions it.`);
      continue;
    }
    const text = read(f);
    if (text === null || text === undefined) {
      closeVanished(f, `file '${f.file}' is missing/unreadable, so symbol '${symbol}' cannot exist there.`);
      continue;
    }
    const hits = allIndexes(text, symbol);
    if (hits.length === 0) {
      closeVanished(f, `symbol '${symbol}' was not found verbatim in ${f.file} (0 matches).`);
      continue;
    }
    const shown = hits.slice(0, 3); // cap: a symbol matching many sites is too generic to be useful
    const spans = shown.map(off => renderSpan(text, off, context, f.id, f.file));
    const extra = hits.length > shown.length ? `\n  (+${hits.length - shown.length} more occurrence(s); symbol may be too generic)` : '';
    const claimedLine = f.line != null ? ` claimed line ${f.line}` : '';
    blocks.push(`--- ${f.id} [${f.severity}/${f.rule}]${claimedLine}\n  problem: ${f.problem}\n  fix: ${f.fix}\n${spans.join('\n\n')}${extra}`);
  }

  return { doc, blocks, dismissed, fixed, missing };
}

function parseArgs(argv) {
  const ids = [];
  let context = DEFAULT_CONTEXT;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--context') {
      const n = parseInt(argv[++i], 10);
      if (Number.isFinite(n) && n >= 0) context = n;
    } else {
      ids.push(argv[i]);
    }
  }
  return { ids, context };
}

function main() {
  const { ids, context } = parseArgs(process.argv.slice(2));

  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(FINDINGS_FILE, 'utf8'));
  } catch {
    console.error('[cite] no findings file. Run: node scripts/gemini-review.js');
    return 2;
  }

  const { blocks, dismissed, fixed, missing } = cite(doc, { ids, context });

  if (dismissed.length || fixed.length) {
    fs.writeFileSync(FINDINGS_FILE, JSON.stringify(doc, null, 2));
  }

  if (!blocks.length) {
    console.log('[cite] no open findings to cite.');
    return 0;
  }
  console.log(blocks.join('\n\n'));
  console.log(`\n[cite] ${blocks.length - dismissed.length - fixed.length - missing.length} served, ${fixed.length} closed as FIXED (stood, then the code changed), ${dismissed.length} auto-dismissed (symbol absent, never stood), ${missing.length} skipped (no symbol).`);
  if (dismissed.length) console.log(`[cite] auto-dismissals written to the ledger with reasons: ${dismissed.join(', ')}`);
  if (fixed.length) console.log(`[cite] closed as fixed: ${fixed.join(', ')}`);
  return 0;
}

module.exports = { cite, offsetToLine, allIndexes, renderSpan };

if (require.main === module) {
  process.exitCode = main();
}
