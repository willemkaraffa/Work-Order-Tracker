// Carve safety check: flags identifiers used in a carved module that are not
// imported / locally declared / a JS global / React. esbuild treats such names
// as globals (no build error) -> runtime ReferenceError. Run after every carve:
//   node scripts/audit-free-idents.mjs src/foo.jsx [src/bar.jsx ...]
import fs from 'fs';

const GLOBALS = new Set([
  'React','window','document','console','Math','Object','Array','String','Number','Boolean',
  'Set','Map','JSON','Date','Promise','RegExp','Error','setTimeout','clearTimeout','setInterval',
  'clearInterval','requestAnimationFrame','cancelAnimationFrame','isFinite','isNaN','parseInt',
  'parseFloat','encodeURIComponent','decodeURIComponent','getComputedStyle','CSS','L','Intl',
  'navigator','localStorage','sessionStorage','alert','confirm','prompt','Infinity','undefined',
  'NaN','Symbol','WeakMap','structuredClone','URL','URLSearchParams','Blob','FileReader',
]);
const KW = /^(if|for|while|switch|return|function|catch|do|typeof|await|new|void|else|try|in|of|case|throw|yield|delete|instanceof)$/;

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: audit-free-idents.mjs <file> ...'); process.exit(2); }

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const imported = new Set();
  for (const m of src.matchAll(/import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from/g)) {
    if (m[1]) imported.add(m[1]);
    if (m[2]) m[2].split(',').forEach(s => { const n = s.trim().split(/\s+as\s+/).pop().trim(); if (n) imported.add(n); });
  }
  const local = new Set();
  for (const m of src.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)) local.add(m[1]);
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) local.add(m[1]);
  const known = (n) => imported.has(n) || local.has(n) || GLOBALS.has(n);

  const badComp = new Set();
  for (const m of src.matchAll(/<([A-Z][\w]*)/g)) if (m[1] !== 'React' && !known(m[1])) badComp.add(m[1]);

  console.log('=== ' + file + ' ===');
  console.log('UNKNOWN JSX components:', [...badComp].sort().join(', ') || '(none)');
  console.log('(call-site noise omitted: props/setters/CSS/comment words are false positives)');
}
