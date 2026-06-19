# PHASE 18 -- Brand window + overlay icons, fix landing flash, cleanup

Execute tasks in order. Read every file you touch before editing. No
emojis, no em-dashes. After each task, grep to confirm.

**Precondition:** Phases 10 through 17 applied. Confirm via the
preflight greps in TASK 0.

**Platform:** Windows only. Do not touch `process.platform ===
'darwin'` branches.

---

## Why this phase (read first)

Three release-prep items. None overlaps with the others; rolled
together because each is small and they share the verification cycle.

1. **Window icon + Windows taskbar overlay still generic.** Phase 16
   branded the tray icon by runtime-rasterizing `GambleMark` and
   piping the PNG to main via IPC. The BrowserWindow `icon:` on
   `main.js` line 150 and the overlay `nativeImage.createFromPath(...
   'icon.png')` inside `applyTrayBadge` (line 230, post-Phase-17
   offset shift) still load the generic `assets/icon.png`. Extend
   the Phase 16 mechanism: add a 256 px buffer to the existing
   `tray-set-icon` IPC payload, swap the window icon via
   `mainWin.setIcon(img)`, and cache the same `nativeImage` for
   `applyTrayBadge` to reuse for `mainWin.setOverlayIcon`.

2. **Launch landing flashes the main UI for one frame.** Phase 15
   moved the gate to per-session `sessionStorage` but kept the
   pattern `useState(false) + useEffect -> setState(true)`. That
   means frame 1 paints with `showLanding=false`, then the effect
   fires and frame 2 paints the landing on top. Result: a visible
   flash of the main app or its loading shimmer before the landing
   appears. Worse, the landing's outer container starts at
   `opacity: 0` (`index.html` line 3133) and fades in over 600 ms --
   so the main UI behind the landing remains visible for nearly a
   full second during the fade. Fix: synchronous lazy
   `useState(() => ...)` initializer so the landing is true on the
   very first paint, AND keep the outer container fully opaque from
   frame 1 (only inner content fades in for the artistic stagger).
   While we are in `FullScreenLanding`, also show
   "Loading work orders..." in the alerts slot while
   `loading === true` so the landing genuinely doubles as a splash.

3. **Stale `// TODO Phase 15` comment** at `index.html` line 3671
   (post-Phase-17 offset; was 3661 in Phase 17 docs -- the line
   shifted by the new `runPreflight` callback insert). The feature
   it pointed at shipped in Phase 15 + Phase 17. Comment is dead;
   remove.

### Out of scope (do NOT do)

- `assets/icon.ico` for the NSIS installer. NSIS reads this file at
  install time, before the renderer can run. Cannot be rasterized at
  runtime. Either ship the existing generic .ico for v2.7 or
  generate a multi-res ICO from `GambleMark` via an external tool;
  the user will decide.
- macOS dock icon, menu-bar template variant, or
  `process.platform === 'darwin'` branches.
- Replacing `BrowserWindow({ icon: ... })` literal path. Let the
  `setIcon(img)` call AFTER the renderer mounts do the upgrade. The
  initial `icon.png` is the fallback during the ~50-300 ms before
  the renderer reports in. Same fallback pattern Phase 16 uses for
  the tray.
- Touching `nativeImage.createFromPath(... 'icon.png')` calls
  outside `applyTrayBadge`. There may be others; this phase only
  guarantees the overlay is branded.
- Rewriting the FullScreenLanding inner-content animation. The
  staggered fade-in stays exactly as it is.

---

## TASK 0 -- Read first (no edits)

Architect findings documented for speed; you still MUST open each
region to confirm before editing.

### Confirmed locations (verified at phase18.md authoring time)

1. **Landing gate** -- `index.html` line 3702. The `useState(false)`
   plus `useEffect(...)` block runs lines 3702 to 3714.

