const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, globalShortcut, shell, safeStorage } = require('electron');
const path   = require('path');
const fs     = require('fs');
const http   = require('http');
const { spawn }      = require('child_process');
const { autoUpdater } = require('electron-updater');
const { scrapeWO }   = require('./scraper');
const libraryIO      = require('./library_io');

// Single-instance guard. A second launch focuses the existing window
// instead of trying to spin up another renderer + bridge server.
// Phase 16 surfaced EADDRINUSE on the extension bridge port and
// Chromium cache-lock errors -- both rooted in the second-instance
// not being collapsed into the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}
app.on('second-instance', () => {
  if (mainWin && !mainWin.isDestroyed()) {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.show();
    mainWin.focus();
  }
});

// ── Data storage ──────────────────────────────────────────────────────────────
const dataPath   = path.join(app.getPath('userData'), 'wo-data.json');
const backupDir  = path.join(app.getPath('userData'), 'backups');
const MAX_BACKUPS = 10;

function readStore() {
  try {
    if (fs.existsSync(dataPath)) return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  } catch(e) {}
  return {};
}

function rotateBackups() {
  try {
    if (!fs.existsSync(dataPath)) return;
    fs.mkdirSync(backupDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(backupDir, `wo-data.${ts}.json`);
    fs.copyFileSync(dataPath, dest);

    // Prune oldest beyond MAX_BACKUPS
    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('wo-data.') && f.endsWith('.json'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(backupDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    files.slice(MAX_BACKUPS).forEach(f => {
      try { fs.unlinkSync(path.join(backupDir, f.name)); } catch(e) {}
    });
  } catch(e) {
    console.log('Backup rotation failed (non-fatal):', e.message);
  }
}

function writeStore(store) {
  fs.mkdirSync(path.dirname(dataPath), { recursive: true });
  rotateBackups();
  fs.writeFileSync(dataPath, JSON.stringify(store, null, 2), 'utf8');
}

// ── Local HTTP server for Chrome extension bridge ─────────────────────────────
// Listens on localhost:27843 — extension POSTs work orders here directly.
// No registry, no native host, no bat files needed.
const BRIDGE_PORT = 27843;

function startBridgeServer(win) {
  const server = http.createServer((req, res) => {
    // CORS headers so Chrome extension can POST from any page
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204); res.end(); return;
    }

    if (req.method === 'POST' && req.url === '/import') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const orders = JSON.parse(body);
          if (Array.isArray(orders) && orders.length > 0) {
            if (win && !win.isDestroyed()) {
              win.webContents.send('extension-import', orders);
              win.show();
              win.focus();
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, count: orders.length }));
          } else {
            res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'Empty or invalid orders array' }));
          }
        } catch(e) {
          res.writeHead(400); res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }

    if (req.method === 'GET' && req.url === '/ping') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, status: 'connected', app: 'Work Order Tracker' }));
      return;
    }

    // /config — returns current lists so extension can sync
    if (req.method === 'GET' && req.url === '/config') {
      try {
        const store = readStore();
        const data  = store['wo_data'] ? JSON.parse(store['wo_data']) : {};
        const config = {
          statuses:   data.statuses   || ['Open','Bid Submitted','Bid Approved - Return','Parts Pending','Bid Approved - Complete','Pending-Complete','Closed'],
          priorities: data.priorities || ['High','Medium','Low','Warranty'],
          types:      data.types      || ['HVAC','Plumbing','Electrical','Other'],
          pms:        (data.pms       || []).map(p => p.name || p),
          techs:      data.techs      || [],
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, config }));
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }));
      }
      return;
    }

    res.writeHead(404); res.end();
  });

  server.listen(BRIDGE_PORT, '127.0.0.1', () => {
    console.log(`Extension bridge listening on localhost:${BRIDGE_PORT}`);
  });

  server.on('error', (e) => {
    console.log('Bridge server error (non-fatal):', e.message);
  });

  return server;
}

