'use strict';
// AMH capture runner: spawns scrape_amh.py (headless Edge, token+API) and
// returns its { "<woNum>": { ok, wo, warnings } } result map. Replaces the old
// in-app Electron BrowserWindow scraper (AMH now blocks Chromium-engine
// browsers; the Python path drives real Edge). Spawn mechanism ported from
// scrape-existing-amh.js.
const path = require('path');
const { spawn } = require('child_process');
const { app } = require('electron');

// Resolve interpreter + script. Packaged: bundled embeddable Python + script
// under resources/. Dev: system python + repo script.
function pythonPaths() {
  if (app.isPackaged) {
    const res = process.resourcesPath;
    return { python: path.join(res, 'python', 'python.exe'),
             script: path.join(res, 'scrape_amh.py') };
  }
  return { python: process.platform === 'win32' ? 'python' : 'python3',
           script: path.join(__dirname, 'scrape_amh.py') };
}

// Run the scraper for an array of WO numbers in ONE login. creds =
// { username, password } | null. Resolves the parsed result map; rejects on
// spawn / non-zero exit / unparseable output.
function runAmhCapture(woNumbers, creds) {
  return new Promise((resolve, reject) => {
    const { python, script } = pythonPaths();
    const env = { ...process.env };
    // Electron injects CHROME_CRASHPAD_PIPE_NAME into its own env. It leaks
    // through the Python child into Selenium's spawned Edge, which then crashes
    // ("Chrome instance exited" / GetHandleVerifier) — but ONLY while a
    // BrowserWindow is open, so a bare CLI run passes and the real app fails.
    // Strip it so the child Edge starts its own crash handler cleanly.
    delete env.CHROME_CRASHPAD_PIPE_NAME;
    if (creds) {
      if (creds.username) env.AMH_EMAIL    = creds.username;
      if (creds.password) env.AMH_PASSWORD = creds.password;
    }
    let proc;
    try {
      proc = spawn(python, [script], { stdio: ['pipe', 'pipe', 'pipe'], env, windowsHide: true });
    } catch (e) { return reject(new Error('Could not start Python: ' + e.message)); }

    let out = '', err = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', d => { err += d.toString(); });
    proc.on('error', e => reject(new Error('Python spawn failed: ' + e.message)));
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`Python exited ${code}: ${err.slice(-300)}`));
      try { resolve(JSON.parse(out)); }
      catch (e) { reject(new Error('Could not parse Python output: ' + out.slice(0, 200))); }
    });
    proc.stdin.write(JSON.stringify(woNumbers));
    proc.stdin.end();
  });
}

module.exports = { runAmhCapture };