2. **`FullScreenLanding`** -- declared at `index.html` line 3107.
   Outer container is the `<div>` at line 3127. Its
   `opacity: (mounted && !leaving) ? 1 : 0` is line 3133. The inner
   blocks (brand, "Welcome back", alerts, proceed button) each have
   their own `opacity: (mounted && !leaving) ? 1 : 0` and stagger
   timings -- those STAY.

3. **Alerts empty state inside FullScreenLanding** -- lines 3193 to
   3197. Currently shows "Nothing flagged today." regardless of
   loading state. This is the splash-message location.

4. **Landing render site in App** -- `index.html` line 4399.
   Currently passes `alerts`, `onProceed`, `onSelectWO`. We add
   `loading`.

5. **Phase 16 renderer rasterization effect** -- `index.html` line
   ~3620 (post-Phase-17 offset; was line 3611 in Phase 16 docs).
   Search `renderGambleMarkPng(32)` to find it. Currently produces
   `buf32 + buf64`; we extend to also produce `buf256`.

6. **Phase 16 `tray-set-icon` IPC handler** -- `main.js`. Search
   `ipcMain.handle('tray-set-icon'`. Extend to also accept `xWin`
   in the payload.

7. **`applyTrayBadge`** -- `main.js` line ~230 (Phase 17 shifted
   lines but the body shape is unchanged). Reads `icon.png` for the
   overlay; we swap to `cachedBrandIcon` when populated.

8. **`mainWin` declaration** -- `main.js` line 171
   `let mainWin = null;` -- module level. Phase 16 confirmed. The
   `cachedBrandIcon` will sit at the same scope.

9. **Stale TODO** -- `index.html` line 3671. Single comment line.
   Delete only the comment; leave the `await window.storage.set(...)`
   call.

### Reads you still owe

1. `index.html` lines 3105-3200 (`FullScreenLanding`).
2. `index.html` lines 3700-3720 (gate region).
3. `index.html` lines 3610-3640 (Phase 16 effect site).
4. `index.html` lines 3665-3680 (stale TODO).
5. `index.html` lines 4395-4410 (landing render site).
6. `main.js` lines 215-300 (`applyTrayBadge`, `ensureTray`, the
   Phase 16 `tray-set-icon` handler).
7. `main.js` lines 165-180 (`mainWin` declaration scope).

### Regression preflight (REQUIRED)

STOP if any fail:

- `requestSingleInstanceLock` in `main.js` -- exactly 1 hit (Phase 17).
- `ipcMain.handle\('tray-set-icon'` in `main.js` -- exactly 1 hit
  (Phase 16).
- `'preflight-check'` in `main.js` -- exactly 1 hit (Phase 17).
- `function PreflightModal` in `index.html` -- exactly 1 hit
  (Phase 17).
- `renderGambleMarkPng` in `index.html` -- exactly 3 hits (Phase 16).
- `sessionStorage.getItem\('tt-seen-launch'\)` in `index.html` --
  exactly 1 hit (Phase 15).
- `function migrateOrders` in `index.html` -- exactly 1 hit
  (Phase 11).

---

## TASK 1 -- Brand the window icon + Windows taskbar overlay

Extends Phase 16's renderer-rasterize-and-IPC mechanism. The single
`tray-set-icon` channel now also carries a 256 px buffer used for
the window icon AND cached for `applyTrayBadge`'s overlay.

### 1a. Renderer: produce a 256 px buffer alongside 32 + 64

Find the Phase 16 effect that calls `renderGambleMarkPng(32)` and
`renderGambleMarkPng(64)`. Currently around line 3620 (post-Phase-17
offset; was 3611 in Phase 16 docs). Replace the body of the effect:

