const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, globalShortcut, shell, safeStorage } = require('electron');
const path   = require('path');
const fs     = require('fs');
const http   = require('http');
const { autoUpdater } = require('electron-updater');
const { runAmhCapture } = require('./amh-runner');
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

// One-shot command the Chrome extension polls for (GET /command). Set by the
// renderer (e.g. "Capture all MSR" button); cleared when the extension reads it.
let pendingCommand = null;

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

    // Extension polls this; returns + clears any queued command (one-shot).
    if (req.method === 'GET' && req.url === '/command') {
      const cmd = pendingCommand;
      pendingCommand = null;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, command: cmd }));
      return;
    }

    // WO numbers the extension scanned off an MSR list page -> forwarded to the
    // renderer, which diffs them against the tracker and alerts on new ones.
    if (req.method === 'POST' && req.url === '/found-wos') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const d = JSON.parse(body);
          if (win && !win.isDestroyed()) win.webContents.send('msr-found', Array.isArray(d.items) ? d.items : []);
        } catch (e) {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
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

  autoUpdater.on('checking-for-update',   ()  => win.webContents.send('update-status', { status: 'checking' }));
  autoUpdater.on('update-available',   (info) => win.webContents.send('update-status', { status: 'available',    version: info.version }));
  autoUpdater.on('update-not-available',  ()  => win.webContents.send('update-status', { status: 'none' }));
  autoUpdater.on('download-progress', (prog)  => win.webContents.send('update-status', { status: 'downloading', percent: Math.floor(prog.percent) }));
  autoUpdater.on('update-downloaded',  (info) => win.webContents.send('update-status', { status: 'ready',       version: info.version }));
  autoUpdater.on('error',               (err) => { console.log('Updater error:', err.message); win.webContents.send('update-status', { status: 'error', error: err.message }); });

  // Manual "Check for updates" trigger from the renderer (Settings button).
  // Works regardless of app.isPackaged; in dev it surfaces an error via events.
  ipcMain.handle('check-for-updates', async () => {
    try { await autoUpdater.checkForUpdates(); return { ok: true }; }
    catch (e) {
      win.webContents.send('update-status', { status: 'error', error: e.message });
      return { ok: false, error: e.message };
    }
  });

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

// ── Workbook path resolver ────────────────────────────────────────────────────
// The RazorSync sync/preflight pipeline was retired (invoices are now recorded
// in-app). This resolver survives only as the default location for the one-time
// "Seed General" import in library-seed-general (the workbook's "Service Items"
// sheet seeds the service library).
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

ipcMain.handle('import-acknowledged', () => ({ ok: true }));
ipcMain.handle('export-csv', async (_e, csv) => {
  const { canceled, filePath } = await dialog.showSaveDialog({ title: 'Export Work Orders', defaultPath: 'work_orders.csv', filters: [{ name: 'CSV Files', extensions: ['csv'] }] });
  if (canceled || !filePath) return false;
  fs.writeFileSync(filePath, csv, 'utf8');
  return true;
});

// change11: explicit on-demand backup of the live wo-data.json file. Distinct
// from the auto-rotated copies in backups/ (which keep the last 10 writes).
// User picks a path; the live file is copied there. No transformation.
ipcMain.handle('backup-data-now', async () => {
  try {
    if (!fs.existsSync(dataPath)) return { ok: false, error: 'No data file found yet' };
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Back up work order data',
      defaultPath: 'wo-data-backup-' + stamp + '.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    fs.copyFileSync(dataPath, filePath);
    return { ok: true, path: filePath };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

// change11: open the auto-backup folder in the OS file browser.
ipcMain.handle('open-backups-folder', async () => {
  try {
    fs.mkdirSync(backupDir, { recursive: true });
    shell.openPath(backupDir);
    return { ok: true, path: backupDir };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

// ── IPC: WO folder + bid sheet ────────────────────────────────────────────────
// Build the OneDrive folder tree for a WO and (MSR only) drop a pre-filled copy
// of the trade bid skeleton inside it, then reveal the folder in Explorer.
// Structure:
//   MSR -> WORK ORDERS\aMain Street Renewal\<Street Name Number>\WO <num>
//   AMH -> WORK ORDERS\American Homes 4 Rent\<Street Name Number>\WO <num>  (folder only; AMH bids are in-app)
//   else -> WORK ORDERS\Other Customers\<WO id>                              (folder only; deeper subfolder is manual)
// Idempotent: re-running mkdir's are no-ops and an existing bid file is never clobbered.
const WO_ROOT       = () => path.join(app.getPath('home'), 'OneDrive', 'Desktop', 'WORK ORDERS');
const BID_SKELETONS = () => path.join(app.getPath('home'), 'OneDrive', 'Desktop', 'excel', 'PM Bids Excel');
const BID_SKELETON  = { HVAC: 'Gamble Plumbing - MSR HVAC Bid Sheet.xlsx', Plumbing: 'Gamble Plumbing - MSR Plumbing Bid Sheet.xlsx' };
// Verified cell map: label in the column left of the value cell (see scan).
const BID_CELLS     = { HVAC: { sheet: 'Vendor HVAC Bid Sheet', addr: 'C8', date: 'C9' }, Plumbing: { sheet: 'Plumbing - Rough & Finish', addr: 'D5', date: 'D6' } };

function sanitizeName(s) { return String(s || '').replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim(); }
// "3804 Chokecherry Ln" -> "Chokecherry Ln 3804": leading street number to the
// end so folders sort by street name. No leading number -> unchanged.
function reorderForFolder(addr) {
  const m = String(addr || '').trim().match(/^(\d+[A-Za-z]?)\s+(.*)$/);
  return m ? `${m[2]} ${m[1]}` : String(addr || '').trim();
}

function escXml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escRe(s)  { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
// Surgical single-cell set: rewrite only the matched <c> element to an inline
// string, preserving its style attr. hit=false if the cell ref isn't present.
function setSheetCell(xml, ref, val) {
  let hit = false;
  const re = new RegExp('<c r="' + ref + '"([^>]*?)(?:/>|>.*?</c>)', 's');
  const out = xml.replace(re, (_full, attrs) => {
    hit = true;
    const a = attrs.replace(/\s+t="[^"]*"/g, '');   // drop any existing cell-type attr
    return '<c r="' + ref + '"' + a + ' t="inlineStr"><is><t xml:space="preserve">' + escXml(val) + '</t></is></c>';
  });
  return { out, hit };
}
// Patch a bid sheet copy IN PLACE by editing only the target worksheet XML
// inside the xlsx zip; every other entry stays byte-identical. This avoids the
// full-workbook re-serialize exceljs does, which corrupted the Plumbing template
// (Excel "found a problem with some content"). Returns an error string or null.
async function patchBidSheet(dest, sheetName, addrRef, dateRef, addrVal, dateVal) {
  const JSZip = require('jszip');
  const zip   = await JSZip.loadAsync(fs.readFileSync(dest));
  const wb    = await zip.file('xl/workbook.xml').async('string');
  const rels  = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const sm = wb.match(new RegExp('<sheet[^>]*name="' + escRe(escXml(sheetName)) + '"[^>]*?r:id="([^"]+)"'));
  if (!sm) return 'sheet "' + sheetName + '" not in workbook';
  const rt = rels.match(new RegExp('Id="' + sm[1] + '"[^>]*?Target="([^"]+)"'));
  if (!rt) return 'sheet relationship not found';
  const target = 'xl/' + rt[1].replace(/^\/?(xl\/)?/, '');
  let sx = await zip.file(target).async('string');
  const a = setSheetCell(sx, addrRef, addrVal); sx = a.out;
  const b = setSheetCell(sx, dateRef, dateVal); sx = b.out;
  if (!a.hit || !b.hit) return 'cells not found (addr=' + a.hit + ' date=' + b.hit + ')';
  zip.file(target, sx);
  // JSZip infers folder entries on load; the skeleton has none. Drop them so the
  // output entry-set matches the original exactly (only the target sheet differs).
  for (const k of Object.keys(zip.files)) if (zip.files[k].dir) delete zip.files[k];
  fs.writeFileSync(dest, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  return null;
}

// Resolve the WO's root folder path (the WO# folder; or the customer folder for
// non-MSR/AMH, where the WO id field holds the customer name). The first trip's
// bid sheet lives in this folder root; manual "Visit n" subfolders go beneath it.
// Returns { folder } or { error }. Pure (no fs side effects) so create/open/exists share it.
function resolveWoFolder(rec) {
  rec = rec || {};
  const pm  = String(rec.pm || '').toUpperCase();
  const num = String(rec.id || '').replace(/^WO[-\s]*/i, '').trim();
  const root = WO_ROOT();
  if (pm === 'MSR' || pm === 'AMH') {
    const prop = sanitizeName(reorderForFolder(rec.address));
    if (!prop) return { error: 'No address on this work order.' };
    return { folder: path.join(root, pm === 'MSR' ? 'aMain Street Renewal' : 'American Homes 4 Rent', prop, 'WO ' + num) };
  }
  const cust = sanitizeName(rec.id);
  if (!cust) return { error: 'No customer/WO id on this work order.' };
  return { folder: path.join(root, 'Other Customers', cust) };
}

// Gray-out signal for the "Go to folder" menu item — true only if the folder exists on disk.
ipcMain.handle('wo-folder-exists', (_e, rec) => {
  try { const r = resolveWoFolder(rec); return { exists: !!(r.folder && fs.existsSync(r.folder)) }; }
  catch (e) { return { exists: false }; }
});

// Open the WO root folder in Explorer. No create — missing folder reports back so the renderer can toast.
ipcMain.handle('wo-open-folder', (_e, rec) => {
  try {
    const r = resolveWoFolder(rec);
    if (r.error) return { ok: false, error: r.error };
    if (!fs.existsSync(r.folder)) return { ok: false, missing: true, path: r.folder };
    shell.openPath(r.folder);
    return { ok: true, path: r.folder };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});

ipcMain.handle('wo-create-folder', async (_e, rec) => {
  try {
    rec = rec || {};
    const pm  = String(rec.pm || '').toUpperCase();
    const resolved = resolveWoFolder(rec);
    if (resolved.error) return { ok: false, error: resolved.error };
    const folder = resolved.folder;
    fs.mkdirSync(folder, { recursive: true });

    const d  = new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const fileDate = `${dd}-${mm}`;                                   // folder/file: DD-MM (no slashes)
    const cellDate = `${mm}/${dd}/${String(d.getFullYear()).slice(-2)}`; // in-cell text: MM/DD/YY

    let xlsx = null, xlsxSkip = null;
    if (pm === 'MSR') {
      // Dual (Plumbing+HVAC) and HVAC both use the HVAC sheet; pure Plumbing uses Plumbing.
      const trade = /hvac|heat|cool|furnace/i.test(String(rec.type || '')) ? 'HVAC' : 'Plumbing';
      const skel  = path.join(BID_SKELETONS(), BID_SKELETON[trade]);
      if (!fs.existsSync(skel)) {
        xlsxSkip = 'bid skeleton not found: ' + skel;
      } else {
        const name = sanitizeName(rec.address) + ' Bid ' + fileDate + '.xlsx';
        const dest = path.join(folder, name);
        if (!fs.existsSync(dest)) {                 // never clobber an edited bid
          fs.copyFileSync(skel, dest);              // raw copy first -> preserves template byte-for-byte
          const map = BID_CELLS[trade];
          const err = await patchBidSheet(dest, map.sheet, map.addr, map.date, String(rec.address || ''), cellDate);
          if (err) xlsxSkip = err;                  // copy kept (uncorrupted, unfilled) so user can fill manually
        }
        xlsx = dest;
      }
      require('electron-log').info('[wo-create-folder] pm=MSR trade=' + trade + ' skel=' + skel + ' exists=' + fs.existsSync(skel) + ' xlsx=' + xlsx + (xlsxSkip ? ' skip=' + xlsxSkip : ''));
    }
    shell.openPath(folder);
    return { ok: true, path: folder, xlsx, xlsxSkip };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

// Newest Bid/CO .xlsx anywhere under `root` (recursive), skipping `skipDir` and
// Excel temp locks (~$). Matches names containing "Bid" (any case) or "CO"
// (uppercase word = change order). CO sheets are cumulative, so the newest one is
// the current running total. Ranked by CREATION time (birthtime) not mtime, which
// OneDrive/edits bump -- birthtime reflects when each CO was actually made and
// dodges the inconsistent filename date formats. `beforeMs` (start of today)
// excludes files created today, honoring "older than the current date" so a CO
// made earlier today or a same-day bid edit is not the source. Path or null.
function latestBidOrCoSheet(root, skipDir, beforeMs) {
  let best = null;
  const walk = (dir) => {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (p !== skipDir) walk(p); continue; }
      if (!/\.xlsx$/i.test(e.name) || /^~\$/.test(e.name)) continue;
      if (!(/bid/i.test(e.name) || /\bCO\b/.test(e.name))) continue;
      let t; try { const st = fs.statSync(p); t = st.birthtimeMs || st.mtimeMs; } catch (_) { continue; }
      if (beforeMs != null && t >= beforeMs) continue;   // older than the current date
      if (!best || t > best.t) best = { p, t };
    }
  };
  walk(root);
  return best ? best.p : null;
}

// Create a dated subfolder (YYYY-MM-DD) under the WO root and open it. mkdir is
// recursive so the root is created too if it does not exist yet — a revisit can
// be filed without first pressing Create folder.
//
// For MSR, this folder is a CHANGE ORDER: duplicate the FILLED original bid from
// the WO root into it as a CO sheet, re-dated today ("CO" not "Bid", address
// preserved). MSR now requires CO bids to reflect the WO TOTAL, not just the CO
// amount, so the CO must start from the original bid's line items. Non-MSR, or no
// original bid found, leaves an empty dated folder (docs/photos).
ipcMain.handle('wo-create-subfolder', async (_e, rec) => {
  try {
    rec = rec || {};
    const r = resolveWoFolder(rec);
    if (r.error) return { ok: false, error: r.error };
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const sub = path.join(r.folder, stamp);
    fs.mkdirSync(sub, { recursive: true });

    let co = null, coSkip = null;
    if (String(rec.pm || '').toUpperCase() === 'MSR') {
      // MSR change order. CO sheets are CUMULATIVE (each carries the full running
      // total = bid + all prior COs), so the NEWEST existing Bid/CO sheet anywhere
      // in the WO folder tree already reflects the WO total -- copy that one, no
      // line-item merge. Skip the folder we just made and anything created today.
      const startOfToday = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const source = latestBidOrCoSheet(r.folder, sub, startOfToday);
      if (source) {
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const fileDate = `${dd}-${mm}`;
        const cellDate = `${mm}/${dd}/${String(d.getFullYear()).slice(-2)}`;
        const dest = path.join(sub, sanitizeName(rec.address) + ' CO ' + fileDate + '.xlsx');
        if (!fs.existsSync(dest)) {              // never clobber an edited CO
          fs.copyFileSync(source, dest);         // preserves line items + formatting
          const trade = /hvac|heat|cool|furnace/i.test(String(rec.type || '')) ? 'HVAC' : 'Plumbing';
          const map   = BID_CELLS[trade];
          const err   = await patchBidSheet(dest, map.sheet, map.addr, map.date, String(rec.address || ''), cellDate);
          if (err) coSkip = err;                 // copy kept (uncorrupted) for manual date edit
        }
        co = dest;
      }
      require('electron-log').info('[wo-create-subfolder] MSR CO source=' + source + ' co=' + co + (coSkip ? ' skip=' + coSkip : ''));
    }

    shell.openPath(sub);
    return { ok: true, path: sub, co, coSkip };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});

// Parse one OTHER-cell description into individual line items. Each packed cell is
// newline-separated "$<amount> <description>" sub-items (e.g. "$85 Service Call\n
// $145 Labor to clean coil"). Lines without a leading dollar amount are skipped.
// The $amount is the per-item price (the sheet's Total Price column is a formula
// that already excludes the HVAC service call, so parse the amounts instead).
// -> [{desc, unitPrice}].
function parseOtherCell(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^\$?\s*([\d,]+(?:\.\d+)?)\s+(.+?)\s*$/);
    if (!m) continue;
    const price = parseFloat(m[1].replace(/,/g, ''));
    if (!Number.isFinite(price) || price <= 0) continue;
    out.push({ desc: m[2].trim(), unitPrice: Math.round(price * 100) / 100 });
  }
  return out;
}

// Read + parse the OTHER-section line items from one bid/CO sheet. Locate the
// "OTHER" header, find the "Item Description" column by label (Plumbing is offset
// one column from HVAC), then split each OTHER row's packed description into
// individual sub-items via parseOtherCell. Defensive cell access (exceljs `.text`
// can throw on some cell types). -> [{desc, unitPrice, qty}].
async function readSheetOtherItems(file, sheetName) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet(sheetName) || wb.worksheets[0];
  if (!ws) return [];
  const cellText = (row, c) => {
    try {
      const v = row.getCell(c); let t = v.text; if (t == null) t = v.value;
      if (t == null) return '';
      if (typeof t === 'object') {
        if (t.richText) return t.richText.map(x => (x && x.text) || '').join('');
        if ('result' in t) return t.result == null ? '' : String(t.result);
        return '';
      }
      return String(t);
    } catch (_) { return ''; }
  };
  let otherRow = 0; const last = ws.rowCount;
  for (let rn = 1; rn <= last; rn++) {
    const row = ws.getRow(rn);
    for (let c = 1; c <= 12; c++) { if (cellText(row, c).trim().toUpperCase() === 'OTHER') { otherRow = rn; break; } }
    if (otherRow) break;
  }
  if (!otherRow) return [];
  const hdr = ws.getRow(otherRow + 1);
  let cDesc = 0;
  for (let c = 1; c <= 12; c++) { if (cellText(hdr, c).trim().toLowerCase() === 'item description') { cDesc = c; break; } }
  if (!cDesc) return [];
  const items = [];
  for (let rn = otherRow + 2; rn <= last; rn++) {
    const row = ws.getRow(rn);
    let stop = false;
    for (let c = 1; c <= 12; c++) { const u = cellText(row, c).toUpperCase(); if (u.includes('TOTAL OTHER') || u.includes('BID TOTAL')) { stop = true; break; } }
    if (stop) break;
    const desc = cellText(row, cDesc).trim();
    if (!desc) continue;
    for (const it of parseOtherCell(desc)) items.push({ desc: it.desc, unitPrice: it.unitPrice, qty: 1 });
  }
  return items;
}

// All bid/CO .xlsx anywhere under `root` (recursive), skipping temp locks (~$).
function allBidCoSheets(root) {
  const out = [];
  const walk = (dir) => {
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.xlsx$/i.test(e.name) || /^~\$/.test(e.name)) continue;
      if (/bid/i.test(e.name) || /\bCO\b/.test(e.name)) out.push(p);
    }
  };
  walk(root);
  return out;
}

// Capture invoice line items for an MSR WO. MSR line items live in the bid xlsx
// OTHER section, not in order.bidItems (that is AMH API data). Bids are DELTAS, so
// items are spread across every bid/CO sheet in the WO -- read them ALL and dedup
// exact (desc+price) repeats (the copied CO duplicates the sheet it came from).
ipcMain.handle('read-bid-lineitems', async (_e, rec) => {
  try {
    rec = rec || {};
    const r = resolveWoFolder(rec);
    if (r.error) return { ok: false, error: r.error };
    const trade = /hvac|heat|cool|furnace/i.test(String(rec.type || '')) ? 'HVAC' : 'Plumbing';
    const sheetName = BID_CELLS[trade].sheet;
    const seen = new Set(); const items = [];
    for (const f of allBidCoSheets(r.folder)) {
      let rows = [];
      try { rows = await readSheetOtherItems(f, sheetName); } catch (_) { rows = []; }
      for (const it of rows) {
        const k = it.desc.toLowerCase() + '|' + it.unitPrice;
        if (seen.has(k)) continue;
        seen.add(k); items.push(it);
      }
    }
    return { ok: true, items, count: items.length };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
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

// ── IPC: Capture WO (headless Edge token+API via scrape_amh.py) ───────────────
function amhCredential() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const store = readStore();
    const enc = store[CRED_PREFIX + 'AMH'];
    if (!enc) return null;
    return JSON.parse(safeStorage.decryptString(Buffer.from(enc, 'base64')));
  } catch (e) { return null; }
}

function woNumberOf(woData) {
  return String((woData && (woData.woId || woData.id)) || '').replace(/^WO-/i, '').trim();
}

// Single WO. Returns the { ok, wo, warnings } contract the renderer merges.
ipcMain.handle('capture-wo', async (_e, woData) => {
  const pm = String((woData && woData.pm) || '').toUpperCase();
  if (pm === 'MSR') return { ok: false, error: 'MSR work orders import through the Chrome extension, not in-app capture.' };
  if (pm !== 'AMH') return { ok: false, error: `In-app capture supports AMH only (pm "${woData && woData.pm}").` };
  const woNum = woNumberOf(woData);
  if (!woNum) return { ok: false, error: 'WO has no number to locate it on AMH.' };
  try {
    const results = await runAmhCapture([woNum], amhCredential());
    return results[woNum] || { ok: false, error: `WO ${woNum} not returned by AMH scraper.` };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Queue a command for the Chrome extension's next poll (bulk or single MSR
// capture). payload carries any args (e.g. a single WO's portal url).
ipcMain.handle('queue-ext-command', (_e, action, payload) => {
  pendingCommand = { action: String(action || ''), payload: payload || null, ts: Date.now() };
  return { ok: true };
});

// Batch: capture ALL "All Open" (non-Completed) AMH WOs in ONE login. The
// scraper returns every open portal WO keyed by number; the renderer reconciles
// (updates known WOs, imports new ones). Returns { ok, results }.
ipcMain.handle('capture-all-amh', async () => {
  try {
    const results = await runAmhCapture(['__ALL_OPEN__'], amhCredential());
    return { ok: true, results };
  } catch (e) { return { ok: false, error: e.message }; }
});
