#!/usr/bin/env node
// Shim. read-router.js advertises `node scripts/ask.js "<q>" <files...>` as the
// sanctioned reader escape (Gemini reads the files, Claude gets the ANSWER), but the
// implementation ships inside the project-overseer package, so the advertised path
// resolved to nothing and the escape 404'd. This forwards to the real script so the
// command the guard prints actually runs, and survives package updates because it
// resolves the target by module id rather than a hard-coded node_modules path.
//
// Re-exec rather than require: the target guards its work behind
// `if (require.main === module)`, which a plain require would never satisfy.
'use strict';
const { spawnSync } = require('child_process');

let target;
try {
  target = require.resolve('project-overseer/scripts/ask.js');
} catch (e) {
  console.error('[ask] cannot locate project-overseer/scripts/ask.js: ' + e.message);
  process.exit(2);
}

const r = spawnSync(process.execPath, [target, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status == null ? 1 : r.status);