```js
React.useEffect(() => {
  let cancelled = false;
  (async () => {
    if (!window.tray || !window.tray.setIcon) return;
    try {
      // 32 + 64 feed the tray (1x + 2x). 256 feeds the BrowserWindow
      // icon AND the Windows taskbar overlay (re-used out of a main
      // process cache). One IPC roundtrip; one source of truth.
      const buf32  = await renderGambleMarkPng(32);
      const buf64  = await renderGambleMarkPng(64);
      const buf256 = await renderGambleMarkPng(256);
      if (cancelled) return;
      if (buf32 && buf64 && buf256) {
        window.tray.setIcon({ x1: buf32, x2: buf64, xWin: buf256 });
      }
    } catch (e) {
      // Swallow: cosmetic upgrade, fallback icon remains.
    }
  })();
  return () => { cancelled = true; };
}, []);
```

Notes:
- `renderGambleMarkPng` already accepts any pixel size; no changes
  needed to that helper.
- 256 px PNG of the GambleMark vector compresses to a few KB. IPC
  payload total ~30 KB; negligible.

### 1b. Main: cache the branded icon at module scope

Find `let mainWin = null;` (main.js line 171). Add directly below:

```js
// Phase 18: cached nativeImage of the GambleMark, produced by the
// renderer and shipped via tray-set-icon. Used as both the
// BrowserWindow icon (mainWin.setIcon) and the Windows taskbar
// overlay (mainWin.setOverlayIcon). Null until the renderer reports
// in -- consumers must fall back to assets/icon.png.
let cachedBrandIcon = null;
```

### 1c. Main: extend the `tray-set-icon` handler

Find `ipcMain.handle('tray-set-icon', ...)`. Phase 16 wrote it as:

```js
ipcMain.handle('tray-set-icon', (_event, payload) => {
  if (!tray || tray.isDestroyed()) return false;
  try {
    const x1 = payload && payload.x1;
    const x2 = payload && payload.x2;
    if (!x1) return false;
    const img = nativeImage.createFromBuffer(Buffer.from(x1));
    if (img.isEmpty()) return false;
    if (x2) {
      try {
        img.addRepresentation({ scaleFactor: 2, buffer: Buffer.from(x2) });
      } catch (e) {}
    }
    tray.setImage(img);
    return true;
  } catch (e) {
    return false;
  }
});
```

Replace with:

```js
ipcMain.handle('tray-set-icon', (_event, payload) => {
  if (!tray || tray.isDestroyed()) return false;
  try {
    const x1   = payload && payload.x1;
    const x2   = payload && payload.x2;
    const xWin = payload && payload.xWin;
    if (!x1) return false;

    // Tray: 32 px base + optional 64 px HiDPI.
    const trayImg = nativeImage.createFromBuffer(Buffer.from(x1));
    if (trayImg.isEmpty()) return false;
    if (x2) {
      try {
        trayImg.addRepresentation({ scaleFactor: 2, buffer: Buffer.from(x2) });
      } catch (e) { /* HiDPI add failed -- 1x still works */ }
    }
    tray.setImage(trayImg);

    // Window + overlay: 256 px branded icon. Cache for applyTrayBadge.
    if (xWin) {
      try {
        const winImg = nativeImage.createFromBuffer(Buffer.from(xWin));
        if (!winImg.isEmpty()) {
          cachedBrandIcon = winImg;
          if (mainWin && !mainWin.isDestroyed()) {
            try { mainWin.setIcon(winImg); } catch (e) {}
          }
          // Refresh overlay so any pending badge swaps to the branded
          // icon immediately.
          applyTrayBadge();
        }
      } catch (e) { /* swallow -- tray succeeded */ }
    }

    return true;
  } catch (e) {
    return false;
  }
});
```

### 1d. Main: use `cachedBrandIcon` in `applyTrayBadge`

Find the overlay branch inside `applyTrayBadge`:

```js
if (count > 0) {
  const overlay = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'));
  mainWin.setOverlayIcon(overlay, String(count));
} else {
  mainWin.setOverlayIcon(null, '');
}
```

Replace with:

```js
if (count > 0) {
  // Phase 18: prefer the runtime-rendered Gamble mark when available;
  // fall back to assets/icon.png on the first ~50-300 ms before the
  // renderer reports in.
  const overlay = cachedBrandIcon || nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'));
  mainWin.setOverlayIcon(overlay, String(count));
} else {
  mainWin.setOverlayIcon(null, '');
}
```

