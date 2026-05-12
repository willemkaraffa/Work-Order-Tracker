const { app, BrowserWindow, ipcMain, dialog, globalShortcut, shell, safeStorage } = require('electron');
const path   = require('path');
const fs     = require('fs');
const http   = require('http');
const { spawn }      = require('child_process');
const { autoUpdater } = require('electron-updater');
const { scrapeWO }   = require('./scraper');

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

  // WO_DEV_UPDATER=fake injects a synthetic 'available' status so the banner
  // can be exercised in `npm start` without a real release. WO_DEV_UPDATER=real
  // bypasses the isPackaged gate and hits GitHub like a packaged build would.
  const devMode = (process.env.WO_DEV_UPDATER || '').toLowerCase();
  if (devMode === 'fake') {
    setTimeout(() => win.webContents.send('update-status', { status: 'available', version: 'dev-fake' }), 3000);
  } else if (devMode === 'real') {
    setTimeout(() => autoUpdater.checkForUpdates(), 3000);
    setInterval(() => autoUpdater.checkForUpdates(), 4 * 60 * 60 * 1000);
  } else {
    setTimeout(() => { if (app.isPackaged) autoUpdater.checkForUpdates(); }, 3000);
    setInterval(() => { if (app.isPackaged) autoUpdater.checkForUpdates(); }, 4 * 60 * 60 * 1000);
  }
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
let currentHotkey = 'CommandOrControl+Shift+W';

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
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) mainWin = createWindow(); });
});

app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch(e) {} });
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

  // Try 'python' first; fall back to 'python3' (common on Windows where the
  // Store stub redirects or the user installed via python.org with 'python3').
  let out = '', err = '';
  function trySpawn(cmd) {
    const py = spawn(cmd, [scriptPath, wbPath], { windowsHide: true });
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
