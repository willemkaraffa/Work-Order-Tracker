'use strict';
// AMH capture runner: spawns scrape_amh.py (headless Edge, token+API) and
// returns its { "<woNum>": { ok, wo, warnings } } result map. Replaces the old
// in-app Electron BrowserWindow scraper (AMH now blocks Chromium-engine
// browsers; the Python path drives real Edge).
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const { app } = require('electron');
// NOTE: do NOT require('./amh-pw-token') here -- it requires playwright, which needs
// Node 20+, and Electron 28 bundles Node 18. Loading it in-process crashes the app at
// boot. It runs as a spawned SYSTEM-node child instead (mintToken below).

// Resolve interpreter + script. Packaged: bundled embeddable Python + script
// under resources/. Dev: system python + repo script.
function pythonPaths() {
  // Use pythonW.exe (console-LESS) on Windows: Electron is a GUI process with no
  // console, so spawning python.exe (a console subsystem app) gives it a NEW black
  // console window for the whole capture, and Node's windowsHide is unreliable in the
  // no-console-parent case. pythonw round-trips the piped stdin/stdout scrape protocol
  // fine (proven). Paired with scrape_amh.py --headless=old (which drops the layered
  // DirectComposition overlay), this leaves NO visible surface during capture.
  if (app.isPackaged) {
    const res = process.resourcesPath;
    return { python: path.join(res, 'python', 'pythonw.exe'),
             script: path.join(res, 'scrape_amh.py') };
  }
  return { python: process.platform === 'win32' ? 'pythonw' : 'python3',
           script: path.join(__dirname, 'scrape_amh.py') };
}

// Single-flight: captures now share ONE persistent Edge profile (see
// EDGE_PROFILE below). Two concurrent Edge on the same --user-data-dir hit the
// profile SingletonLock and the second crashes, so serialize — reject a second
// capture while one is running rather than corrupt the profile.
let captureInFlight = false;

// Quitting the app mid-capture kills nothing by itself: the Python child keeps
// running, and the Edge IT drives outlives both and keeps holding the profile's
// SingletonLock. Every later capture then dies at Edge launch (GetHandleVerifier)
// until someone kills the orphan by hand. Kill the whole child TREE on quit
// (taskkill /T reaches python -> msedgedriver -> msedge), so the crash never
// happens. scrape_amh.clear_stale_profile is the other half: it heals orphans
// that got past this (hard kill, power loss).
let activeProc = null;
function killActiveCapture() {
  const proc = activeProc;
  if (!proc) return;
  activeProc = null;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true });
    } else {
      proc.kill('SIGKILL');
    }
  } catch (_) { /* quitting anyway; nothing useful to do */ }
}
// Registered at require time: app.on works before ready, and 'before-quit' fires
// early enough to still have a live pid.
try { app.on('before-quit', killActiveCapture); } catch (_) {}

// Persisted AMH session -> Bearer, saved by amh-pw-login.js (`npm run amh:login`
// or the in-app re-login). Both sides must agree on this path.
function statePathFor() {
  try { return path.join(app.getPath('userData'), 'amh-pw-state.json'); }
  catch (_) { return path.join(__dirname, 'amh-pw-state.json'); }
}

// Run the scraper for an array of WO numbers. Resolves the parsed result map;
// rejects on spawn / non-zero exit / unparseable output, or with a coded
// AMH_RELOGIN_REQUIRED error when there is no usable AMH session (see below).
function runAmhCapture(woNumbers) {
  if (captureInFlight) {
    return Promise.reject(new Error('An AMH capture is already running; wait for it to finish.'));
  }
  captureInFlight = true;
  return acquireTokenAndCapture(woNumbers).finally(() => { captureInFlight = false; });
}

