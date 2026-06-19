# PHASE 15 -- Landing screen fixes + restore-from-migration-backup

Execute tasks in order. Read every file you touch before editing. No
emojis, no em-dashes. After each task, grep to confirm.

**Precondition:** Phases 13 and 14 must be applied. Confirm via the
preflight greps in TASK 0.

---

## Why this phase (read first)

User-reported defects from live use plus one deferred Phase 14 item:

1. **The full-screen launch landing never appears.** After the first
   launch ever, the user never sees it again -- even on subsequent app
   restarts, even after weeks. Root cause (verified by static read of
   `index.html` lines 3515-3526): the gate is
   `settings.hasLaunched`, which is persisted to disk via
   `updateSettings({ hasLaunched: true })` in `dismissLanding`. Once
   set, it never resets. The README explicitly specifies the opposite
   mechanism: **per-session** via
   `sessionStorage['tt-seen-launch']` (README "Full-screen Launch
   Landing" section, "Screens / Views" item 1, last paragraph). The
   intent is: show on every app open, hide for the rest of that
   session.

2. **When the landing did appear, it showed stale alert reports.**
   Cards animated in showing WOs that were no longer in the alert set
   by the time the user could read them. Two contributing factors
   identified by static read:
   - `index.html` line 3109 uses `key={i}` (index) when mapping
     `alerts.slice(0, 6)` inside `FullScreenLanding`. Index-based
     React keys cause node reuse when the underlying list order
     changes. If `alerts` updates between mount and
     animation-complete (~1.5s), React keeps the DOM node but swaps
     content, producing visible flicker and the "stale" effect.
   - `index.html` line 2153 has the **same** index-key bug in the
     in-pane component named `Landing` (function declared at line
     2116, rendered at line 4043 when `currentView === 'attention'`).
     Fix once at both sites.

3. **Restore pre-migration backup** is missing from Settings -> About.
   Phase 14 wrote a one-off snapshot to
   `wo_data_pre_migration_backup` but left a `TODO Phase 15` comment
   in lieu of a restore UI. This phase delivers it.

---

## TASK 0 -- Read first (no edits)

These reads were performed by the architect during phase planning;
their findings are documented here so you do not have to re-search.
You still MUST open each file/section in your own session to confirm
nothing has drifted, but the line numbers and shapes below are
verified as of phase15.md authoring time.

### Confirmed locations

1. **Landing visibility gate** -- `index.html` lines 3515-3526. The
   gate uses `settings.hasLaunched` at three sites: 3516 (derived
   constant `hasLaunched`), 3519 (effect condition), 3525
   (`updateSettings` write). All three must go.

2. **`FullScreenLanding` component** -- declared at line 3033, render
   site at line 4181. The buggy alert map is at lines 3107-3118
   inside this component. The component receives `alerts` as a
   prop (line 3033 signature: `({ onProceed, onSelectWO, alerts })`).

3. **In-pane Landing component** -- declared at line 2116 as
   `function Landing({ alerts = [], onSelectWO, onProceed })`.
   Render site at line 4043 inside the
   `if (currentView === 'attention')` branch. The buggy alert map is
   at line 2153. **It is named `Landing`, not
   `NeedsAttentionLanding`.** The phase planning prose calls it
   `Landing (in-pane)` for clarity vs the full-screen variant.

4. **`alerts` source of truth** -- line 3561:
   ```js
   const alerts = React.useMemo(
     () => loading ? [] : computeAlerts(orders, alertThresholds),
     [orders, loading, alertThresholds]
   );
   ```
   `computeAlerts` is at line 798. Each alert entry has shape
   `{ kind, wo, addr, blurb }`. The `wo` field is `o.id` and is
   always truthy when computeAlerts runs, so `key={a.wo}` is safe
   (the `|| ('idx-' + i)` fallback in TASK 2 is purely defensive).

5. **Phase 14 `applyMigration` and snapshot write** -- lines
   3429-3450 region. The snapshot write key is the string literal
   `'wo_data_pre_migration_backup'`. The write uses
   `await window.storage.set(key, value)`.

6. **`AboutSection`** -- line 3011 (declaration) with the Phase 14
   "Reset settings" row inside a
   `<div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px
   solid var(--border-1)' }}>` wrapper. Insert the new "Restore
   backup" SettingRow inside the **same** wrapper, below the
   existing Reset row.

7. **`SettingsDrawer` consumption of AboutSection** -- line
   matching `section === 'about'` (Phase 14 added
   `onResetSettings` here). Pattern to extend:
   `<AboutSection onResetSettings={onResetSettings} onRestoreBackup={onRestoreBackup} />`.

8. **`window.storage` IPC shape** -- confirmed via `preload.js`:
   ```js
   contextBridge.exposeInMainWorld('storage', {
     get:    (key)        => ipcRenderer.invoke('storage-get', key),
     set:    (key, value) => ipcRenderer.invoke('storage-set', key, value),
     delete: (key)        => ipcRenderer.invoke('storage-delete', key)
   });
   ```
   `storage.get(key)` resolves to `{ value: <string> | null }`.
   `storage.set(key, value)` resolves once written. The Phase 15
   restore reads `r.value` which is the raw JSON string -- pass that
   string straight back into `storage.set('wo_data', snap)` without
   reparsing.

### Reads you still owe

Even with the above documented, you MUST open each region before
editing to confirm nothing has drifted:

1. `index.html` lines 3510-3530 (gate region).
2. `index.html` lines 3032-3148 (`FullScreenLanding`).
3. `index.html` lines 2110-2165 (`Landing` -- in-pane).
4. `index.html` lines 3425-3455 (Phase 14 `applyMigration` region).
5. `index.html` lines 3005-3030 (Phase 14 `AboutSection`).
6. Grep `settings.hasLaunched` -- expect exactly 3 hits before
   edits. If you see fewer or more, STOP and reconcile.

### Phase 13 + 14 regression preflight (REQUIRED)

Run these greps; STOP if any fail:
- `wo_data_pre_migration_backup` -- exactly 1 hit (Phase 14 write).
- `function markInvoiced` -- 0 hits (it's a useCallback).
- `markInvoiced =` -- at least 1 hit.
- `invoicedOrders` -- at least 2 hits.
- `SYNC_INTERVAL_MS` -- exactly 1 definition.
- `tab: 'sent'` -- at least 2 hits.
- `onResetSettings` -- at least 2 hits.

If any fail, STOP and surface to the user instead of proceeding.

---

## TASK 1 -- Landing visibility: switch to sessionStorage

The persistence model changes from disk-stored `settings.hasLaunched`
to in-memory `sessionStorage['tt-seen-launch']`. The disk flag is
removed entirely so old data does not silently block the landing.

### 1a. Replace the gate and the dismissal write

Find (around line 3515-3526):
```js
// Fullscreen launch landing
const hasLaunched = !loading && settings.hasLaunched;
const [showLanding, setShowLanding] = React.useState(false);
React.useEffect(() => {
  if (!loading && !settings.hasLaunched) {
    setShowLanding(true);
  }
}, [loading]);
const dismissLanding = React.useCallback(() => {
  setShowLanding(false);
  updateSettings({ hasLaunched: true });
}, [updateSettings]);
```

Replace with:
```js
// Fullscreen launch landing. Per-session gate via sessionStorage so the
// landing reappears on every fresh app launch (matches README spec).
// Refresh within a single session does NOT re-show (the sessionStorage
// flag survives the in-process reload but is wiped on full app restart).
const [showLanding, setShowLanding] = React.useState(false);
React.useEffect(() => {
  if (loading) return;
  try {
    if (sessionStorage.getItem('tt-seen-launch') !== '1') {
      setShowLanding(true);
    }
  } catch {
    // sessionStorage unavailable (privacy mode / locked storage) ->
    // show the landing this run; do not crash.
    setShowLanding(true);
  }
}, [loading]);
const dismissLanding = React.useCallback(() => {
  setShowLanding(false);
  try { sessionStorage.setItem('tt-seen-launch', '1'); } catch {}
}, []);
```

Notes:
- The `hasLaunched` derived constant is removed -- no other code reads
  it (verify by greping `hasLaunched` after TASK 1; expected 0 hits).
- `updateSettings` no longer needs to be in `dismissLanding`'s deps.
- The `loading` early-return inside the effect prevents the landing
  from flashing during initial data load.

### 1b. Stop persisting the flag (cleanup)

Grep `hasLaunched` -- should now be zero hits in `index.html`. Also
grep the `useWorkOrders` hook init code (around line 813 -- the
`fresh()` factory and the parsed-object hydration). If you find any
reference to `hasLaunched` there, remove it. It is fine to leave a
stale `hasLaunched: true` value in an existing user's stored
`wo_data` -- nothing reads it anymore, and the next write naturally
omits it.

Do NOT write a migration to strip the field; that is unnecessary
churn for a no-op key. Comment near the new effect:

```js
// Pre-Phase-15 builds wrote settings.hasLaunched to disk. That key is
// now ignored. Leaving stale values in user storage is harmless.
```

---

## TASK 2 -- Landing alert freshness: stable keys + re-render guard

Two changes; both small.

### 2a. Use WO id as the React key in FullScreenLanding

Find (around line 3107-3118):
```jsx
{(alerts || []).slice(0, 6).map((a, i) => (
  <div
    key={i}
    style={{
      opacity: (mounted && !leaving) ? 1 : 0,
      transform: (mounted && !leaving) ? 'translateY(0)' : 'translateY(10px)',
      transition: leaving ? 'none' : `opacity 600ms ease ${560 + i * 80}ms, transform 600ms ease ${560 + i * 80}ms`,
    }}
  >
    <FSAlertCard {...a} onClick={() => handleSelectWO(a.wo)} />
  </div>
))}
```

Replace the key:
```jsx
{(alerts || []).slice(0, 6).map((a, i) => (
  <div
    key={a.wo || ('idx-' + i)}
    style={{
      opacity: (mounted && !leaving) ? 1 : 0,
      transform: (mounted && !leaving) ? 'translateY(0)' : 'translateY(10px)',
      transition: leaving ? 'none' : `opacity 600ms ease ${560 + i * 80}ms, transform 600ms ease ${560 + i * 80}ms`,
    }}
  >
    <FSAlertCard {...a} onClick={() => handleSelectWO(a.wo)} />
  </div>
))}
```

The `|| ('idx-' + i)` fallback covers the edge case where an alert
entry somehow lacks a `wo` (it should not -- `computeAlerts` always
sets `wo: o.id`, but defensive).

### 2b. Apply the same fix to the in-pane `Landing` component

Inside the `function Landing(...)` at line 2116, find (around line
2153):
```jsx
{alerts.map((a, i) => <AlertCard key={i} {...a} onClick={() => onSelectWO(a.wo)} />)}
```

Replace:
```jsx
{alerts.map((a, i) => <AlertCard key={a.wo || ('idx-' + i)} {...a} onClick={() => onSelectWO(a.wo)} />)}
```

Note: the component is named `Landing`, not `NeedsAttentionLanding`.
There are two distinct landing components in the file -- the
full-screen one (`FullScreenLanding`, line 3033) and the in-pane one
(`Landing`, line 2116). Both need the key fix; do not confuse them
with each other.

### 2c. Guarantee alerts are fresh at mount time

The current landing trigger:
```js
React.useEffect(() => {
  if (loading) return;
  ...
  setShowLanding(true);
}, [loading]);
```

This fires when `loading` flips false. On the same render cycle,
`alerts` (a `useMemo` over `orders`) recomputes from the now-loaded
`orders`. By the time the landing actually paints, `alerts` is
correct. So no additional gating is needed -- BUT the user-reported
staleness symptom suggests a stale prop snapshot. The most likely
cause is the index-key bug from 2a/2b. If after a live test the user
still reports staleness, the next mitigation is to delay the landing
by one frame to let `alerts` settle:

```js
React.useEffect(() => {
  if (loading) return;
  // Defer one frame so alerts useMemo recomputes against loaded orders
  // before the landing reads it.
  const id = requestAnimationFrame(() => {
    try {
      if (sessionStorage.getItem('tt-seen-launch') !== '1') {
        setShowLanding(true);
      }
    } catch { setShowLanding(true); }
  });
  return () => cancelAnimationFrame(id);
}, [loading]);
```

**Do NOT apply this rAF deferral pre-emptively.** It introduces a
visible flash of the empty app before the landing mounts. Ship 2a/2b
first; only swap to the rAF version if the user reports persistent
staleness after live test. Rule 3: do not pile on fixes within a
single attempt.

---

## TASK 3 -- Restore pre-migration backup UI

Phase 14 writes a `wo_data_pre_migration_backup` snapshot when the
user applies a migration with the backup checkbox ticked. Phase 15
surfaces a "Restore pre-migration backup" button in Settings -> About,
below "Reset settings".

### 3a. Add `restorePreMigrationBackup` callback in App

Near `resetSettings` (around line 3429 after the Phase 14 edit), add:

```js
const restorePreMigrationBackup = React.useCallback(async () => {
  if (!window.storage || !window.storage.get || !window.storage.set) {
    toast('Storage unavailable', 'err');
    return;
  }
  let snap;
  try {
    const r = await window.storage.get('wo_data_pre_migration_backup');
    if (!r || !r.value) {
      toast('No pre-migration backup found', 'err');
      return;
    }
    snap = r.value;
  } catch {
    toast('Could not read backup', 'err');
    return;
  }
  const ok = window.confirm(
    'Restore pre-migration backup? This REPLACES your current work order data with the snapshot taken just before the migration. Cannot be undone (the current data will be lost). Continue?'
  );
  if (!ok) return;
  try {
    await window.storage.set('wo_data', snap);
    toast('Backup restored. Reloading...');
    // Hard-reload to re-hydrate App state from the restored snapshot.
    setTimeout(() => location.reload(), 600);
  } catch {
    toast('Restore failed', 'err');
  }
}, [toast]);
```

Two design notes:
- `location.reload()` is intentional. The renderer's data hook
  (`useWorkOrders`) only reads storage once at mount. A reload is the
  cleanest way to re-hydrate; without it the App stays on stale
  in-memory state until next launch.
- The user gets a 600ms toast window to see "Backup restored" before
  the reload. Do not shorten -- some users will doubt the action
  fired.

### 3b. Wire the callback through to AboutSection

`AboutSection` already takes `onResetSettings`. Add a sibling prop
`onRestoreBackup`. Update the signature:

```js
function AboutSection({ onResetSettings, onRestoreBackup }) {
```

Add a SettingRow above (or below -- pick below, since restore is
narrower in scope than reset) the existing reset row:

```jsx
<SettingRow label="Restore pre-migration backup" hint="Replaces current data with the snapshot taken just before the last migration applied. Only available if you ticked 'Back up workbook first' during migration.">
  <ActionBtn onClick={onRestoreBackup}>Restore backup</ActionBtn>
</SettingRow>
```

Insert it inside the `<div style={{ marginTop: 24, ... borderTop }}>`
wrapper so it shares the same divider section as Reset.

### 3c. Forward through SettingsDrawer

`SettingsDrawer` already takes `onResetSettings`. Add a sibling prop
`onRestoreBackup`. Update the signature AND the consumption line for
About:

```jsx
{section === 'about' && <AboutSection onResetSettings={onResetSettings} onRestoreBackup={onRestoreBackup} />}
```

### 3d. Pass from App into SettingsDrawer

Find the existing `onResetSettings={resetSettings}` prop in App's
render and add a sibling:
```jsx
onResetSettings={resetSettings}
onRestoreBackup={restorePreMigrationBackup}
```

### 3e. Disable the button when no backup exists

Optional polish: on AboutSection mount, probe storage for the backup
and disable the button if absent. Out of scope for this phase -- the
error toast inside `restorePreMigrationBackup` is sufficient. Do NOT
implement a disabled state without a clear "checked at mount" pattern
or it will be wrong on first paint. Add a TODO comment in
`AboutSection`:

```jsx
{/* TODO: probe storage at mount and disable when no backup exists. */}
```

---

## TASK 4 -- Verification

Run these greps; report all results.

**Landing visibility:**
1. `settings.hasLaunched` -- exactly 0 hits.
2. `hasLaunched` -- exactly 0 hits (the derived constant is gone too).
3. `sessionStorage.getItem('tt-seen-launch')` -- exactly 1 hit.
4. `sessionStorage.setItem('tt-seen-launch'` -- exactly 1 hit.

**Landing freshness:**
5. The `key={i}` pattern on alert mapping is GONE in both
   `FullScreenLanding` (around line 3109) and the in-pane `Landing`
   (around line 2153). Grep `\.map\(\(a, i\) =>` and inspect each
   hit: every alert map MUST use `key={a.wo || ...}`. There may be
   other unrelated `(a, i)` mappers (e.g. activity log lines, bulk
   action buttons); only the two ALERT maps change.
6. `key={a.wo` -- at least 2 hits (one per landing component).

**Restore backup:**
7. `restorePreMigrationBackup` -- at least 1 hit (the useCallback).
8. `onRestoreBackup` -- at least 3 hits (App pass, drawer prop, about
   consumption).
9. `'wo_data_pre_migration_backup'` -- exactly 2 hits (1 write from
   Phase 14, 1 read added here).
10. `location.reload()` -- exactly 1 hit (and only inside the new
    restore callback).

**Regression checks (do NOT skip):**
11. `function migrateOrders` -- still exactly 1 hit (Phase 11).
12. `function densityFor` -- still exactly 1 hit (Phase 12).
13. `Catppuccin` -- still at least 1 hit (Phase 12).
14. `'#eff1f5'` -- still at least 1 hit (Phase 12).
15. `SYNC_INTERVAL_MS` -- still exactly 1 definition (Phase 13).
16. `tab: 'sent'` -- still at least 2 hits (Phase 13).
17. `invoicedOrders` -- still at least 2 hits (Phase 13).
18. `onMarkPaid` -- still at least 2 hits (Phase 14).
19. `resetSettings =` -- still exactly 1 hit (Phase 14).
20. `new Tray\(` in `main.js` -- still exactly 1 hit (Phase 10).
21. `function hexToRgba` -- still exactly 1 hit (Phase 9).
22. `o.priority` -- still only inside `migrateOrders` (Phase 11).

**Live test (rule 4):**
- Open the app. The full-screen landing should appear with brand
  block, greeting, and current alert cards.
- Click an alert card. App lands on that WO. Quit. Relaunch. The
  landing reappears. (Per-session, not persistent.)
- After dismissing once, refresh the renderer (DevTools -> reload).
  Landing should NOT reappear (sessionStorage persists across
  in-process reloads).
- Force-quit the Electron app and relaunch. Landing reappears.
- Trigger migration (DevTools: unset `settings.migrationApplied`,
  reload, apply migration with backup checked). Then Settings -> About
  -> "Restore backup" -> confirm. App should reload to pre-migration
  state.
- Trigger migration WITHOUT backup, then try restore. Should show
  toast "No pre-migration backup found".

If the landing still shows stale alerts after the index-key fix, STOP
and apply the rAF deferral from 2c (one-line change). Do not pile on
additional fixes.

---

## Out of scope (do NOT do)

- Migrating existing `settings.hasLaunched` values out of stored
  data. Leaving the orphan key is harmless.
- Adding a "disable Restore button when no backup exists" probe.
  TODO recorded in 3e.
- Wiring `onToolPreflight` in the Tools menu. `main.js` has no
  preflight handler; that is a Phase 16 candidate alongside any other
  main-process changes.
- Animating the in-pane `NeedsAttentionLanding` to match
  `FullScreenLanding`. Different layout, different intent.
- Touching the auto-updater banner. The user's "stale update reports"
  refers to alert cards on the landing, not to the OS-update banner.

---

## Risk flags (mitigate before committing)

1. **sessionStorage availability in Electron.** Electron renderer
   exposes `sessionStorage` by default. The try/catch around the
   reads/writes covers the very-rare disabled case. No mitigation
   beyond the try/catch needed. Verified by reading Electron docs:
   `BrowserWindow` enables web storage unless explicitly disabled in
   `webPreferences`, which `main.js` does NOT do (verified Phase 10).

2. **Restore wiping in-flight unsaved work.** Between the snapshot
   write (Phase 14) and the restore (Phase 15), the user may have
   added new WOs or notes. Restore clobbers those. The confirm dialog
   says exactly that ("REPLACES your current work order data ...
   Cannot be undone"). Acceptable; no further mitigation.

3. **`location.reload()` and Electron.** Reload inside Electron
   renderer is supported and re-hydrates the window. Confirmed by
   reading Electron docs for `BrowserWindow.reload()` equivalence.
   No special handling vs a browser.

4. **The animation cascade in FullScreenLanding still uses index `i`
   for the transition-delay math** (`560 + i * 80`). That is correct
   -- the delay should follow visual order, not data identity. Only
   the React `key` changes; the staggered delay stays index-based.

5. **TASK 2c's rAF deferral was flagged but not applied.** Per rule 4
   ("flagged risk must be mitigated or tested"): the mitigation IS
   the live test in TASK 4. If the test fails, switch on the rAF
   path. The static fix (stable keys) should be sufficient -- the
   rAF is the second-line defense, not the first.

6. **`hasLaunched` orphan key on disk.** Cleared by comment in 1b.
   Risk accepted.

---

## Commit message

`phase15: per-session landing gate + fresh alert keys + restore backup UI`
