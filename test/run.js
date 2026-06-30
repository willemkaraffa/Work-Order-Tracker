'use strict';
// Test runner. Globs test/*.test.js, runs each as a child, collects exit codes.
// Exit-code contract per test: 0 = pass, 1 = fail, 2 = SKIP (e.g. fixtures absent).
// Runner exits non-zero only when a test FAILS (skips do not fail the gate).
//   node test/run.js            run everything
//   node test/run.js --logic    fixture-free tests only (portable, always runnable)
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const onlyLogic = process.argv.includes('--logic');

// Tests that read DOM dumps from test/fixtures/. They self-SKIP (exit 2) when
// fixtures are absent; --logic excludes them up front.
const FIXTURE_TESTS = new Set([
  'extract.test.js', 'full-flow.test.js', 'contacts.test.js',
  'expand-static.test.js', 'wo9718400.test.js',
]);

const files = fs.readdirSync(DIR)
  .filter(f => f.endsWith('.test.js'))
  .filter(f => !(onlyLogic && FIXTURE_TESTS.has(f)))
  .sort();

let pass = 0, fail = 0, skip = 0;
const failed = [];
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(DIR, f)], { encoding: 'utf8' });
  if (r.status === 0)      { pass++; console.log(`PASS ${f}`); }
  else if (r.status === 2) { skip++; console.log(`SKIP ${f} (fixtures absent)`); }
  else {
    fail++; failed.push(f);
    console.log(`FAIL ${f}`);
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
  }
}

console.log(`\n${pass} pass, ${fail} fail, ${skip} skip`);
if (fail) { console.log('Failed: ' + failed.join(', ')); process.exit(1); }
