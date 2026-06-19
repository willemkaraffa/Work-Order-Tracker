# PHASE 10 — Light mode refresh + real Electron tray icon

Execute the tasks below in order. Read every file you touch before editing. No
emojis, no em-dashes. After each task, grep to confirm the change landed.

---

## TASK 0 — Read first (no edits)

Read these to confirm current state before making any change:

1. `index.html` lines 37 to 120 (TT_LIGHT, TT_DARK token blocks)
2. `main.js` (all 345 lines) -- note: there is currently NO `Tray`,
   `nativeImage`, `setOverlayIcon`, or `setBadgeCount` reference anywhere in the
   project. The tray "feature" today is the `TrayDemo` visual mockup in
   `tt-extras.jsx` (design handoff only, not loaded by the renderer).
3. `preload.js` (full file) -- to know where to add the new tray bridge.
4. `assets/icon.png` exists. This is the file to reuse for the tray icon.

Read `redesign-notes.md` Thread 9 (lines 469 to 478) for the tray spec the user
already approved.

---

## TASK 1 — Light mode palette refresh

**Problem:** Current TT_LIGHT uses `#fbfbfc` for surface and `#f4f5f7` for
canvas. Surface is brighter than canvas (panels float on a slightly darker
backdrop) but the absolute lightness is too high and there is zero color cast,
so the mode reads as blinding sterile white. Dark mode by contrast is a quiet
near-black -- the user wants light mode to feel equally calm.

**Fix:** Drop max lightness across the board, introduce a subtle cool-blue cast
(hue 240, chroma 0.005-0.015) so the palette has presence without looking
tinted. Keep the surface > canvas relationship; widen the gap so surface-2 is
clearly a different layer.

Replace the entire `TT_LIGHT` object (lines 38 to 77) with:

```js
const TT_LIGHT = {
  '--bg-canvas':     'oklch(93.5% 0.006 240)',   // ~#e9ebef, soft cool-gray canvas
  '--bg-surface':    'oklch(96.5% 0.005 240)',   // ~#f3f4f7, panels sit slightly brighter
  '--bg-surface-2':  'oklch(90% 0.008 240)',     // ~#dadee4, clearly recessed
  '--bg-hover':      'oklch(91.5% 0.01 240)',    // ~#dee2e8
  '--bg-row-sel':    'oklch(87% 0.045 240)',     // accent-tinted selection
  '--border-1':      'oklch(86% 0.008 240)',     // ~#cdd2d9
  '--border-2':      'oklch(74% 0.012 240)',     // ~#9da4ad
  '--text-1':        'oklch(24% 0.012 240)',     // ~#252a31, not pure black
  '--text-2':        'oklch(46% 0.012 240)',     // ~#5f6772
  '--text-3':        'oklch(62% 0.014 240)',     // ~#878f9a
  '--accent':        'oklch(50% 0.12 240)',
  '--accent-soft':   'oklch(92% 0.055 240)',
  '--accent-fg':     '#ffffff',
  '--age-1':         'oklch(94% 0.025 25)',
  '--age-2':         'oklch(90% 0.05 25)',
  '--age-3':         'oklch(85% 0.075 25)',
  '--flag-emergency':'oklch(55% 0.16 25)',
  '--flag-warranty': 'oklch(52% 0.13 240)',
  '--p-intake':      'oklch(43% 0.02 0)',
  '--p-intake-bg':   'oklch(92% 0.012 0)',
  '--p-await':       'oklch(45% 0.12 70)',
  '--p-await-bg':    'oklch(92% 0.06 70)',
  '--p-approved':    'oklch(42% 0.12 145)',
  '--p-approved-bg': 'oklch(91% 0.06 145)',
  '--p-progress':    'oklch(45% 0.12 240)',
  '--p-progress-bg': 'oklch(91% 0.055 240)',
  '--p-wrap':        'oklch(45% 0.12 290)',
  '--p-wrap-bg':     'oklch(91% 0.05 290)',
  '--p-done':        'oklch(45% 0.04 145)',
  '--p-done-bg':     'oklch(91% 0.022 145)',
  '--p-billing':     'oklch(42% 0.10 200)',
  '--p-billing-bg':  'oklch(91% 0.05 200)',
  '--pm-amh':        'oklch(42% 0.12 145)',
  '--pm-amh-bg':     'oklch(91% 0.06 145)',
  '--pm-msr':        'oklch(45% 0.12 310)',
  '--pm-msr-bg':     'oklch(91% 0.05 310)',
  '--pm-rkt':        'oklch(48% 0.12 50)',
  '--pm-rkt-bg':     'oklch(92% 0.06 50)',
};
```

