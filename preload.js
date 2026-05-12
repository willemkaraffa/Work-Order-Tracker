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

// Auto-updater bridge — renderer listens for update events
contextBridge.exposeInMainWorld('updater', {
  onStatus: (cb) => ipcRenderer.on('update-status', (_e, data) => cb(data)),
  install:  ()   => ipcRenderer.invoke('install-update')
});

contextBridge.exposeInMainWorld('isElectron', true);

// Extension import bridge — fires when native host writes orders to disk
contextBridge.exposeInMainWorld('extensionBridge', {
  onImport: (cb) => ipcRenderer.on('extension-import', (_e, orders) => cb(orders)),
  acknowledge: () => ipcRenderer.invoke('import-acknowledged')
});

// Workbook sync bridge
contextBridge.exposeInMainWorld('workbook', {
  sync:      (overridePath) => ipcRenderer.invoke('sync-workbook',    overridePath || ''),
  preflight: (overridePath) => ipcRenderer.invoke('preflight-check',  overridePath || ''),
  choose:    (currentPath)  => ipcRenderer.invoke('choose-workbook',  currentPath  || '')
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

// Credentials bridge — safeStorage-encrypted PM credentials
contextBridge.exposeInMainWorld('creds', {
  set:   (pm, username, password) => ipcRenderer.invoke('creds-set', pm, username, password),
  get:   (pm)                     => ipcRenderer.invoke('creds-get', pm),
  clear: (pm)                     => ipcRenderer.invoke('creds-clear', pm),
});

// Scraper bridge — trigger in-app portal scraping
contextBridge.exposeInMainWorld('scraper', {
  scrapeWO: (woData) => ipcRenderer.invoke('scrape-wo-bids', woData),
});
