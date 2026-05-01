const { app, BrowserWindow, ipcMain, dialog, globalShortcut, shell } = require('electron');
const path   = require('path');
const fs     = require('fs');
const http   = require('http');
const { spawn }      = require('child_process');
const { autoUpdater } = require('electron-updater');

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
          statuses:   data.statuses   || ['Open','In Progress','Parts Pending','Pending-Complete','Closed'],
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
ipcMain.handle('sync-workbook', () => new Promise((resolve) => {
  const scriptPath = app.isPackaged
    ? path.join(process.resourcesPath, 'sync_to_lookup.py')
    : path.join(__dirname, 'sync_to_lookup.py');

  // Workbook lives next to the exe when packaged; fall back to default install
  // dir when running in dev (appData is %APPDATA%, parent is AppData)
  const exeDir = app.isPackaged
    ? path.dirname(app.getPath('exe'))
    : path.join(app.getPath('appData'), '..', 'Local', 'Programs', 'Work Order Tracker');
  const wbPath = path.join(exeDir, 'RazorSync_Invoice_Tracker.xlsx');

  if (!fs.existsSync(scriptPath)) {
    return resolve({ ok: false, out: '', err: `sync_to_lookup.py not found at ${scriptPath}` });
  }

  let out = '', err = '';
  const py = spawn('python', [scriptPath, wbPath], { windowsHide: true });
  py.stdout.on('data', d => { out += d.toString(); });
  py.stderr.on('data', d => { err += d.toString(); });
  py.on('close',  code  => resolve({ ok: code === 0, out, err }));
  py.on('error',  e     => resolve({ ok: false, out, err: e.message }));
}));
ipcMain.handle('import-acknowledged', () => ({ ok: true }));
ipcMain.handle('export-csv', async (_e, csv) => {
  const { canceled, filePath } = await dialog.showSaveDialog({ title: 'Export Work Orders', defaultPath: 'work_orders.csv', filters: [{ name: 'CSV Files', extensions: ['csv'] }] });
  if (canceled || !filePath) return false;
  fs.writeFileSync(filePath, csv, 'utf8');
  return true;
});