// Mint the Bearer in a SYSTEM-node child (amh-pw-token.js CLI) so playwright never
// loads in Electron's Node 18. Resolves the token string; rejects on any failure (no
// session / stale / node-too-old), which the caller maps to AMH_RELOGIN_REQUIRED.
// Async (spawn, not spawnSync): minting can take tens of seconds and this runs on the
// main process, so a sync call would freeze the UI/IPC for the whole login. Packaged:
// the script ships under resourcesPath (asar cannot be executed by system node), same
// as pythonPaths() resolves scrape_amh.py.
function mintToken(statePath) {
  const script = app.isPackaged
    ? path.join(process.resourcesPath, 'amh-pw-token.js')
    : path.join(__dirname, 'amh-pw-token.js');
  const env = { ...process.env };
  delete env.CHROME_CRASHPAD_PIPE_NAME;
  return new Promise((resolve, reject) => {
    let proc;
    try {
      proc = spawn('node', [script, statePath], { env, windowsHide: true });
    } catch (e) { return reject(new Error('token minter failed to start: ' + e.message)); }
    // Register for before-quit kill: the minter child launches its own Edge, which
    // would orphan and hold the profile SingletonLock if the app quits mid-mint.
    activeProc = proc;
    let out = '', err = '';
    const timer = setTimeout(() => { try { proc.kill(); } catch (_) {} reject(new Error('token minter timed out')); }, 90000);
    proc.stdout.on('data', d => { out += d; });
    proc.stderr.on('data', d => { err += d; });
    proc.on('error', e => { clearTimeout(timer); if (activeProc === proc) activeProc = null; reject(new Error('token minter failed to start: ' + e.message)); });
    proc.on('close', code => {
      clearTimeout(timer);
      if (activeProc === proc) activeProc = null;
      const token = out.trim();
      if (code !== 0 || !token.startsWith('Bearer ')) {
        return reject(new Error(err.trim() || 'token minter exited ' + code));
      }
      resolve(token);
    });
  });
}

// Reliable auth: mint a Bearer from the persisted Playwright session instead of a
// per-run Selenium/Edge login. On a stale or missing session, reject with a coded
// AMH_RELOGIN_REQUIRED so the UI can prompt a re-login (the seeder) and retry. We do
// NOT fall back to Selenium (user decision 2026-08-11: it breaks too often).
async function acquireTokenAndCapture(woNumbers) {
  const statePath = statePathFor();
  const relogin = (msg) => { const e = new Error('AMH_RELOGIN_REQUIRED: ' + msg); e.code = 'AMH_RELOGIN_REQUIRED'; return e; };
  if (!fs.existsSync(statePath)) {
    throw relogin('no saved AMH session. Log in to AMH first.');
  }
  let token;
  try {
    token = await mintToken(statePath);   // spawns system-node playwright; rejects if stale
  } catch (err) {
    throw relogin(err.message);
  }
  return spawnCapture(woNumbers, token);
}

// Spawn scrape_amh.py with the Bearer in AMH_TOKEN. scrape_amh reads AMH_TOKEN and
// skips its Selenium login entirely, so no Edge profile / credentials are involved.
function spawnCapture(woNumbers, token) {
  return new Promise((resolve, reject) => {
    const { python, script } = pythonPaths();
    const env = { ...process.env };
    // Harmless here (Python does no browser work on the token path), but keep the
    // crashpad strip so a future Selenium fallback cannot regress silently.
    delete env.CHROME_CRASHPAD_PIPE_NAME;
    env.AMH_TOKEN = token;
    let proc;
    try {
      proc = spawn(python, [script], { stdio: ['pipe', 'pipe', 'pipe'], env, windowsHide: true });
    } catch (e) { return reject(new Error('Could not start Python: ' + e.message)); }
    activeProc = proc;

    let out = '', err = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', d => { err += d.toString(); });
    proc.on('error', e => reject(new Error('Python spawn failed: ' + e.message)));
    proc.on('close', code => {
      activeProc = null;
      if (code !== 0) return reject(new Error(`Python exited ${code}: ${err.slice(-300)}`));
      try { resolve(JSON.parse(out)); }
      catch (e) { reject(new Error('Could not parse Python output: ' + out.slice(0, 200))); }
    });
    // Python may exit (import error) before reading stdin; the 'close' handler
    // reports the real cause, so swallow the write-side EPIPE.
    proc.stdin.on('error', () => {});
    proc.stdin.write(JSON.stringify(woNumbers));
    proc.stdin.end();
  });
}

module.exports = { runAmhCapture };