// ── Auto-updater ──────────────────────────────────────────────────────────────
function setupAutoUpdater(win) {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = require('electron-log');
  autoUpdater.logger.transports.file.level = 'info';

  autoUpdater.on('update-available',   (info) => win.webContents.send('update-status', { status: 'available',    version: info.version }));
  autoUpdater.on('update-not-available',  ()  => win.webContents.send('update-status', { status: 'none' }));
  autoUpdater.on('download-progress', (prog)  => win.webContents.send('update-status', { status: 'downloading', percent: Math.floor(prog.percent) }));
  autoUpdater.on('update-downloaded',  (info) => win.webContents.send('update-status', { status: 'ready',       version: info.version }));
  autoUpdater.on('error',               (err) => { console.log('Updater error:', err.message); win.webContents.send('update-status', { status: 'none' }); });

  setTimeout(() => { if (app.isPackaged) autoUpdater.checkForUpdates(); }, 3000);
  setInterval(() => { if (app.isPackaged) autoUpdater.checkForUpdates(); }, 4 * 60 * 60 * 1000);
}

// ── Window ────────────────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600,
    title: 'Work Order Tracker',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    backgroundColor: '#111111',
    show: false
  });

  win.loadFile('index.html');
  win.once('ready-to-show', () => win.show());
  win.setMenuBarVisibility(false);
  if (!app.isPackaged) win.webContents.openDevTools({ mode: 'detach' });

  setupAutoUpdater(win);
  startBridgeServer(win);

  return win;
}

let mainWin = null;
let cachedBrandIcon = null;
let currentHotkey = 'CommandOrControl+Shift+W';

// ── Tray ──────────────────────────────────────────────────────────────────────
let tray = null;
let trayState = {
  enabled: true,
  badgeSource: 'attention',
  attentionCount: 0,
  activeCount: 0,
  recents: [],
};

function showAndFocusMain() {
  if (!mainWin || mainWin.isDestroyed()) return;
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
}

function rebuildTrayMenu() {
  if (!tray) return;
  const items = [
    { label: 'Add work order...', click: () => { showAndFocusMain(); if (mainWin) mainWin.webContents.send('tray-action', { kind: 'add' }); } },
    { type: 'separator' },
  ];
  if (trayState.recents && trayState.recents.length) {
    items.push({ label: 'Recent', enabled: false });
    trayState.recents.slice(0, 5).forEach(r => {
      const label = `${r.id} -- ${r.address || ''}`.trim();
      items.push({
        label,
        click: () => {
          showAndFocusMain();
          if (mainWin) mainWin.webContents.send('tray-action', { kind: 'select', wo: r.id });
        },
      });
    });
    items.push({ type: 'separator' });
  }
  items.push({ label: 'Open Trade Tracker', click: () => { showAndFocusMain(); if (mainWin) mainWin.webContents.send('tray-action', { kind: 'open' }); } });
  items.push({ label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } });
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

function applyTrayBadge() {
  if (!mainWin || mainWin.isDestroyed()) return;
  const src = trayState.badgeSource;
  let count = 0;
  if (src === 'attention') count = trayState.attentionCount | 0;
  else if (src === 'active') count = trayState.activeCount | 0;
  else count = 0;

  // Windows: overlay icon on taskbar button. macOS: dock badge. Linux: noop.
  // NOTE: On Windows we reuse the brand icon (or assets/icon.png fallback) as
  // the overlay. A dedicated tray-badge.png can replace it later if needed.
  if (process.platform === 'win32') {
    if (count > 0) {
      const overlay = cachedBrandIcon || nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'));
      mainWin.setOverlayIcon(overlay, String(count));
    } else {
      mainWin.setOverlayIcon(null, '');
    }
  } else if (process.platform === 'darwin') {
    app.dock && app.dock.setBadge(count > 0 ? String(count) : '');
  }
  if (tray) tray.setToolTip(count > 0 ? `Trade Tracker -- ${count}` : 'Trade Tracker');
}

function ensureTray() {
  if (tray || !trayState.enabled) return;
  // NOTE: assets/icon.png may be 256x256; resize to 16x16 for tray.
  // On HiDPI macOS this may look soft -- add tray-icon@2x.png later if needed.
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'));
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 16, height: 16 }));
  tray.setToolTip('Trade Tracker');
  tray.on('click', () => {
    showAndFocusMain();
    if (mainWin) mainWin.webContents.send('tray-action', { kind: 'open' });
  });
  rebuildTrayMenu();
}

