# PHASE 17 -- Single-instance lock, Restore-button disabled state, Preflight wire

Execute tasks in order. Read every file you touch before editing. No
emojis, no em-dashes. After each task, grep to confirm.

**Precondition:** Phases 10 through 16 applied. Confirm via the
preflight greps in TASK 0.

**Platform note:** Windows only. macOS-specific behaviour (template
images, dock badges, `darwin` branches) is out of scope. Do not touch
the existing `process.platform === 'darwin'` branches in `main.js`;
they stay as-is.

---

## Why this phase (read first)

Three small, unrelated items rolled into one phase because each
touches a different file region and none share a design decision.

1. **Single-instance lock.** Phase 16 live test surfaced three
   Chromium errors when a second instance of the app launched:
   - `Bridge server error (non-fatal): listen EADDRINUSE 127.0.0.1:27843`
   - `cache_util_win.cc(20)] Unable to move the cache: Access is denied`
   - `gpu_disk_cache.cc(676)] Gpu Cache Creation failed: -2`
   All three trace to one cause: `main.js` has no
   `app.requestSingleInstanceLock()`. The extension bridge HTTP
   server (line 117) tries to bind port 27843 and fails when the
   first instance still owns it; Chromium fails to acquire the
   userData cache lock for the same reason. Adding the lock collapses
   second-launch into a focus-existing-window action and eliminates
   all three errors at the root.