Update the comment block immediately above (lines 224-227) -- the
"Acceptable for v2.0; a dedicated tray-badge.png can replace it
later" note is stale once Phase 18 lands. Replace those four
comment lines with:

```js
// Windows: overlay icon on taskbar button. macOS: dock badge. Linux: noop.
// The overlay uses cachedBrandIcon (set by tray-set-icon when the
// renderer rasterizes GambleMark). Falls back to assets/icon.png
// during the brief startup window before cache is populated.
```

---

## TASK 2 -- Eliminate the launch-landing flash + splash affordance

Two changes inside the renderer. No main-process work.

### 2a. Synchronous initial `showLanding`

Find (around `index.html` line 3702):

```js
const [showLanding, setShowLanding] = React.useState(false);
React.useEffect(() => {
  if (loading) return;
  try {
    if (sessionStorage.getItem('tt-seen-launch') !== '1') {
      setShowLanding(true);
    }
  } catch {
    setShowLanding(true);
  }
}, [loading]);
```

Replace with:

```js
// Phase 18: synchronous lazy initializer so the landing renders on
// the FIRST frame. Prior pattern used useState(false) + useEffect
// which let the main UI paint for one frame before the landing
// could mount on top -- visible as a flash. The landing also acts
// as a splash while `loading` is true; the alerts slot shows a
// loading message until orders hydrate.
const [showLanding, setShowLanding] = React.useState(() => {
  try { return sessionStorage.getItem('tt-seen-launch') !== '1'; }
  catch { return true; }
});
```

The `useEffect` block is removed entirely (the work is now in the
initializer). `dismissLanding` below it stays untouched.

### 2b. Outer container opaque from frame 1

Find `FullScreenLanding`'s outer `<div>` (around line 3127). The
line currently reads:

```jsx
opacity: (mounted && !leaving) ? 1 : 0,
transition: leaving ? 'opacity 280ms ease' : 'opacity 600ms ease',
```

Replace with:

```jsx
opacity: leaving ? 0 : 1,
transition: leaving ? 'opacity 280ms ease' : 'none',
```

This keeps the leave-fade (so dismissing still phases out
smoothly) but makes the splash opaque on frame 1. The inner
content's existing `mounted && !leaving` opacity tweens stay -- the
brand, "Welcome back", and alert cards still stagger in over the
solid background.

### 2c. Pass `loading` into FullScreenLanding

Update the signature (line 3107):

```js
function FullScreenLanding({ onProceed, onSelectWO, alerts, loading }) {
```

Update the alerts empty-state block (lines 3193-3197):

```jsx
{(alerts || []).length === 0 && (
  <div style={{ fontSize: 13, color: 'var(--text-3)', padding: '20px 0' }}>
    {loading ? 'Loading work orders...' : 'Nothing flagged today.'}
  </div>
)}
```

Update the render site (line 4399-4404):

```jsx
{showLanding && (
  <FullScreenLanding
    loading={loading}
    alerts={alerts}
    onProceed={dismissLanding}
    onSelectWO={(wo) => { dismissLanding(); setSelectedWO(wo); pushRecent(wo); setCurrentView('active'); }}
  />
)}
```

Notes:
- Once `loading` flips false, the alerts memo recomputes and the
  empty-state either disappears (alerts present) or swaps to
  "Nothing flagged today." Phase 15's stable-key fix handles the
  re-render cleanly.
- Do NOT disable the Proceed button while loading. Users can still
  dismiss the splash and see the main loading shimmer underneath if
  they want to. Splash blocks the flash; it does not block work.

---

## TASK 3 -- Remove the stale TODO comment

Find (around `index.html` line 3671):

```js
        const r = await window.storage.get('wo_data');
        if (r && r.value) {
          // TODO Phase 15: Settings -> About -> "Restore pre-migration backup".
          await window.storage.set('wo_data_pre_migration_backup', r.value);
        }
```

