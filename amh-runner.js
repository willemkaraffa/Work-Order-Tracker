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

// Persisted AMH session -> Bearer. This is a real Edge USER-DATA-DIR seeded by
// amh-pw-login.js (`npm run amh:login` or the in-app re-login), not the old frozen
// storageState json: AMH rotates its refresh cookie on every login, so the snapshot
// died within a day. Both sides must agree on this path.
function profileDirFor() {
  try { return path.join(app.getPath('userData'), 'amh-edge-profile'); }
  catch (_) { return path.join(__dirname, 'amh-edge-profile'); }
}

// Edge profile lock. The headless mint and the headed re-login both launch Edge on the
// SAME user-data-dir; two at once hit the profile SingletonLock and the second dies
// (GetHandleVerifier). Every profile-touching spawn goes through this one chain.
let profileChain = Promise.resolve();
function withProfileLock(fn) {
  const next = profileChain.then(fn, fn);   // a failed predecessor must not block the queue
  profileChain = next.catch(() => {});
  return next;
}

// Run the scraper for an array of WO numbers. Resolves the parsed result map (with the
// child's stderr hung off it non-enumerably as __stderr -- see spawnCapture);
// rejects on spawn / non-zero exit / unparseable output, or with a coded
// AMH_RELOGIN_REQUIRED error when there is no usable AMH session (see below).
// token: the caller's cached Bearer (main.js ensureToken). Omitted -> mint one here.
function runAmhCapture(woNumbers, token) {
  if (captureInFlight) {
    return Promise.reject(new Error('An AMH capture is already running; wait for it to finish.'));
  }
  captureInFlight = true;
  return acquireTokenAndCapture(woNumbers, token).finally(() => { captureInFlight = false; });
}

// Mint the Bearer in a SYSTEM-node child (amh-pw-token.js CLI) so playwright never
// loads in Electron's Node 18. Resolves the token string; rejects on any failure (no
// session / stale / node-too-old), which the caller maps to AMH_RELOGIN_REQUIRED.
// Async (spawn, not spawnSync): minting can take tens of seconds and this runs on the
// main process, so a sync call would freeze the UI/IPC for the whole login. Packaged:
// the script ships under resourcesPath (asar cannot be executed by system node), same
// as pythonPaths() resolves scrape_amh.py.
function mintToken(profileDir) {
  const script = app.isPackaged
    ? path.join(process.resourcesPath, 'amh-pw-token.js')
    : path.join(__dirname, 'amh-pw-token.js');
  const env = { ...process.env };
  delete env.CHROME_CRASHPAD_PIPE_NAME;
  return new Promise((resolve, reject) => {
    let proc;
    try {
      proc = spawn('node', [script, profileDir], { env, windowsHide: true });
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

// Reliable auth: mint a Bearer from the persisted Edge profile instead of a per-run
// Selenium/Edge login. On a stale or missing session, reject with a coded
// AMH_RELOGIN_REQUIRED so the UI can prompt a re-login (the seeder) and retry. We do
// NOT fall back to Selenium (user decision 2026-08-11: it breaks too often).
const reloginError = (msg) => { const e = new Error('AMH_RELOGIN_REQUIRED: ' + msg); e.code = 'AMH_RELOGIN_REQUIRED'; return e; };

// Mint one Bearer, serialized on the Edge profile. Exported so main.js can mint once
// and cache the token instead of paying an Edge launch per capture.
async function acquireToken() {
  const profileDir = profileDirFor();
  if (!fs.existsSync(profileDir)) {
    throw reloginError('no saved AMH session. Log in to AMH first.');
  }
  try {
    return await withProfileLock(() => mintToken(profileDir));   // system-node playwright; rejects if stale
  } catch (err) {
    throw reloginError(err.message);
  }
}

async function acquireTokenAndCapture(woNumbers, token) {
  const bearer = token || await acquireToken();
  return spawnCapture(woNumbers, bearer);
}

// Spawn scrape_amh.py with the Bearer in AMH_TOKEN. scrape_amh reads AMH_TOKEN and
// skips its Selenium login entirely, so no Edge profile / credentials are involved.
//
// The resolved map carries the child's stderr as a NON-ENUMERABLE `__stderr` (see
// STDERR_KEY): scrape_amh catches its API errors PER WO, prints them to stderr and still
// exits 0, so a Bearer that dies mid-run looks like a normal success with not-ok entries
// and main.js could never tell it apart from "WO not found". stderr is the only evidence.
// Non-enumerable so every existing consumer (results[woNum], Object.entries, JSON/IPC
// structured clone) sees exactly the WO keys it saw before. Do not delete as noise.
const STDERR_KEY = '__stderr';
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
      try {
        const map = JSON.parse(out);
        if (map && typeof map === 'object') {
          Object.defineProperty(map, STDERR_KEY, { value: err, enumerable: false });
        }
        resolve(map);
      }
      catch (e) { reject(new Error('Could not parse Python output: ' + out.slice(0, 200))); }
    });
    // Python may exit (import error) before reading stdin; the 'close' handler
    // reports the real cause, so swallow the write-side EPIPE.
    proc.stdin.on('error', () => {});
    proc.stdin.write(JSON.stringify(woNumbers));
    proc.stdin.end();
  });
}

module.exports = { runAmhCapture, acquireToken, withProfileLock, profileDirFor, STDERR_KEY };