Do not touch TT_DARK -- the user is happy with it.

After editing, verify with Grep that exactly one `TT_LIGHT = {` definition
exists in `index.html`.

---

## TASK 2 — Tray bridge in preload

Add a tray bridge to `preload.js`. Append after the existing `window.scraper`
block:

```js
// Tray bridge -- main process pushes click events; renderer pushes state.
contextBridge.exposeInMainWorld('tray', {
  setState:  (state)  => ipcRenderer.invoke('tray-set-state', state),
  onAction:  (cb)     => ipcRenderer.on('tray-action', (_e, payload) => cb(payload)),
});
```

`state` shape: `{ enabled: bool, badgeSource: 'attention'|'active'|'off',
attentionCount: number, activeCount: number, recents: [{ id, address }] }`.

`onAction` payload shape: `{ kind: 'open' | 'add' | 'select' | 'quit', wo?:
string }`.

---

## TASK 3 — Tray implementation in main.js

Add to `main.js`. Read the file first to confirm current imports and the
location of `mainWin` / `createWindow`.

### 3a. Extend the top-level import

Change line 1 from:
```js
const { app, BrowserWindow, ipcMain, dialog, globalShortcut, shell, safeStorage } = require('electron');
```
to:
```js
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, globalShortcut, shell, safeStorage } = require('electron');
```

### 3b. Add tray module state

After the `let currentHotkey = ...` line (line ~172), add:

```js
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

  // Windows overlay icon. macOS uses app dock badge; Linux mostly noop.
  if (process.platform === 'win32') {
    if (count > 0) {
      // Tiny red dot overlay; renderer never sees this image so a simple PNG is fine.
      const overlay = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'));
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
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'));
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 16, height: 16 }));
  tray.setToolTip('Trade Tracker');
  tray.on('click', () => {
    showAndFocusMain();
    if (mainWin) mainWin.webContents.send('tray-action', { kind: 'open' });
  });
  rebuildTrayMenu();
}

function destroyTray() {
  if (tray) { try { tray.destroy(); } catch(e) {} tray = null; }
  if (process.platform === 'win32' && mainWin && !mainWin.isDestroyed()) {
    try { mainWin.setOverlayIcon(null, ''); } catch(e) {}
  }
}
```

### 3c. Initialize tray after window creation

Inside `app.whenReady().then(...)` -- after `mainWin = createWindow();` and
`registerGlobalHotkey(...)` -- add:
```js
ensureTray();
```

### 3d. IPC handler for state push

Add near the other `ipcMain.handle(...)` calls (after the
`pause-global-hotkey` / `resume-global-hotkey` handlers, line ~212):

```js
ipcMain.handle('tray-set-state', (_e, state) => {
  trayState = { ...trayState, ...(state || {}) };
  if (trayState.enabled) { ensureTray(); rebuildTrayMenu(); applyTrayBadge(); }
  else destroyTray();
  return true;
});
```

### 3e. Cleanup on quit

In the existing `app.on('will-quit', ...)` handler (line ~196), add inside the
callback after `globalShortcut.unregisterAll()`:
```js
destroyTray();
```

---

## TASK 4 — Renderer side: push tray state when settings or counts change

In `index.html`, find the App component (search for the
`useWorkOrders()` destructure -- currently around line 2960). After the
`syncInterval` settings reader (the block ending with `setSyncInterval`,
roughly line 3310), add a `React.useEffect` that pushes tray state whenever
inputs change.

The renderer already computes `counts` for the sidebar (search for
`const counts` -- it lives in the App component). It also has `selectedWO` and
a list of recent selections is not currently tracked. For Phase 10, recents =
the 5 most-recently selected WOs. Track this with a `React.useState` array,
appended in the existing `setSelectedWO` flow (find every call site -- there
are several -- wrap them so the array stays deduped, length-capped at 5).

