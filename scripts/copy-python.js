// Copies the Python scripts into the unpacked dist resources/ directory so
// the installed app picks up edits without a full electron-builder rebuild.
// Mirrors the package.json `build.extraFiles` mapping for dev iteration.
//
// Usage: node scripts/copy-python.js
'use strict';

const fs   = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const FILES = ['sync_to_lookup.py', 'scrape_amh_bids.py', 'preflight_qa.py'];

// dist/win-unpacked/resources/ is where extraFiles lands and what
// process.resourcesPath resolves to inside the unpacked app. When running
// from a worktree (`.claude/worktrees/<name>/`), the dist lives at the
// source root one or more levels up — walk up until we find it.
function findDestDir(start) {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'dist', 'win-unpacked', 'resources');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const DEST_DIR = findDestDir(PROJECT_ROOT);
if (!DEST_DIR) {
  console.error('Could not locate dist/win-unpacked/resources/ from ' + PROJECT_ROOT);
  console.error('Run `npm run build-win` once at the source root to create it, then re-run this.');
  process.exit(1);
}

let copied = 0;
for (const f of FILES) {
  const src = path.join(PROJECT_ROOT, f);
  if (!fs.existsSync(src)) {
    console.error('[skip] missing source: ' + src);
    continue;
  }
  const dst = path.join(DEST_DIR, f);
  fs.copyFileSync(src, dst);
  console.log('[copy] ' + f + ' -> ' + dst);
  copied++;
}
console.log('Copied ' + copied + ' file(s).');
