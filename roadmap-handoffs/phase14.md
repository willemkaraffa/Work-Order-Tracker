# PHASE 14 -- Tools menu, detail-header action labels, Reset settings, backup-on-migrate

Execute tasks in order. Read every file you touch before editing. No
emojis, no em-dashes. After each task, grep to confirm.

**Precondition:** Phase 13 must be applied (real `tab='sent'` partition,
`markInvoiced` callback, and `globalSyncWorkbook(opts)` signature with
silent flag). Confirm by greps in TASK 0.

---

## Why this phase (read first)

Audit of the README handoff (`design_handoff_trade_tracker/README.md`)
against the current code finds four gaps -- three from the spec, one
from a Phase 11 follow-up that was deferred:

1. **Sidebar "Tools" item is a placeholder.** `<SBRow label="Tools"
   suffix={'▾'} muted />` (around line 1286) does nothing. README sec.
   2 item 3 explicitly says "the current header bar actions move under
   here: Import from Extension, Preflight, Sync Workbook, Export CSV."
   None are wired to this entry point.

2. **Detail-header primary action label is fixed at "Send to Invoice"**
   (line 712, line 1779, line 1884). README sec. Interactions specifies
   the label must change per tab:
   - `active`  -> `Send to Invoice ->`
   - `sent`    -> `Mark Invoiced ->`
   - `invoiced` -> `Mark Paid ->`
   - `paid`    -> no primary action; only `...`
   Phase 13 added `markInvoiced` but only on the row footer; the
   spec calls for it in the **sticky detail header**.

3. **Reset all settings** button (README sec. 5 item 6) is missing from
   the About section.

4. **Migration backup checkbox** in `MigrationDialog` is rendered but
   unwired (Phase 11 explicitly deferred). README sec. 6 calls it out
   as part of the migration flow. Wire it so a checked box forces a
   fresh JSON backup snapshot before `applyMigration` runs.

---

## TASK 0 -- Read first (no edits)

1. `phase13.md` Tasks 1c and 1f (so you know what `markInvoiced` and the
   row-action prop drilling look like).
2. `index.html` line 1286 (the Tools placeholder).
3. `index.html` lines 700-720 (`nextAction` derivation in the data
   layer).
4. `index.html` lines 1770-1900 (detail header sticky region and the
   primary action click handler around line 1884).
5. `index.html` around line 3200 (`MigrationDialog` component -- the
   "Back up workbook first" checkbox).
6. `index.html` around line 3360 (`applyMigration`). Phase 11 wiring.
7. Grep `window.extensionBridge`, `preflight`, `export-csv`,
   `electronExport.saveCsv` to confirm the 4 Tools actions are real
   IPC endpoints.
8. Grep `storage.set('wo_data_backup` -- expect zero. Phase 14 adds the
   first explicit pre-migration backup.

### Phase 13 regression preflight (REQUIRED)

