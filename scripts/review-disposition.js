'use strict';
/*
 * review-disposition.js: record what was done about a reviewer finding.
 *
 *   node scripts/review-disposition.js <id> fixed
 *   node scripts/review-disposition.js <id> dismissed "why this is not a real defect"
 *
 * A dismissal REQUIRES a reason. That reason is written down, printed by the gate
 * at commit time, and read by a human who can overrule it. The point is not to
 * stop Claude from being wrong; it is to stop Claude from being wrong invisibly.
 */
const fs = require('fs');
const path = require('path');

const FINDINGS_FILE = path.join(__dirname, '..', '.review-findings.json');

function main() {
  const [id, status, ...rest] = process.argv.slice(2);
  const reason = rest.join(' ').trim();

  if (!id || !['fixed', 'dismissed'].includes(status)) {
    console.error('usage: node scripts/review-disposition.js <id> fixed|dismissed ["reason"]');
    return 2;
  }
  if (status === 'dismissed' && !reason) {
    console.error('[disposition] dismissing REQUIRES a reason. A dismissal with no stated reason is a silent drop.');
    return 2;
  }

  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(FINDINGS_FILE, 'utf8'));
  } catch {
    console.error(`[disposition] no findings file. Run: node scripts/gemini-review.js`);
    return 2;
  }

  const f = (doc.findings || []).find(x => x.id === id);
  if (!f) {
    console.error(`[disposition] no finding with id ${id}. Known: ${(doc.findings || []).map(x => x.id).join(', ') || '(none)'}`);
    return 2;
  }

  f.status = status;
  f.reason = status === 'dismissed' ? reason : null;
  fs.writeFileSync(FINDINGS_FILE, JSON.stringify(doc, null, 2));

  const open = (doc.findings || []).filter(x => x.status === 'open').length;
  console.log(`[disposition] ${id} -> ${status}${reason ? `: ${reason}` : ''}`);
  console.log(`[disposition] ${open} finding(s) still open.`);
  return 0;
}

process.exitCode = main();