ipcMain.handle('tray-set-icon', (_event, payload) => {
  if (!tray || tray.isDestroyed()) return false;
  try {
    const x1   = payload && payload.x1;
    const x2   = payload && payload.x2;
    const xWin = payload && payload.xWin;
    if (!x1) return false;
    // x1 is the 1x bitmap (32x32). nativeImage.createFromBuffer
    // reads PNG/JPEG; ArrayBuffer is accepted via Buffer.from.
    const img = nativeImage.createFromBuffer(Buffer.from(x1));
    if (img.isEmpty()) return false;
    // Add HiDPI representation if present.
    if (x2) {
      try {
        img.addRepresentation({ scaleFactor: 2, buffer: Buffer.from(x2) });
      } catch (e) { /* HiDPI add failed -- 1x still works */ }
    }
    tray.setImage(img);
    // xWin is the 256px buffer used for the BrowserWindow icon and overlay.
    if (xWin) {
      try {
        const winImg = nativeImage.createFromBuffer(Buffer.from(xWin));
        if (!winImg.isEmpty()) {
          cachedBrandIcon = winImg;
          if (mainWin && !mainWin.isDestroyed()) {
            try { mainWin.setIcon(winImg); } catch (e) {}
          }
          applyTrayBadge();
        }
      } catch (e) {}
    }
    return true;
  } catch (e) {
    return false;
  }
});

function destroyTray() {
  if (tray) { try { tray.destroy(); } catch(e) {} tray = null; }
  if (process.platform === 'win32' && mainWin && !mainWin.isDestroyed()) {
    try { mainWin.setOverlayIcon(null, ''); } catch(e) {}
  }
}

function registerGlobalHotkey(combo) {
  try { globalShortcut.unregisterAll(); } catch(e) {}
  if (!combo) return false;
  try {
    const ok = globalShortcut.register(combo, () => {
      if (!mainWin || mainWin.isDestroyed()) return;
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.show();
      mainWin.focus();
      mainWin.webContents.send('focus-search');
    });
    if (ok) currentHotkey = combo;
    return ok;
  } catch(e) { console.log('Global shortcut registration failed:', e.message); return false; }
}

app.whenReady().then(() => {
  mainWin = createWindow();
  registerGlobalHotkey(currentHotkey);
  ensureTray();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) mainWin = createWindow(); });
});

