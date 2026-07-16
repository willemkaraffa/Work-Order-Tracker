'use strict';
// AMH capture runner: spawns scrape_amh.py (headless Edge, token+API) and
// returns its { "<woNum>": { ok, wo, warnings } } result map. Replaces the old
// in-app Electron BrowserWindow scraper (AMH now blocks Chromium-engine
// browsers; the Python path drives real Edge).
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { app } = require('electron');

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

// Run the scraper for an array of WO numbers in ONE login. creds =
// { username, password } | null. Resolves the parsed result map; rejects on
// spawn / non-zero exit / unparseable output.
function runAmhCapture(woNumbers, creds) {
  if (captureInFlight) {
    return Promise.reject(new Error('An AMH capture is already running; wait for it to finish.'));
  }
  captureInFlight = true;
  return new Promise((resolve, reject) => {
    const { python, script } = pythonPaths();
    const env = { ...process.env };
    // Electron injects CHROME_CRASHPAD_PIPE_NAME into its own env. It leaks
    // through the Python child into Selenium's spawned Edge, which then crashes
    // ("Chrome instance exited" / GetHandleVerifier) — but ONLY while a
    // BrowserWindow is open, so a bare CLI run passes and the real app fails.
    // Strip it so the child Edge starts its own crash handler cleanly.
    delete env.CHROME_CRASHPAD_PIPE_NAME;
    // Persistent Edge profile in a writable dir so the AMH session cookie
    // survives runs (SCRIPT_DIR is read-only under resources/ when packaged).
    // scrape_amh.py reads EDGE_PROFILE and passes it as --user-data-dir.
    try { env.EDGE_PROFILE = path.join(app.getPath('userData'), 'edge-amh-profile'); }
    catch (_) { /* app not ready — script falls back to its repo-local dir */ }
    if (creds) {
      if (creds.username) env.AMH_EMAIL    = creds.username;
      if (creds.password) env.AMH_PASSWORD = creds.password;
    }
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
    // Python may exit (import error, profile lock) before reading stdin; the
    // 'close' handler reports the real cause, so swallow the write-side EPIPE.
    proc.stdin.on('error', () => {});
    proc.stdin.write(JSON.stringify(woNumbers));
    proc.stdin.end();
  }).finally(() => { captureInFlight = false; });
}

module.exports = { runAmhCapture };