Concrete additions:

1. Add state right after `selectedWO`:
```js
const [recentWOs, setRecentWOs] = React.useState([]);
const pushRecent = React.useCallback((id) => {
  if (!id) return;
  setRecentWOs(prev => [id, ...prev.filter(x => x !== id)].slice(0, 5));
}, []);
```

2. Find every `setSelectedWO(...)` call in App and add a `pushRecent(theId)`
   alongside it where `theId` is what was just selected. Skip calls that pass
   `null`.

3. Add a useEffect right after the recents state:
```js
React.useEffect(() => {
  if (!window.tray || !window.tray.setState) return;
  const recents = recentWOs
    .map(id => orders.find(o => o.id === id))
    .filter(Boolean)
    .map(o => ({ id: o.id, address: o.address || '' }));
  const attentionCount = (typeof alerts !== 'undefined' && Array.isArray(alerts)) ? alerts.length : 0;
  const activeCount = orders.filter(o => o.tab === 'active' && !o.deleted).length;
  window.tray.setState({
    enabled: trayEnabled,
    badgeSource: trayBadgeSource,
    attentionCount,
    activeCount,
    recents,
  });
}, [trayEnabled, trayBadgeSource, recentWOs, orders]);
```

   Note: `alerts` may not be in scope. If grep shows `const alerts =` is
   computed downstream of this point, hoist that computation up, or pass
   `attentionCount` from wherever it is computed. Do not invent an
   `attentionCount` -- read the existing alert-computation site and use
   exactly the same length value.

4. Add a second useEffect to react to tray clicks:
```js
React.useEffect(() => {
  if (!window.tray || !window.tray.onAction) return;
  window.tray.onAction((payload) => {
    if (!payload) return;
    if (payload.kind === 'add')    setModal('add');
    if (payload.kind === 'open')   setCurrentView('active');
    if (payload.kind === 'select' && payload.wo) {
      setSelectedWO(payload.wo);
      setCurrentView('active');
    }
  });
}, []);
```

---

## TASK 5 — Verification (no code, just commands)

After all edits, run these Greps and report results:

1. `function hexToRgba` -- must return exactly 1 hit (Phase 9 dedupe check).
2. `TT_LIGHT = {` -- must return exactly 1 hit.
3. `new Tray\(` -- must return exactly 1 hit in `main.js`.
4. `window.tray` -- must return at least 2 hits in `index.html` (setState +
   onAction useEffects) and 1 hit in `preload.js`.
5. `ensureTray\(\)` -- must return at least 2 hits in `main.js` (definition +
   call after `mainWin = createWindow()`).
6. `pushRecent` -- must return at least 2 hits in `index.html` (definition +
   at least one call site).

If any check fails, stop and re-read the surrounding code before patching --
do not guess.

---

## Out of scope for Phase 10 (do NOT do)

- Migration execution logic (Phase 11).
- Real Needs Attention computation from data (Phase 12) -- the renderer
  already has `alerts` somewhere; this phase only reads its length.
- Density wiring, sync-interval timer, per-row syncStatus -- later phases.
- Touching TT_DARK.
- Replacing `assets/icon.png` -- reuse as-is; sizing handled by
  `nativeImage.resize`.

---

## Risk flags (mitigate before committing)

1. **`alerts` scope risk** -- if the variable does not exist where the tray
   useEffect needs it, hoist or rename. Do NOT pass a literal 0 as a
   placeholder. Verify the computation site exists before writing the effect.
2. **Tray icon resolution on HiDPI** -- `assets/icon.png` may be 256x256.
   `resize({ width: 16, height: 16 })` will downscale; on macOS it may look
   soft. Acceptable for v2.0; flag in a comment if a `tray-icon@2x.png` is
   needed later.
3. **Overlay icon path** -- on Windows we reuse `assets/icon.png` as the
   overlay placeholder. This is not a tiny badge dot; it is the full app
   icon. Acceptable for v2.0 since the count itself is what conveys
   information; flag in a comment.
4. **`app.isQuitting` flag** -- referenced in tray Quit menu but not checked
   anywhere else yet. Leave the assignment in; future window-close hide
   behavior will read it.