Replace with:

```js
        const r = await window.storage.get('wo_data');
        if (r && r.value) {
          await window.storage.set('wo_data_pre_migration_backup', r.value);
        }
```

Single-line deletion. The `storage.set` call is the live work; only
the dead TODO line goes.

---

## TASK 4 -- Verification

### Greps -- report all results

**Window icon + overlay branding:**
1. `let cachedBrandIcon` in `main.js` -- exactly 1 hit.
2. `cachedBrandIcon =` in `main.js` -- exactly 1 hit (the write
   inside the IPC handler).
3. `cachedBrandIcon \|\|` in `main.js` -- exactly 1 hit (the
   overlay fallback in `applyTrayBadge`).
4. `mainWin\.setIcon\(` in `main.js` -- exactly 1 hit.
5. `payload\.xWin` in `main.js` -- at least 1 hit.
6. `renderGambleMarkPng\(256\)` in `index.html` -- exactly 1 hit.
7. `xWin` in `index.html` -- exactly 1 hit (the IPC payload key).
8. `xWin` in `preload.js` -- exactly 0 hits (the bridge passes
   `payload` through opaquely; no per-key extension needed).

**Landing flash + splash:**
9. `useState\(() => {` in `index.html` -- at least 1 hit (the new
   showLanding initializer; may also match AboutSection's hasBackup
   probe which uses a regular `useState(null)` -- if a probe used a
   functional init in any earlier phase, this count rises). Inspect
   each hit to confirm the showLanding one is present.
10. `const \[showLanding, setShowLanding\]` in `index.html` --
    exactly 1 hit.
11. `if \(loading\) return;` in `index.html` -- the OLD effect's
    guard. After deletion, this exact phrase should be 0 hits in
    the gate region (search for the SHOWLANDING effect's body --
    confirm it is gone). The phrase may still appear elsewhere
    (other effects). Inspect each hit.
12. `Loading work orders\.\.\.` in `index.html` -- exactly 1 hit.
13. `loading={loading}` in `index.html` -- at least 1 hit (the
    FullScreenLanding prop pass).
14. `FullScreenLanding` in `index.html` -- exactly 2 hits
    (declaration + render).

**Stale comment removed:**
15. `TODO Phase 15` in `index.html` -- exactly 0 hits.
16. `'wo_data_pre_migration_backup'` in `index.html` -- exactly 2
    hits (Phase 14 write + Phase 15 restore read). Confirm the
    write line is still present.

**Regression panel (do NOT skip):**
17. `requestSingleInstanceLock` in `main.js` -- exactly 1 hit
    (Phase 17).
18. `ipcMain\.handle\('tray-set-icon'` in `main.js` -- exactly 1
    hit (Phase 16, extended in 1c).
19. `'preflight-check'` in `main.js` -- exactly 1 hit (Phase 17).
20. `function PreflightModal` in `index.html` -- exactly 1 hit
    (Phase 17).
21. `function migrateOrders` in `index.html` -- exactly 1 hit
    (Phase 11).
22. `function densityFor` in `index.html` -- exactly 1 hit
    (Phase 12).
23. `Catppuccin` in `index.html` -- at least 1 hit (Phase 12).
24. `SYNC_INTERVAL_MS` in `index.html` -- at least 1 hit (Phase 13).
25. `tab: 'sent'` in `index.html` -- at least 2 hits (Phase 13).
26. `onMarkPaid` in `index.html` -- at least 2 hits (Phase 14).
27. `restorePreMigrationBackup` in `index.html` -- at least 1 hit
    (Phase 15).
28. `renderGambleMarkPng` in `index.html` -- exactly 4 hits
    (declaration + 3 size calls).
29. `function hexToRgba` in `index.html` -- exactly 1 hit (Phase 9).
30. `o.priority` in `index.html` -- only inside `migrateOrders`.

### Live test (rule 4)