2. **Restore-button disabled state.** Phase 15 wired the
   "Restore pre-migration backup" SettingRow with a TODO comment
   reading `probe storage at mount and disable when no backup exists`.
   Without the probe, the button is always enabled and clicking it
   when no snapshot exists shows an error toast. Better UX: probe on
   mount, disable the button visually when there is nothing to
   restore. Risk that Phase 15 flagged ("disabled state without a
   checked-at-mount pattern will be wrong on first paint") is
   mitigated by a `null` initial state -- button is enabled while
   probing, then settles to enabled-or-disabled based on the probe
   result. Worst case: first 50 ms the button is clickable; the
   existing error toast handles that race.

3. **Preflight wire.** Phase 14 introduced a Tools menu in the
   Sidebar with an `onToolPreflight` slot, but the renderer comment
   at `index.html` line 1359 reads
   `not yet implemented in main.js; deferred to Phase 15`. Phase 15
   deferred it again. The adjacent worktree
   `youthful-booth-ccbd53` already ships a working preflight: a
   Python script (`preflight_qa.py`), an `ipcMain.handle('preflight-check', ...)`
   handler that spawns it, and a `window.workbook.preflight()`
   bridge. Per rule 1, we port that mechanism instead of inventing
   one. The script depends on `sync_to_lookup.py`, which already
   exists in our worktree -- so the port is a clean copy plus three
   tiny wire-up edits.

### Out of scope (do NOT do)

- Replacing the BrowserWindow `icon:` on `main.js` line 150 with the
  Gamble mark. Renderer-rasterization (Phase 16's mechanism) does not
  apply because BrowserWindow is constructed BEFORE the renderer
  exists. Needs a pre-rendered PNG file; design decision deferred.
- macOS template-image variant of the tray icon. Platform-specific,
  untestable on Windows.
- Replacing the Windows taskbar overlay icon (`applyTrayBadge` at
  `main.js` line 230). Still uses `assets/icon.png`. Acceptable; the
  Gamble brand is on the tray itself per Phase 16.
- Rewriting `preflight_qa.py`. Port it byte-for-byte from the
  adjacent worktree. If a bug exists in that script, fix it in a
  later phase scoped to the script.
- Adding any macOS-specific branches anywhere.

---

## TASK 0 -- Read first (no edits)

The architect performed these reads during planning; line numbers
and shapes below are verified as of phase17.md authoring time. You
still MUST open each region in your own session before editing to
confirm nothing has drifted.

### Confirmed locations

1. **Bridge server in `main.js`** -- declared starting line 49. The
   server's `error` handler already classifies EADDRINUSE as
   non-fatal (line 121). With the single-instance lock in place, the
   second-instance branch never reaches `server.listen`, so the
   error never fires.

2. **`app.whenReady().then(...)` block in `main.js`** -- line 305 to
   310. This is where `mainWin` is created. The lock check must
   happen BEFORE this block so we can `app.quit()` early without
   creating a window.

3. **`AboutSection` in `index.html`** -- declared at line 3046. The
   TODO comment is line 3064. The `<ActionBtn onClick={onRestoreBackup}>`
   is line 3066. The wrapper `<div>` is line 3057. Modify the
   AboutSection function to add a `useState` + `useEffect` pair that
   probes `wo_data_pre_migration_backup` at mount.

4. **`window.storage.get` shape** -- confirmed in `preload.js` and
   the Phase 15 restore callback at line 3493 (post-Phase-16 offset).
   `storage.get(key)` resolves to either `{ key, value }` (present)
   or `null` (absent). Phase 15's restore code reads `r.value` and
   bails when `!r || !r.value`. The probe in Phase 17 uses the same
   shape.

5. **Tools menu in `Sidebar`** -- declared at `index.html` line 1305.
   The Tools dropdown at line 1356-1363 currently passes through
   `onToolSync` and `onToolExport` but has placeholder comments for
   `onToolImport` (push-driven, no UI) and `onToolPreflight`
   (deferred). The pass-through pattern is uniform: `{onToolX && <SBRow label="..." onClick={onToolX} />}`.

6. **App's Sidebar invocation** -- `index.html` line 4226-4237. App
   passes `onToolSync` and `onToolExport`. Phase 17 adds
   `onToolPreflight`.

7. **Adjacent-worktree references** (read-only; do not edit those
   files):
   - `..\youthful-booth-ccbd53\preflight_qa.py` -- 200 lines, copy
     verbatim into our worktree root.
   - `..\youthful-booth-ccbd53\main.js` lines 280-315 -- the
     `preflight-check` handler. Copy verbatim into our `main.js`.
   - `..\youthful-booth-ccbd53\preload.js` line 32 -- the
     `preflight` bridge entry on `window.workbook`. Add to our
     existing `workbook` bridge.

8. **Our `sync_to_lookup.py`** -- already present at worktree root.
   Confirmed via Glob during planning. `preflight_qa.py` imports
   `resolve_workbook, resolve_msr_dir, load_orders,
   load_scraped_items, load_overrides, load_service_items,
   find_msr_folder, extract_msr_items, map_to_service_item,
   customer_name` from it. Do NOT verify each name -- if any are
   missing, `preflight_qa.py` will throw at import time and the IPC
   handler returns `{ok: false, error: "..."}` cleanly. Live test
   catches it.

### Reads you still owe

1. `main.js` lines 1-60 (header + bridge server start).
2. `main.js` lines 300-315 (`app.whenReady` block).
3. `main.js` lines 275-320 (paste site for the `preflight-check`
   handler, between existing handlers).
4. `index.html` lines 3046-3071 (`AboutSection`).
5. `index.html` lines 1305-1370 (`Sidebar`).
6. `index.html` lines 4220-4240 (App's Sidebar invocation).
7. `preload.js` in full (small).
8. `..\youthful-booth-ccbd53\preflight_qa.py` in full.
9. `..\youthful-booth-ccbd53\main.js` lines 280-315.

### Regression preflight (REQUIRED)

Run these greps in our worktree; STOP if any fail:

- `requestSingleInstanceLock` in `main.js` -- exactly 0 hits (lock
  not yet present).
- `'preflight-check'` in `main.js` -- exactly 0 hits.
- `preflight_qa.py` exists at our worktree root -- exactly 0 hits
  (file does NOT exist yet).
- `sync_to_lookup.py` exists at our worktree root -- file MUST exist.
  If absent, STOP -- `preflight_qa.py` will not run.
- `new Tray\(` in `main.js` -- exactly 1 hit (Phase 10).
- `function migrateOrders` in `index.html` -- exactly 1 hit
  (Phase 11).
- `function densityFor` in `index.html` -- exactly 1 hit (Phase 12).
- `SYNC_INTERVAL_MS` in `index.html` -- exactly 1 hit (Phase 13).
- `sessionStorage.getItem\('tt-seen-launch'\)` in `index.html` --
  exactly 1 hit (Phase 15).
- `ipcMain.handle\('tray-set-icon'` in `main.js` -- exactly 1 hit
  (Phase 16).
- `renderGambleMarkPng` in `index.html` -- exactly 3 hits (Phase 16).

If any fail, STOP and surface to the user.

---

## TASK 1 -- Single-instance lock in main.js

### 1a. Add the lock at the top of main.js, after the requires

Find the require block at the top (lines 1-7). Find the first
`function` or top-level statement after the requires. The lock must
run BEFORE `app.whenReady()` AND before the bridge server is started.
The bridge server start path is currently called from inside
`app.whenReady` (verify by reading lines 49-126 -- the
`startExtensionBridge()` or similar is invoked from whenReady).

Insert AFTER the requires (after line 7) and BEFORE any
`function`/`const`/`let` declarations:

```js
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
```

Two things to verify before pasting:
- `mainWin` must be in scope when `second-instance` fires. Read the
  file -- `mainWin` is declared at the module level (single `let
  mainWin` early in the file). The handler closes over it.
- `return` only works at top level of a CommonJS module if the file
  is wrapped (Node wraps every CommonJS file in a function, so
  `return` IS legal at top level). Verified.

### 1b. Do not duplicate or alter the bridge server logic

The bridge server's existing `server.on('error', ...)` handler at
line 121 stays. After 1a it is dead code for the EADDRINUSE case
(second instance never reaches it), but it still catches other
error classes (port permission, OS network errors). Leave it.

---

## TASK 2 -- Restore-button disabled state in AboutSection

### 2a. Replace AboutSection with a probing variant

Find (around line 3046-3071):

```jsx
function AboutSection({ onResetSettings, onRestoreBackup }) {
  return (
    <div>
      <SettingTitle>About</SettingTitle>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
        <GambleMark size={48} />
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Trade Tracker</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>by Gamble · v2.0.0</div>
        </div>
      </div>
      <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border-1)' }}>
        <SettingRow label="Reset all settings" hint="...">
          <ActionBtn onClick={onResetSettings} style={{ ... }}>Reset settings</ActionBtn>
        </SettingRow>
        {/* TODO: probe storage at mount and disable when no backup exists. */}
        <SettingRow label="Restore pre-migration backup" hint="...">
          <ActionBtn onClick={onRestoreBackup}>Restore backup</ActionBtn>
        </SettingRow>
      </div>
    </div>
  );
}
```

Replace with:

```jsx
function AboutSection({ onResetSettings, onRestoreBackup }) {
  // null = probing, true = backup present, false = absent.
  // While probing the button stays enabled so a click works even on
  // the first 50ms after mount; the restore callback already toasts
  // "No pre-migration backup found" if storage comes up empty.
  const [hasBackup, setHasBackup] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!window.storage || !window.storage.get) {
        if (!cancelled) setHasBackup(false);
        return;
      }
      try {
        const r = await window.storage.get('wo_data_pre_migration_backup');
        if (cancelled) return;
        setHasBackup(!!(r && r.value));
      } catch {
        if (!cancelled) setHasBackup(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);
  const restoreDisabled = hasBackup === false;
  return (
    <div>
      <SettingTitle>About</SettingTitle>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
        <GambleMark size={48} />
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Trade Tracker</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>by Gamble &middot; v2.0.0</div>
        </div>
      </div>
      <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border-1)' }}>
        <SettingRow label="Reset all settings" hint="Restores theme, density, alerts, sync interval, tray, and workbook path to defaults. Does NOT touch your WOs.">
          <ActionBtn
            onClick={onResetSettings}
            style={{ background: 'var(--flag-emergency)', color: 'var(--accent-fg)', border: 'none' }}
          >Reset settings</ActionBtn>
        </SettingRow>
        <SettingRow label="Restore pre-migration backup" hint={restoreDisabled
          ? 'No pre-migration backup found in storage. Re-tick "Back up workbook first" on your next migration to create one.'
          : "Replaces current data with the snapshot taken just before the last migration applied."
        }>
          <ActionBtn
            onClick={onRestoreBackup}
            disabled={restoreDisabled}
            style={restoreDisabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          >Restore backup</ActionBtn>
        </SettingRow>
      </div>
    </div>
  );
}
```

Notes:
- The `&middot;` HTML entity is the same Unicode middle dot used
  before; keep visual parity.
- The TODO comment is removed (no longer pending).
- `ActionBtn` already supports a `disabled` attribute via native
  `<button>` semantics. Verify by reading `ActionBtn`. If it does
  NOT pass `disabled` through, add the prop forward:
  `<button ... disabled={disabled} ...>`. Most likely it does
  (Phase 14 added it for the migration dialog).
- The hint text changes when disabled to explain WHY -- otherwise a
  greyed-out button with no explanation is a worse UX than the
  current error-toast flow.

---

## TASK 3 -- Wire `onToolPreflight`

Three sub-tasks, executed in order. Each is small.

### 3a. Copy `preflight_qa.py` from the adjacent worktree

Source: `..\youthful-booth-ccbd53\preflight_qa.py` (200 lines).
Destination: worktree root, alongside `sync_to_lookup.py`.

Use a binary copy (PowerShell `Copy-Item` or `cp`); do not retype.
Verify after copy that the destination file exists and is 200 lines.

Do NOT modify the script content. Even if a lint complaint appears,
the script ships as-is per rule 2 (port the mechanism, not the
constants).

### 3b. Add the `preflight-check` IPC handler in main.js

Source: `..\youthful-booth-ccbd53\main.js` lines 280-315.

In our `main.js`, find the existing `ipcMain.handle('sync-workbook', ...)`
at line 326 (post-Phase-16 offset; was line 326 in Phase 16). Insert
the new `preflight-check` handler AFTER `sync-workbook` and BEFORE
`choose-workbook`:

```js
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
```

Confirm by grep that `resolveWorkbookPath` and `spawn` are both
already in scope (they are -- `resolveWorkbookPath` is declared
above `sync-workbook`, and `spawn` is imported on line 5).

Do NOT add this handler to `package.json` `extraResources` -- that
is needed for production builds, but the existing scrapers are
already packaged the same way and `extraResources` should already
include `*.py`. If `electron-builder.json` or similar configures
extra resources, verify `preflight_qa.py` is covered by the existing
glob (most likely `"*.py"` or `"*.{py,json}"`). If not, add it.
**Do NOT speculate -- read the build config first.**

### 3c. Bridge through preload.js

Find the `workbook` bridge in `preload.js` (currently lines 30-33):

```js
contextBridge.exposeInMainWorld('workbook', {
  sync: (overridePath) => ipcRenderer.invoke('sync-workbook', overridePath || ''),
  choose: (currentPath) => ipcRenderer.invoke('choose-workbook', currentPath || '')
});
```

Extend with `preflight`:

```js
contextBridge.exposeInMainWorld('workbook', {
  sync:      (overridePath) => ipcRenderer.invoke('sync-workbook', overridePath || ''),
  choose:    (currentPath)  => ipcRenderer.invoke('choose-workbook', currentPath || ''),
  preflight: (overridePath) => ipcRenderer.invoke('preflight-check', overridePath || '')
});
```

### 3d. Add a Preflight modal in the renderer

The adjacent worktree's renderer used HTML-string rendering; ours
uses React JSX. Port the IDEA (loading / error / data states with
sections per issue category) but write in our component style.

Add a `<PreflightModal />` component near the other modals. Find an
existing modal component (e.g. the migration dialog or add/edit WO
modal) for style consistency. Insert just before the App component
declaration.

```jsx
function PreflightModal({ state, onClose, onRerun }) {
  const r = state || {};
  let body;
  if (r.loading) {
    body = <p style={{ color: 'var(--text-2)', fontSize: 13 }}>Running preflight against the Invoiced tab...</p>;
  } else if (r.error) {
    body = <p style={{ color: 'var(--flag-emergency)', fontSize: 13, whiteSpace: 'pre-wrap' }}>{String(r.error)}</p>;
  } else if (r.data) {
    const d = r.data;
    const sections = [
      { title: 'Suspicious WO ids (>8 digits)', rows: d.suspiciousId || [],
        fmt: (x) => x.wo + ' -- ' + (x.address || '') },
      { title: 'Missing customer / address', rows: d.missingMeta || [],
        fmt: (x) => (x.wo || '(no id)') + ' pm=' + (x.pm || '?') + " addr='" + (x.address || '') + "'" },
      { title: 'No line items resolved', rows: d.noItems || [],
        fmt: (x) => x.wo + ' ' + (x.pm || '?') + ' -- ' + (x.address || '') + ' (' + x.source + ')' },
      { title: 'MSR address with no folder match', rows: d.msrNoFolder || [],
        fmt: (x) => x.wo + ' -- ' + (x.address || '') },
      { title: 'Mapping fell back to Labor!/Materials!', rows: d.fallback || [],
        fmt: (x) => x.wo + ' -- ' + (x.address || '') + ' :: ' + (x.items || []).map(it => it.name + ' -> ' + it.mapped).join(', ') },
      { title: '$0 unit price', rows: d.zeroPrice || [],
        fmt: (x) => x.wo + ' -- ' + (x.address || '') + ' :: ' + (x.items || []).map(it => it.name + ' -> ' + (it.mapped || '(unmapped)')).join(', ') },
    ];
    const total = sections.reduce((n, s) => n + s.rows.length, 0);
    body = (
      <div>
        <p style={{ color: 'var(--text-2)', fontSize: 12, margin: '0 0 10px 0' }}>
          {total} issue(s) across {d.totalOrders || 0} Invoiced WO(s).
        </p>
        {sections.map(s => (
          <div key={s.title} style={{ marginTop: 10 }}>
            <strong style={{ fontSize: 13, color: s.rows.length ? 'var(--flag-warranty)' : 'var(--text-2)' }}>
              {s.title} ({s.rows.length})
            </strong>
            {s.rows.length > 0 && (
              <ul style={{ margin: '6px 0 12px 18px', padding: 0, fontSize: 12, color: 'var(--text-1)' }}>
                {s.rows.map((x, i) => <li key={x.wo || ('idx-' + i)}>{s.fmt(x)}</li>)}
              </ul>
            )}
          </div>
        ))}
      </div>
    );
  } else {
    body = null;
  }
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400,
    }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: 'var(--bg-surface)', color: 'var(--text-1)',
        borderRadius: 10, padding: '20px 24px', maxWidth: 720, width: '90vw',
        maxHeight: '85vh', display: 'flex', flexDirection: 'column',
      }}>
        <h2 style={{ margin: '0 0 12px 0', fontSize: 18 }}>Preflight check</h2>
        <div style={{ overflowY: 'auto', flex: 1 }}>{body}</div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <ActionBtn onClick={onRerun}>Re-run</ActionBtn>
          <ActionBtn primary onClick={onClose}>Close</ActionBtn>
        </div>
      </div>
    </div>
  );
}
```

### 3e. Wire the modal into App

In App (search for `[modal, setModal]` or similar state used by the
existing add/edit modals), add new state:

```js
const [preflightState, setPreflightState] = React.useState(null);
// shape: null | { loading: true } | { error: string } | { data: {...} }
const runPreflight = React.useCallback(async () => {
  if (!window.workbook || !window.workbook.preflight) {
    toast('Preflight unavailable in this build', 'err');
    return;
  }
  setPreflightState({ loading: true });
  try {
    const r = await window.workbook.preflight(settings.workbookPath || '');
    if (!r || !r.ok) {
      setPreflightState({ error: (r && r.error) || 'Unknown error' });
      return;
    }
    setPreflightState({ data: r.data });
  } catch (e) {
    setPreflightState({ error: String(e && e.message || e) });
  }
}, [settings.workbookPath, toast]);
```

Pass `onToolPreflight={runPreflight}` into `<Sidebar />`:

```jsx
<Sidebar
  ...
  onToolSync={() => globalSyncWorkbook({ silent: false })}
  onToolExport={exportViewCsv}
  onToolPreflight={runPreflight}
/>
```

Add the modal render alongside the existing modal renders (look for
`{modal === '...' && <SomeModal ...} />` style; place
`PreflightModal` similarly):

```jsx
{preflightState && (
  <PreflightModal
    state={preflightState}
    onClose={() => setPreflightState(null)}
    onRerun={runPreflight}
  />
)}
```

### 3f. Accept `onToolPreflight` in Sidebar and render the row

Update Sidebar's signature (line 1305):

```js
function Sidebar({ activeView, onSelectView, onOpenSettings, counts, presets, onAddWO, onRenamePreset, onDeletePreset, onToolSync, onToolExport, onToolPreflight }) {
```

Inside the Tools dropdown (replace the placeholder comment at line
1359):

```jsx
{toolsOpen && (
  <div style={{ marginLeft: 14, display: 'flex', flexDirection: 'column', gap: 1 }}>
    {/* onToolImport: push-driven via extensionBridge; no manual fire path. */}
    {onToolPreflight && <SBRow label="Preflight" onClick={onToolPreflight} />}
    {onToolSync     && <SBRow label="Sync workbook" onClick={onToolSync} />}
    {onToolExport   && <SBRow label="Export CSV"    onClick={onToolExport} />}
  </div>
)}
```

Order: Preflight before Sync because preflight is a dry-run; users
should validate before syncing.

---

## TASK 4 -- Verification

Report all results.

### Single-instance lock

1. `requestSingleInstanceLock` in `main.js` -- exactly 1 hit.
2. `app.on\('second-instance'` in `main.js` -- exactly 1 hit.
3. `app.quit\(\)` in `main.js` -- at least 2 hits (the existing
   `Quit` tray menu item + the new lock-fail branch). Confirm via
   content grep that one is inside the single-instance guard.

### Restore-button disabled state

4. `hasBackup` in `index.html` -- at least 2 hits (state declaration
   + read in `restoreDisabled` derivation).
5. `restoreDisabled` in `index.html` -- exactly 2 hits (one
   derivation, one prop pass).
6. `'wo_data_pre_migration_backup'` in `index.html` -- exactly 2
   hits (the Phase 15 restore callback + the new probe). NO new
   write of the key.
7. `TODO: probe storage at mount` in `index.html` -- exactly 0 hits
   (comment removed).

### Preflight wire

8. `preflight_qa.py` exists at worktree root -- file present, 200
   lines.
9. `'preflight-check'` in `main.js` -- exactly 1 hit.
10. `'preflight-check'` in `preload.js` -- exactly 1 hit.
11. `window.workbook.preflight` in `index.html` -- exactly 1 hit.
12. `onToolPreflight` in `index.html` -- at least 3 hits (Sidebar
    signature, Sidebar Tools row, App pass-through).
13. `PreflightModal` in `index.html` -- exactly 2 hits (declaration
    + render site).
14. `preflightState` in `index.html` -- at least 3 hits.

### Regression panel (do NOT skip)

15. `new Tray\(` in `main.js` -- exactly 1 hit (Phase 10).
16. `ipcMain.handle\('tray-set-icon'` in `main.js` -- exactly 1 hit
    (Phase 16).
17. `function migrateOrders` in `index.html` -- exactly 1 hit
    (Phase 11).
18. `function densityFor` in `index.html` -- exactly 1 hit
    (Phase 12).
19. `Catppuccin` in `index.html` -- at least 1 hit (Phase 12).
20. `'#eff1f5'` in `index.html` -- at least 1 hit (Phase 12).
21. `SYNC_INTERVAL_MS` in `index.html` -- exactly 1 hit (Phase 13).
22. `tab: 'sent'` in `index.html` -- at least 2 hits (Phase 13).
23. `onMarkPaid` in `index.html` -- at least 2 hits (Phase 14).
24. `sessionStorage.getItem\('tt-seen-launch'\)` in `index.html` --
    exactly 1 hit (Phase 15).
25. `restorePreMigrationBackup` in `index.html` -- at least 1 hit
    (Phase 15).
26. `renderGambleMarkPng` in `index.html` -- exactly 3 hits
    (Phase 16).
27. `function hexToRgba` in `index.html` -- exactly 1 hit (Phase 9).
28. `o.priority` in `index.html` -- still only inside
    `migrateOrders` (Phase 11).

### Live test (rule 4)

1. **Single-instance:** Launch the app. Without quitting, launch the
   built exe a second time (or `npm start` again from another
   shell). The second launch must NOT show new errors; it should
   either silently exit OR focus the first window. Quit fully. Wait
   ~3 seconds for the OS to release locks. Re-launch -- normal
   behaviour. EADDRINUSE and cache-lock errors gone.

2. **Restore button disabled:** Open Settings -> About. If no
   `wo_data_pre_migration_backup` exists in storage, the
   "Restore backup" button must render greyed-out with the
   not-allowed cursor. Hint text should explain why. Apply a
   migration with the backup checkbox ticked; reopen Settings ->
   About -- the button must now be enabled.

3. **Preflight:** Settings should show a workbook path. Sidebar ->
   Tools -> Preflight should open a modal showing "Running
   preflight..." then resolve to either a list of issues or an error
   message ("Python not found on PATH", "Workbook not found", etc.).
   If python is on PATH and the workbook resolves, the modal lists
   issues grouped by category. "Re-run" repeats the check; "Close"
   dismisses.

If any live test fails:
- Single-instance fails: check that the `return` after `app.quit()`
  is actually reached (PowerShell `Get-Process` for orphan electron
  before re-launching). Per rule 3, do NOT keep adding guards if it
  fails twice -- step back and read the `app.whenReady` lifecycle.
- Restore-button stuck enabled or stuck disabled: DevTools console
  for `await window.storage.get('wo_data_pre_migration_backup')`
  directly -- see what comes back.
- Preflight modal shows "Could not parse preflight output":
  PowerShell run `python preflight_qa.py --json "<workbook path>"`
  directly. Confirm the script emits valid JSON on the last line. If
  it emits a stack trace, fix the script (e.g. missing import) and
  re-run.

---

## Risk flags (mitigate or live-test before commit)

1. **Lock acquired by orphan process.** If a previous Electron run
   crashed without releasing the OS lock, the new run quits
   immediately and the user sees nothing. **Mitigation:** the
   single-instance lock is OS-level (Windows mutex); it releases
   when the holding process dies. **Live test:** kill the app with
   Task Manager; relaunch within 1-2 seconds. Should work. If the
   OS hasn't released by then, the user will reboot anyway.

2. **`return` at top-level CommonJS.** Confirmed legal: Node wraps
   each CommonJS module in a function, so `return` at top level
   exits the module. If the build tooling transpiles `main.js` to
   ESM (rare), `return` becomes illegal. **Mitigation:** wrap the
   lock in `if (!lock) { app.quit(); } else { /* rest of main.js
   */ }` if a build error appears. Do NOT pre-emptively restructure
   -- the file is plain CommonJS today.

3. **Probe race.** Between mount and probe-resolve, the user could
   click Restore. The Phase 15 callback already toasts
   "No pre-migration backup found" when storage comes up empty.
   Acceptable. **Live test:** click Restore very fast after opening
   About on a fresh install -- the toast still shows.

4. **Python not on PATH at runtime.** The handler returns
   `{ok: false, error: "Python not found on PATH."}`; the modal
   shows the error verbatim. Acceptable; existing scrapers have the
   same dependency. **Live test:** temporarily rename `python.exe`
   on PATH, run Preflight, confirm the modal shows the error
   gracefully (no crash).

5. **`preflight_qa.py` import failure.** If `sync_to_lookup.py`
   drifts and a name disappears, Python exits non-zero and the
   handler returns the stderr tail. **Mitigation:** the error is
   surfaced to the user; the app continues. **Live test:** if the
   modal shows ImportError, fix `sync_to_lookup.py` -- do not patch
   `preflight_qa.py`.

6. **`extraResources` packaging.** In production builds, the script
   must be unpacked next to the executable. Existing scrapers
   already require this; if `electron-builder.json` (or whatever
   build config the project uses) globs `*.py`, the new script is
   covered automatically. **Mitigation:** read the build config
   during TASK 3b; if the glob is narrower than `*.py`, widen it or
   add `preflight_qa.py` explicitly. **Do NOT speculate.**

7. **Modal Z-index collision.** The PreflightModal uses `zIndex:
   400`. Confirm via grep that no existing modal sits at >= 400.
   Phase 15's FullScreenLanding uses 250 (line 3104 post-Phase-16
   offset). 400 is above that and above the Settings drawer.

---

## Commit message

`phase17: single-instance lock + restore-button probe + preflight wire`