app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch(e) {} destroyTray(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ── IPC: Storage ──────────────────────────────────────────────────────────────
ipcMain.handle('storage-get', (_e, key) => {
  try { const s = readStore(); return s[key] !== undefined ? { key, value: s[key] } : null; } catch { return null; }
});
ipcMain.handle('storage-set', (_e, key, value) => {
  try { const s = readStore(); s[key] = value; writeStore(s); return { key, value }; } catch { return null; }
});
ipcMain.handle('storage-delete', (_e, key) => {
  try { const s = readStore(); delete s[key]; writeStore(s); return { key, deleted: true }; } catch { return null; }
});
ipcMain.handle('install-update', () => { autoUpdater.quitAndInstall(false, true); });
ipcMain.handle('set-global-hotkey', (_e, combo) => registerGlobalHotkey(combo));
ipcMain.handle('pause-global-hotkey', () => { try { globalShortcut.unregisterAll(); } catch(e) {} return true; });
ipcMain.handle('resume-global-hotkey', () => registerGlobalHotkey(currentHotkey));
ipcMain.handle('open-external', (_e, url) => { try { shell.openExternal(url); return true; } catch(e) { return false; } });
ipcMain.handle('tray-set-state', (_e, state) => {
  trayState = { ...trayState, ...(state || {}) };
  if (trayState.enabled) { ensureTray(); rebuildTrayMenu(); applyTrayBadge(); }
  else destroyTray();
  return true;
});

// ── IPC: Workbook Sync ────────────────────────────────────────────────────────
function resolveWorkbookPath(overridePath) {
  // Priority: explicit setting -> auto-detect chain.
  if (overridePath && overridePath.trim() && fs.existsSync(overridePath.trim())) {
    return overridePath.trim();
  }
  const userProfile = app.getPath('home');
  const candidates = [
    path.join(userProfile, 'OneDrive', 'Desktop', 'WORK ORDERS', 'RazorSync_Invoice_Tracker.xlsx'),
    app.isPackaged
      ? path.join(path.dirname(app.getPath('exe')), 'RazorSync_Invoice_Tracker.xlsx')
      : path.join(app.getPath('appData'), '..', 'Local', 'Programs', 'Work Order Tracker', 'RazorSync_Invoice_Tracker.xlsx'),
  ];
  return candidates.find(p => fs.existsSync(p)) || (overridePath || candidates[0]);
}

ipcMain.handle('sync-workbook', (_e, overridePath) => new Promise((resolve) => {
  const scriptPath = app.isPackaged
    ? path.join(process.resourcesPath, 'sync_to_lookup.py')
    : path.join(__dirname, 'sync_to_lookup.py');

  const wbPath = resolveWorkbookPath(overridePath);

  if (!fs.existsSync(scriptPath)) {
    return resolve({ ok: false, out: '', err: `sync_to_lookup.py not found at ${scriptPath}` });
  }
  if (!fs.existsSync(wbPath)) {
    return resolve({ ok: false, out: '', err: `Workbook not found at:\n  ${wbPath}\n\nSet the path in Settings -> RazorSync Invoice Tracker Workbook.` });
  }

  // Decrypt stored AMH credentials and pass to Python via environment variables
  let spawnEnv = process.env;
  try {
    const store = readStore();
    const enc = store[CRED_PREFIX + 'AMH'];
    if (enc && safeStorage.isEncryptionAvailable()) {
      const creds = JSON.parse(safeStorage.decryptString(Buffer.from(enc, 'base64')));
      if (creds && creds.username) {
        spawnEnv = { ...process.env, AMH_EMAIL: creds.username, AMH_PASSWORD: creds.password || '' };
      }
    }
  } catch (e) { /* no creds stored or decrypt failed — Python falls back to defaults */ }

  // Try 'python' first; fall back to 'python3' (common on Windows where the
  // Store stub redirects or the user installed via python.org with 'python3').
  let out = '', err = '';
  function trySpawn(cmd) {
    const py = spawn(cmd, [scriptPath, wbPath], { windowsHide: true, env: spawnEnv });
    py.stdout.on('data', d => { out += d.toString(); });
    py.stderr.on('data', d => { err += d.toString(); });
    py.on('close', code => resolve({ ok: code === 0, out, err }));
    py.on('error', e => {
      if (cmd === 'python' && e.code === 'ENOENT') {
        // 'python' not found — retry with 'python3'
        out = ''; err = '';
        trySpawn('python3');
      } else {
        const hint = e.code === 'ENOENT'
          ? 'Python not found. Install Python 3 and ensure "python" or "python3" is on your PATH.'
          : e.message;
        resolve({ ok: false, out, err: hint });
      }
    });
  }
  trySpawn('python');
}));

ipcMain.handle('preflight-check', (_e, overridePath) => new Promise((resolve) => {
  // Mirrors sync-workbook resolution but runs preflight_qa.py --json instead.
  const scriptPath = app.isPackaged
    ? path.join(process.resourcesPath, 'preflight_qa.py')
    : path.join(__dirname, 'preflight_qa.py');

  const wbPath = resolveWorkbookPath(overridePath);

  if (!fs.existsSync(scriptPath)) {
    return resolve({ ok: false, error: `preflight_qa.py not found at ${scriptPath}` });
  }
  if (!fs.existsSync(wbPath)) {
    return resolve({ ok: false, error: `Workbook not found at:\n  ${wbPath}\n\nSet the path in Settings.` });
  }

  let out = '', err = '';
  function trySpawn(cmd) {
    const py = spawn(cmd, [scriptPath, '--json', wbPath], { windowsHide: true });
    py.stdout.on('data', d => { out += d.toString(); });
    py.stderr.on('data', d => { err += d.toString(); });
    py.on('close', code => {
      if (code !== 0) return resolve({ ok: false, error: err.slice(-500) || `Python exited ${code}` });
      try {
        const parsed = JSON.parse(out.trim().split('\n').pop());
        resolve(parsed);
      } catch (e) {
        resolve({ ok: false, error: 'Could not parse preflight output: ' + out.slice(0, 200) });
      }
    });
    py.on('error', e => {
      if (cmd === 'python' && e.code === 'ENOENT') { out = ''; err = ''; trySpawn('python3'); }
      else resolve({ ok: false, error: e.code === 'ENOENT' ? 'Python not found on PATH.' : e.message });
    });
  }
  trySpawn('python');
}));

ipcMain.handle('choose-workbook', async (_e, currentPath) => {
  const defaultDir = currentPath && fs.existsSync(path.dirname(currentPath))
    ? path.dirname(currentPath)
    : path.join(app.getPath('home'), 'OneDrive', 'Desktop', 'WORK ORDERS');
  const result = await dialog.showOpenDialog({
    title: 'Select RazorSync Invoice Tracker Workbook',
    defaultPath: defaultDir,
    filters: [{ name: 'Excel Workbook', extensions: ['xlsx', 'xlsm'] }],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths || !result.filePaths.length) return { path: '' };
  return { path: result.filePaths[0] };
});

ipcMain.handle('import-acknowledged', () => ({ ok: true }));
ipcMain.handle('export-csv', async (_e, csv) => {
  const { canceled, filePath } = await dialog.showSaveDialog({ title: 'Export Work Orders', defaultPath: 'work_orders.csv', filters: [{ name: 'CSV Files', extensions: ['csv'] }] });
  if (canceled || !filePath) return false;
  fs.writeFileSync(filePath, csv, 'utf8');
  return true;
});

// ── IPC: Service-item Library (xlsx seed / import / export via exceljs) ───────
// Renderer owns persistence (window.storage key 'service_library'); main only
// does the xlsx file I/O. All handlers return { ok, ... } and never throw.
const AMH_DEFAULT = path.join(app.getPath('home'), 'OneDrive', 'Desktop', 'excel', 'MSR Excel', 'AMH Premier Pricing All scopes.xlsx');

ipcMain.handle('library-choose-file', async () => {
  const r = await dialog.showOpenDialog({
    title: 'Select spreadsheet',
    filters: [{ name: 'Excel Workbook', extensions: ['xlsx', 'xlsm'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths || !r.filePaths.length) return { ok: false, canceled: true };
  return { ok: true, path: r.filePaths[0] };
});

ipcMain.handle('library-seed-general', async (_e, overridePath) => {
  try {
    const wbPath = (overridePath && overridePath.trim()) ? overridePath.trim() : resolveWorkbookPath('');
    if (!fs.existsSync(wbPath)) return { ok: false, error: `Workbook not found at:\n  ${wbPath}` };
    return { ok: true, items: await libraryIO.parseGeneral(wbPath), path: wbPath };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('library-seed-amh', async (_e, overridePath) => {
  try {
    const p = (overridePath && overridePath.trim()) ? overridePath.trim() : AMH_DEFAULT;
    if (!fs.existsSync(p)) return { ok: false, error: `AMH pricing file not found at:\n  ${p}` };
    return { ok: true, items: await libraryIO.parseAmh(p), path: p };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('library-import-roundtrip', async (_e, filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: 'File not found.' };
    return { ok: true, tabs: await libraryIO.parseRoundtrip(filePath) };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('library-export', async (_e, tabs) => {
  try {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export Service Library',
      defaultPath: 'Service Library.xlsx',
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    await libraryIO.exportLibrary(filePath, tabs || {});
    return { ok: true, path: filePath };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ── IPC: Credentials (safeStorage encrypted) ─────────────────────────────────
const CRED_PREFIX = 'cred_';

const PM_RE = /^[A-Z0-9]{1,20}$/;
function validPm(pm) { return typeof pm === 'string' && PM_RE.test(pm.toUpperCase()); }

ipcMain.handle('creds-set', (_e, pm, username, password) => {
  if (!validPm(pm)) return { ok: false, error: 'Invalid PM name' };
  try {
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'Encryption unavailable on this system' };
    const payload = JSON.stringify({ username, password });
    const encrypted = safeStorage.encryptString(payload).toString('base64');
    const store = readStore();
    store[CRED_PREFIX + pm.toUpperCase()] = encrypted;
    writeStore(store);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('creds-get', (_e, pm) => {
  if (!validPm(pm)) return null;
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const store = readStore();
    const enc = store[CRED_PREFIX + pm.toUpperCase()];
    if (!enc) return null;
    const payload = safeStorage.decryptString(Buffer.from(enc, 'base64'));
    return JSON.parse(payload);
  } catch (e) { console.warn('Credential decryption failed:', e.message); return null; }
});

ipcMain.handle('creds-clear', (_e, pm) => {
  if (!validPm(pm)) return { ok: false, error: 'Invalid PM name' };
  try {
    const store = readStore();
    delete store[CRED_PREFIX + pm.toUpperCase()];
    writeStore(store);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ── IPC: Scrape WO bids ───────────────────────────────────────────────────────
ipcMain.handle('scrape-wo-bids', async (_e, woData) => {
  async function getCredential(pm) {
    try {
      if (!safeStorage.isEncryptionAvailable()) return null;
      const store = readStore();
      const enc = store[CRED_PREFIX + pm.toUpperCase()];
      if (!enc) return null;
      const payload = safeStorage.decryptString(Buffer.from(enc, 'base64'));
      return JSON.parse(payload);
    } catch (e) { return null; }
  }
  return scrapeWO(woData, getCredential);
});