1. **No flash on cold launch.** Quit the app fully (Task Manager if
   needed; wait ~3 s for OS lock release). Relaunch. The Gamble
   splash should appear AT THE MOMENT the window appears -- no
   visible flicker of the main UI underneath. The brand and
   "Welcome back" text should fade in over the solid background.
2. **Splash holds during data load.** If data is still loading when
   the splash appears, the "Needs your attention" section should
   read "Loading work orders..." (not "Nothing flagged today.").
   Once loading finishes, alerts populate live.
3. **Dismiss still phases out.** Click Proceed. The splash fades to
   transparent, revealing the main app underneath. No abrupt cut.
4. **Window icon.** Look at the taskbar entry once the renderer has
   mounted. The icon should be the Gamble mark, not the generic
   icon. Alt-Tab preview should show the same. (First ~300 ms after
   launch may briefly show the generic icon while the renderer
   rasterizes; that is the fallback window.)
5. **Overlay badge.** Trigger a tray alert badge (e.g. set
   Settings -> Tray -> Badge source to "Needs attention" with at
   least one attention WO). The corner of the taskbar icon shows a
   small overlay -- it should be the Gamble mark, not the generic
   icon.
6. **Tray icon.** The tray icon (Phase 16) must remain branded; no
   regression.

If the flash returns after 2a + 2b: open DevTools, inspect the
showLanding state on first paint -- it must be `true` from frame 1.
If it is `true` but the flash persists, the issue is in 2b's outer
container opacity. Per rule 3, do not pile on additional CSS
overrides; re-read FullScreenLanding's first `<div>` and confirm
the opacity expression is `leaving ? 0 : 1`.

If the window icon does not change: DevTools console for
`renderGambleMarkPng(256)` errors. If the IPC handler in 1c is
firing but `mainWin.setIcon` has no visible effect, the binary may
be running under a development hotreload that pins the icon to the
package.json `build.icon`. Test the packaged build.

---

## Risk flags (mitigate or live-test)

1. **256 px IPC payload size.** ~10 KB per buffer; 30 KB total
   payload (32 + 64 + 256). Trivial. **Live test in step 4
   confirms.**

2. **`mainWin.setIcon` is a no-op on macOS.** Confirmed by Electron
   docs. User said macOS irrelevant. No mitigation.

3. **Windows pins old icon in taskbar shortcuts.** Pinned shortcuts
   cache the install-time .ico. The new branded icon shows for
   running instances but pinned-icon cache may show the old one
   until the user repins. **Mitigation:** documented; future
   release with a generated .ico in `assets/icon.ico` solves it
   permanently.

4. **Lazy `useState(() => ...)` and React strict mode.** React 18
   strict mode calls the initializer twice in development. The
   function is pure (just reads sessionStorage) and idempotent --
   no side effects from being called twice. **Live test:** dev mode
   already runs strict; no flash observed during test means safe.

5. **Splash with empty alerts confused for empty actual state.**
   The "Loading work orders..." message during load + "Nothing
   flagged today." after load are distinct strings. Verify both
   appear in the right state during live test 2. If a user
   misreads, that's a label problem, not a logic problem -- defer
   wording tweaks.

6. **`applyTrayBadge` called from inside `tray-set-icon` handler.**
   In 1c the handler calls `applyTrayBadge()` after stashing
   `cachedBrandIcon`. Confirm this does not loop: `applyTrayBadge`
   does NOT invoke any tray-icon-related IPC. It only reads cached
   state and calls `setOverlayIcon`. Safe.

7. **`cachedBrandIcon` survives across `destroyTray` / `ensureTray`
   cycles.** When the tray is toggled off and back on,
   `cachedBrandIcon` is module-level and persists. Tray icon
   resumes from `tray-set-icon` (renderer re-fires only on App
   mount). **Mitigation:** acceptable -- the tray icon will be
   `icon.png` after a toggle-off-then-on until the next renderer
   reload. Document; do not auto-rerasterize.

---

## Commit message

`phase18: brand window + overlay icons, fix landing flash, splash affordance`