Run these greps; STOP if any fail:
- `function markInvoiced` -- 0 hits (it's a useCallback).
- `markInvoiced =` -- at least 1 hit.
- `invoicedOrders` -- at least 2 hits.
- `SYNC_INTERVAL_MS` -- exactly 1 definition.
- `tab: 'sent'` -- at least 2 hits.

If Phase 13 is not applied, STOP and surface to the user instead of
proceeding.

---

## TASK 1 -- Tools dropdown menu

Replace the static placeholder at line 1286 with a real expandable
menu. Match the visual treatment of saved-view rows: clickable, hover
state, opens an inline list of items beneath the row (NOT a floating
popover -- inline disclosure is simpler, matches sidebar density, and
avoids z-index issues with the rest of the shell).

### 1a. Add state and items in `Sidebar`

`Sidebar` already receives props (`onAddWO`, etc.). Add four new
optional callbacks: `onToolImport`, `onToolPreflight`, `onToolSync`,
`onToolExport`. Forward them from App (TASK 1c) but treat missing
callbacks as "disable that row" so the menu degrades gracefully if a
bridge is absent.

Inside `Sidebar`, add `const [toolsOpen, setToolsOpen] = React.useState(false);`
near the top of the function body.

### 1b. Render the expandable group

Replace:
```jsx
<SBRow label="Tools" suffix={'▾'} muted />
```

with:
```jsx
<SBRow
  label="Tools"
  suffix={toolsOpen ? '▴' : '▾'}
  muted
  onClick={() => setToolsOpen(v => !v)}
/>
{toolsOpen && (
  <div style={{ marginLeft: 14, display: 'flex', flexDirection: 'column', gap: 1 }}>
    {onToolImport   && <SBRow label="Import from extension" onClick={onToolImport} />}
    {onToolPreflight && <SBRow label="Preflight"             onClick={onToolPreflight} />}
    {onToolSync     && <SBRow label="Sync workbook"          onClick={onToolSync} />}
    {onToolExport   && <SBRow label="Export CSV"             onClick={onToolExport} />}
  </div>
)}
```

`SBRow` already supports an `onClick` and hover state (grep `SBRow` if
unsure). Do NOT introduce a new primitive.

### 1c. Wire the callbacks in App

App already has the underlying handlers. Map them:

- `onToolImport` -> dispatch the existing extension import flow. Grep
  `extensionBridge.acknowledge` to find the current call site; if the
  import is purely passive (handler fires on push from main), this
  button can manually re-trigger a re-poll. If there is no manual
  re-trigger path, **omit `onToolImport` for now** and add a one-line
  comment near the Sidebar prop forwarding:
  ```js
  // Tools.Import is push-driven via extensionBridge; no manual fire path yet.
  ```
- `onToolPreflight` -> grep `preflight` in `index.html` and `main.js`.
  If a preflight function exists, wire it. If it does not exist
  (likely), omit the prop and add a comment:
  ```js
  // Tools.Preflight not yet implemented in main.js; deferred to Phase 15.
  ```
- `onToolSync` -> `globalSyncWorkbook` (Phase 13 callback). Always
  pass `{ silent: false }` so the user sees the toast (manual action).
- `onToolExport` -> grep `electronExport.saveCsv`. If there is an
  existing CSV-export callback in App, reuse it. If not, build a
  thin wrapper that exports the current view's filtered rows as CSV.

The point of this task is **wiring existing infrastructure, not
building new infrastructure**. If a tool's backing function does not
exist, **omit the row** rather than fake-wire it. Rule 1 (search and
wrap) applies.

### 1d. Verify the Sidebar group spacing still reads right

The `<div style={{ height: 12 }} />` spacer below the old placeholder
should remain. The expanded items inset by 14px should sit between the
Tools row and the views list without jumping the layout.

---

## TASK 2 -- Detail-header action label per tab

Currently the action is hardcoded "Send to Invoice" via `nextAction`
in the data layer (around line 712) and dispatched in the detail
header click handler (around line 1884).

After this task:
- `o.tab === 'active'`   -> label `Send to Invoice ->`,    callback `onSendToInvoice`
- `o.tab === 'sent'`     -> label `Mark Invoiced ->`,      callback `onMarkInvoiced`
- `o.tab === 'invoiced'` -> label `Mark Paid ->`,          callback `onMarkPaid`
- `o.tab === 'paid'`     -> no primary action; only `...` overflow

### 2a. Generalize `nextAction` derivation

Grep `nextAction` to find every read. Around line 712 a single helper
sets it; line 1779 has a mock; line 1884 dispatches it. The current
derivation is approximately:
```js
if (!o.deleted && tab === 'active') nextAction = 'Send to Invoice';
```

Replace with:
```js
let nextAction = null;
if (!o.deleted) {
  if (tab === 'active')        nextAction = 'Send to Invoice';
  else if (tab === 'sent')     nextAction = 'Mark Invoiced';
  else if (tab === 'invoiced') nextAction = 'Mark Paid';
  // tab === 'paid' -> nextAction stays null
}
```

### 2b. Add `markPaid` if it does not exist

Grep `markPaid` -- there's an existing MenuItem at line 1845
(`onClick={act('markPaid')}`). Confirm whether `markPaid` is already
a callback in App; if it lives only as a MenuItem dispatch, promote it
to a proper `useCallback` that mirrors Phase 13's `markInvoiced`:

```js
const markPaid = React.useCallback((id) => {
  updateOrder(id, cur => ({
    ...cur,
    tab: 'paid',
    history: [...(Array.isArray(cur.history) ? cur.history : []),
              { ts: Date.now(), action: 'marked paid', detail: '' }],
  }));
}, [updateOrder]);
```

No workbook sync on Paid (per README -- "Paid view suppresses age tint"
implies it's a terminal/archival state; the workbook write happens at
Invoice time).

### 2c. Pass `onMarkInvoiced` and `onMarkPaid` through to the detail pane

Find the detail-pane prop list. It already receives `onSendToInvoice`
(grep `onSendToInvoice=` -- around line 3924). Add the two siblings:
```jsx
onSendToInvoice={sendToInvoice}
onMarkInvoiced={markInvoiced}
onMarkPaid={markPaid}
```

### 2d. Update the detail-header click dispatcher

Around line 1884 the dispatcher reads:
```js
if (data.nextAction === 'Send to Invoice' && onSendToInvoice) onSendToInvoice(data.wo);
```

Replace with:
```js
if (data.nextAction === 'Send to Invoice' && onSendToInvoice) onSendToInvoice(data.wo);
else if (data.nextAction === 'Mark Invoiced' && onMarkInvoiced) onMarkInvoiced(data.wo);
else if (data.nextAction === 'Mark Paid'    && onMarkPaid)     onMarkPaid(data.wo);
```

### 2e. Sticky header hides the button on Paid

The render for the action button (search near line 1884 upward for
where `data.nextAction` is read for the button text). Already returning
null when `nextAction` is falsy will suffice. Confirm by reading the
JSX.

If the existing code renders the button unconditionally with text
falling back to a default, fix it: button only renders when
`data.nextAction` is truthy.

### 2f. Remove the row-footer `Mark invoiced` button added in Phase 13

Phase 13 added a button at the row-detail-footer level. After Task 2c,
the canonical entry point is the **detail header sticky bar**, per
README. Remove the row-footer duplicate to avoid two buttons firing
the same callback.

Grep `onMarkInvoiced` rendered inside any row component (NOT in the
detail header). If a row-level render exists, delete it. Keep the prop
on the row component if other code depends on it; just remove the JSX
button. The detail header is the source of truth for primary actions.

---

## TASK 3 -- Reset all settings button (About section)

Find `AboutSection` (grep `function AboutSection`). README sec. 5 item 6:
"About — Gamble mark + version + Reset all settings."

Add a single danger-styled button at the bottom of `AboutSection`:

```jsx
<div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border-1)' }}>
  <SettingRow label="Reset all settings" hint="Restores theme, density, alerts, sync interval, tray, and workbook path to defaults. Does NOT touch your WOs.">
    <ActionBtn onClick={onResetSettings} danger>Reset settings</ActionBtn>
  </SettingRow>
</div>
```

### 3a. Wire `onResetSettings` in App

Add a callback near the other settings callbacks (around line 3395
where `setSyncInterval` lives):

```js
const resetSettings = React.useCallback(() => {
  const ok = window.confirm(
    'Reset all settings to defaults? Your work orders will NOT be affected. Continue?'
  );
  if (!ok) return;
  // Preserve migrationApplied so the migration dialog does not re-fire.
  const preserved = { migrationApplied: settings.migrationApplied || MIGRATION_VERSION };
  updateSettings({
    theme: 'dark',
    density: 'balanced',
    alertThresholds: DEFAULT_ALERT_THRESHOLDS,
    workbookPath: WORKBOOK_PATH_DEFAULT,
    syncInterval: '2m',
    trayEnabled: true,
    trayBadgeSource: 'attention',
    viewSorts: {},
    ...preserved,
  });
  toast('Settings reset');
}, [settings, updateSettings, toast]);
```

Forward `resetSettings` to `SettingsDrawer` as `onResetSettings`, and
from there to `AboutSection`. Do NOT use a context just for this --
direct prop drilling matches the rest of SettingsDrawer.

### 3b. ActionBtn `danger` variant

Grep `ActionBtn` to confirm the existing primitive accepts a `danger`
prop. If not, add one:
```js
// inside ActionBtn:
const bg = props.danger ? 'var(--flag-emergency)' : (props.primary ? 'var(--accent)' : 'var(--bg-surface-2)');
const fg = (props.danger || props.primary) ? 'var(--accent-fg)' : 'var(--text-1)';
```

Do NOT introduce a new component.

---

## TASK 4 -- Migration backup checkbox wiring

`MigrationDialog` shows "Back up workbook first" checked by default
(Phase 11 left it unwired). After this task, applying the migration
with the box checked writes a one-off backup snapshot to storage
**before** the data transform runs. Box unchecked = no backup (user
opt-out).

Note the README phrasing: "Back up **workbook** first." In practice
the data we own is `wo_data` JSON, not the Excel workbook. The
`main.js -> rotateBackups()` system already handles workbook rotation
on every write (Phase 11 risk flag #1 documented this). What this
checkbox guarantees is a **one-off `wo_data` snapshot stored under a
stable backup key**, so the user can roll back the migration
specifically.

### 4a. Expose the checkbox state to the parent

`MigrationDialog` currently has its own local state for the checkbox.
Lift it: take `backupBeforeApply` and `setBackupBeforeApply` as props
from App, defaulting to `true`.

Grep `MigrationDialog` to find both the component and its render site.
Add the two props at both ends. Default the App-side state:
```js
const [backupBeforeApply, setBackupBeforeApply] = React.useState(true);
```

### 4b. Snapshot inside `applyMigration`

Edit the Phase 11 `applyMigration` callback (around line 3362). Pre-pend
a backup step when `backupBeforeApply` is true:

```js
const applyMigration = React.useCallback(async () => {
  // Phase 14: one-off wo_data snapshot for explicit migration rollback.
  if (backupBeforeApply && window.storage && window.storage.set) {
    try {
      const snap = JSON.stringify({ ts: Date.now(), data: dataRef.current });
      await window.storage.set('wo_data_pre_migration_backup', snap);
    } catch { /* swallow -- migration proceeds regardless. */ }
  }
  const migrated = migrateOrders(orders);
  updateData({
    orders: migrated,
    settings: { ...settings, migrationApplied: MIGRATION_VERSION },
  });
}, [orders, settings, updateData, backupBeforeApply]);
```

**Important:** `dataRef.current` is only accessible inside the
`useWorkOrders` hook. If `applyMigration` lives in App and `dataRef`
is private to the hook, expose a `snapshot` accessor from the hook
instead. Read `useWorkOrders` to see what's already returned -- there
is a 12-tuple per the Phase 9 context. Find the right slot or
extend the return shape by ONE function. Be precise: do not refactor
the hook's API beyond adding the snapshot accessor.

If that refactor risks breaking unrelated callers, simpler fallback:
re-read storage directly inside `applyMigration`:
```js
const r = await window.storage.get('wo_data');
if (r && r.value) await window.storage.set('wo_data_pre_migration_backup', r.value);
```

Pick the fallback if the hook return surface is uncomfortable.

### 4c. Surface a "Restore pre-migration backup" path

Out of scope for Phase 14. Add a TODO comment near the backup write:
```js
// TODO Phase 15: Settings -> About -> "Restore pre-migration backup".
```

The snapshot is enough for now; manual restoration via DevTools is a
valid emergency hatch.

---

## TASK 5 -- Verification

Run these greps; report all results.

**Tools menu:**
1. `toolsOpen` -- exactly 2 hits (useState definition + render condition).
2. `Import from extension` -- exactly 1 hit (the SBRow label).
3. `Sync workbook` -- at least 1 hit (the SBRow label; Phase 13's
   button may also exist).

**Detail-header action labels:**
4. `'Mark Invoiced'` -- at least 2 hits (the nextAction derivation +
   the dispatcher branch).
5. `'Mark Paid'` -- at least 2 hits.
6. `onMarkInvoiced` -- at least 2 hits (prop pass + dispatcher use).
7. `onMarkPaid` -- at least 2 hits.
8. The Phase-13 row-footer `Mark invoiced` button is REMOVED. Grep
   `Mark invoiced` (lowercase i) -- should NOT appear as a button
   label in any row component. (Detail-header uses `Mark Invoiced`
   with capital I.)

**Reset settings:**
9. `resetSettings =` -- exactly 1 hit.
10. `onResetSettings` -- at least 2 hits (prop pass through drawer
    plus consumption in AboutSection).
11. `'wo_data_pre_migration_backup'` -- exactly 1 write site.

**Migration backup:**
12. `backupBeforeApply` -- at least 3 hits (state, prop, conditional).

**Regression checks (do NOT skip):**
13. `function migrateOrders` -- still exactly 1 hit (Phase 11).
14. `function densityFor` -- still exactly 1 hit (Phase 12).
15. `Catppuccin` -- still at least 1 hit (Phase 12).
16. `'#eff1f5'` -- still at least 1 hit (Phase 12).
17. `SYNC_INTERVAL_MS` -- still exactly 1 definition (Phase 13).
18. `tab: 'sent'` -- still at least 2 hits (Phase 13).
19. `invoicedOrders` -- still at least 2 hits (Phase 13).
20. `new Tray\(` in `main.js` -- still exactly 1 hit (Phase 10).
21. `function hexToRgba` -- still exactly 1 hit (Phase 9).
22. `o.priority` -- still only inside `migrateOrders` (Phase 11).

**Live test (rule 4):**
- Open Sidebar -> click "Tools". List expands. Each tool action does
  what it says (Sync workbook fires a sync with toast; Export CSV
  saves a file; Import + Preflight either work or are absent per the
  task 1c guidance).
- Select a WO in Active. The detail header shows "Send to Invoice ->".
  Click it -> WO moves to Sent. Header now reads "Mark Invoiced ->".
  Click it -> moves to Invoiced + sync fires. Header now reads "Mark
  Paid ->". Click it -> moves to Paid. Header shows no primary action
  button (overflow `...` still present).
- Open Settings -> About. Click "Reset settings". Confirm dialog. After
  confirm, theme returns to dark, density to balanced, etc. WOs are
  untouched.
- Force the migration dialog (manually unset `settings.migrationApplied`
  via DevTools, refresh). With the checkbox checked, click Apply. Read
  `wo_data_pre_migration_backup` from storage in DevTools -- it should
  contain a `{ ts, data }` snapshot.

If any visual check fails, STOP and re-read the relevant section
before patching.

---

## Out of scope (do NOT do)

- Restore-pre-migration-backup UI in Settings (deferred to Phase 15).
- Real Needs Attention computation refactor -- the existing
  `computeAlerts` filters on `o.tab === 'active'`, which after
  Phase 13 means Sent WOs no longer raise alerts even if stale.
  **That is the correct behavior** (Sent is a deliberate parking
  bucket); do NOT widen the filter.
- Per-column sortable header `⇅` icons -- the existing
  `SortDropdown` already exposes sort; the README's per-column-icon
  language is contradicted by the two-line row layout that has no
  columns to attach icons to. Skip until the user explicitly asks.
- Per-row syncStatus indicators beyond `SyncPill` (which exists).
- Tweaking light or dark palettes.
- Touching `main.js` or `preload.js` (Phase 14 is renderer-only;
  Tools menu wraps existing bridges).

---

## Risk flags (mitigate before committing)

1. **Tools menu vs. existing scattered actions.** The 4 tool actions
   may already render as buttons elsewhere (e.g. header bar). README
   said "current header bar actions move under here." If duplicates
   exist after Phase 14, the user has two paths to the same call.
   Acceptable for one phase; flag in the live test. If the user
   reports redundancy, Phase 15 can remove the old header buttons.

2. **Action label switch + Phase 13 row button removal.** If Task 2f
   misses a render site, two buttons fire `markInvoiced`. The verify
   step 8 catches this. Do not skip.

3. **Reset settings preserving migrationApplied.** If a user resets
   settings and the migration flag is dropped, the dialog re-fires
   and the user sees a confusing "welcome to 2.0" modal. The
   `...preserved` spread in 3a guards against this. Verify the spread
   comes LAST so it overrides the defaults block.

4. **Backup snapshot vs. storage size.** `wo_data` can grow large
   (notes, history). A snapshot doubles storage temporarily. For a
   single-user local app this is fine. Do not pre-optimize. If
   `window.storage.set` throws (quota), the catch swallows it and
   migration still proceeds -- acceptable per Phase 11 risk flag #1.

5. **README spec vs. user-rejected light-mode.** README sec. "Colors"
   lists pure white surfaces for light mode. The user rejected pure
   white twice (Phase 10, 11), and Phase 12 ported Catppuccin Latte.
   Do NOT revert the palette to match README. The README is the
   *original* design intent; user feedback supersedes. Per rule 3,
   we already re-examined the approach and locked in Latte. Leave it.

6. **`window.confirm` in Electron.** Works fine in renderer. Some
   teams replace with a custom modal for design parity; do NOT do
   that here -- a confirm-prompt is correct for destructive irreversible
   actions and matches Electron's idiomatic behavior. README does not
   spec a custom modal for this.

---

## Commit message

`phase14: tools menu, detail-header action labels, reset settings, migration backup`
