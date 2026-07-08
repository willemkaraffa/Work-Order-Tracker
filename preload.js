const { contextBridge, ipcRenderer } = require('electron');

// Storage API
contextBridge.exposeInMainWorld('storage', {
  get:    (key)        => ipcRenderer.invoke('storage-get', key),
  set:    (key, value) => ipcRenderer.invoke('storage-set', key, value),
  delete: (key)        => ipcRenderer.invoke('storage-delete', key)
});

// CSV export
contextBridge.exposeInMainWorld('electronExport', {
  saveCsv: (content) => ipcRenderer.invoke('export-csv', content)
});

// change11: explicit one-click backup of wo-data.json.
contextBridge.exposeInMainWorld('backup', {
  saveNow: () => ipcRenderer.invoke('backup-data-now'),
  openFolder: () => ipcRenderer.invoke('open-backups-folder'),
});

// Auto-updater bridge — renderer listens for update events
contextBridge.exposeInMainWorld('updater', {
  onStatus: (cb) => ipcRenderer.on('update-status', (_e, data) => cb(data)),
  install:  ()   => ipcRenderer.invoke('install-update'),
  check:    ()   => ipcRenderer.invoke('check-for-updates'),
});

contextBridge.exposeInMainWorld('isElectron', true);

// Extension import bridge — fires when native host writes orders to disk
contextBridge.exposeInMainWorld('extensionBridge', {
  onImport: (cb) => ipcRenderer.on('extension-import', (_e, orders) => cb(orders)),
  acknowledge: () => ipcRenderer.invoke('import-acknowledged'),
  // Ask the extension to scan the open MSR list page for WO numbers; results
  // arrive via onFoundWos. (MSR batch capture was dropped — Aura lazy-render made
  // off-screen scraping unreliable; the user adds new WOs via the on-page button.)
  requestFindNewMsr: () => ipcRenderer.invoke('queue-ext-command', 'findNewMsr'),
  onFoundWos: (cb) => ipcRenderer.on('msr-found', (_e, items) => cb(items)),
});

// Service-item library bridge — xlsx seed / import / export (persistence stays
// in window.storage under key 'service_library').
contextBridge.exposeInMainWorld('library', {
  chooseFile:       ()           => ipcRenderer.invoke('library-choose-file'),
  seedGeneral:      (path)       => ipcRenderer.invoke('library-seed-general', path || ''),
  seedAmh:          (path)       => ipcRenderer.invoke('library-seed-amh', path || ''),
  seedMsr:          ()           => ipcRenderer.invoke('library-seed-msr'),
  importRoundtrip:  (path)       => ipcRenderer.invoke('library-import-roundtrip', path || ''),
  export:           (tabs)       => ipcRenderer.invoke('library-export', tabs),
});

// Focus-search bridge — main process pushes when global hotkey fires
contextBridge.exposeInMainWorld('focusSearchBridge', {
  on: (cb) => ipcRenderer.on('focus-search', () => cb())
});

// Settings bridge — renderer can update the global hotkey at runtime
contextBridge.exposeInMainWorld('settingsBridge', {
  setHotkey: (combo) => ipcRenderer.invoke('set-global-hotkey', combo),
  pauseHotkey: () => ipcRenderer.invoke('pause-global-hotkey'),
  resumeHotkey: () => ipcRenderer.invoke('resume-global-hotkey')
});

// Shell bridge — open URLs in the user's default browser
contextBridge.exposeInMainWorld('shell', {
  openExternal: (url) => ipcRenderer.invoke('open-external', url)
});

// WO folder bridge — create the OneDrive folder tree for a WO (+ MSR bid sheet)
// and reveal it in Explorer. Record = the order { id, pm, type, address }.
contextBridge.exposeInMainWorld('woFolder', {
  // create = ensure-then-open (creates the tree + MSR bid sheet if missing, then opens).
  create:    (record) => ipcRenderer.invoke('wo-create-folder', record),
  subfolder: (record) => ipcRenderer.invoke('wo-create-subfolder', record),
  readBidLineItems: (record) => ipcRenderer.invoke('read-bid-lineitems', record),
});

// Remittance bridge — parse an MSR "Vendor ACH Payment Detail" PDF into per-WO
// rows (invoice-generation Slice 1). filePath optional; omit to open a file dialog.
contextBridge.exposeInMainWorld('remittance', {
  parseMsr: (filePath) => ipcRenderer.invoke('parse-msr-remittance', filePath),
  parseAmh: (filePath) => ipcRenderer.invoke('parse-amh-remittance', filePath),
});

// Credentials bridge — safeStorage-encrypted PM credentials
contextBridge.exposeInMainWorld('creds', {
  set:   (pm, username, password) => ipcRenderer.invoke('creds-set', pm, username, password),
  get:   (pm)                     => ipcRenderer.invoke('creds-get', pm),
  clear: (pm)                     => ipcRenderer.invoke('creds-clear', pm),
});

// Scraper bridge — trigger in-app portal scraping
contextBridge.exposeInMainWorld('scraper', {
  captureWO:     (woData) => ipcRenderer.invoke('capture-wo', woData),
  captureAllAMH: (woNums) => ipcRenderer.invoke('capture-all-amh', woNums),
});

// Tray bridge -- main process pushes click events; renderer pushes state.
contextBridge.exposeInMainWorld('tray', {
  setState:  (state)   => ipcRenderer.invoke('tray-set-state', state),
  onAction:  (cb)      => ipcRenderer.on('tray-action', (_e, payload) => cb(payload)),
  setIcon:   (payload) => ipcRenderer.invoke('tray-set-icon', payload),
});
