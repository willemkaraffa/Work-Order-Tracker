'use strict';
// ESM/JSX -> node CJS bridge for tests. src/*.js(x) use `export`; node tests
// use `require`. esbuild (already a dep) bundles a target module to CJS
// in-memory; we _compile it into a fresh Module and return its real exports.
// This is what kills logic drift: tests import the SHIPPED code, not a copy.
const esbuild = require('esbuild');
const path = require('path');
const Module = require('module');

function loadEsm(relPath) {
  const abs = path.resolve(__dirname, '..', relPath);
  const out = esbuild.buildSync({
    entryPoints: [abs],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    loader: { '.js': 'jsx', '.jsx': 'jsx' },
    write: false,
    logLevel: 'silent',
  });
  const code = out.outputFiles[0].text;
  const m = new Module(abs, module);
  m.filename = abs;
  m.paths = Module._nodeModulePaths(path.dirname(abs));
  m._compile(code, abs);
  return m.exports;
}

module.exports = { loadEsm };
