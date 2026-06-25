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
  // Queue a command the Chrome extension picks up on its next poll (e.g. bulk
  // MSR capture). Results return via the normal /import -> extension-import path.
  requestMsrCapture: () => ipcRenderer.invoke('queue-ext-command', 'captureMsrAll'),
});

// Service-item library bridge — xlsx seed / import / export (persistence stays
// in window.storage under key 'service_library').
contextBridge.exposeInMainWorld('library', {
  chooseFile:       ()           => ipcRenderer.invoke('library-choose-file'),
  seedGeneral:      (path)       => ipcRenderer.invoke('library-seed-general', path || ''),
  seedAmh:          (path)       => ipcRenderer.invoke('library-seed-amh', path || ''),
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
  create: (record) => ipcRenderer.invoke('wo-create-folder', record)
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
