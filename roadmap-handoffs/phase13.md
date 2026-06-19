# PHASE 13 -- Tab restructure (real Sent vs Invoiced) + sync-interval timer

Execute the tasks in order. Read every file you touch before editing. No
emojis, no em-dashes. After each task, grep to confirm.

---

## Why this phase (read first)

Two long-deferred items, both functional, both currently broken or no-op:

1. **The Sent/Invoiced tabs are a lie.** The sidebar lists both
   ("Sent to invoice" at line 1247-ish, "Invoiced" right below it), but
   only one bucket exists in the data layer. `tab='invoiced'` is the
   destination of `sendToInvoice`, the "Sent to invoice" view filters on
   `tab==='invoiced'`, and the "Invoiced" view is hardcoded
   `{ total: 0, groups: [] }`. Result: the second tab is always empty,
   and there is no way to distinguish "WO sent to billing queue but not
   yet invoiced in the workbook" from "WO actually invoiced and synced".
   This was deferred in Phase 11 and Phase 12. Phase 13 fixes it.

2. **The sync-interval setting does nothing.** Settings -> Workbook ->
   Sync interval has a Segmented control (30s / 2m / 10m / Manual)
   plumbed via `setSyncInterval` and stored on `settings.syncInterval`,
   but no `setInterval` reads the value. This is the same anti-pattern
   the density control had before Phase 12 -- a control with no
   consumer. Phase 13 wires it up.

---

## TASK 0 -- Read first (no edits)

1. `index.html` lines 1240-1260 (Sidebar `views` array, especially the
   `sent` and `invoiced` entries).
2. `index.html` lines 3470-3475 (partitions: `activeOrders`,
   `sentOrders`, `paidOrders`).
3. `index.html` lines 3549-3555 (`VIEW_BUILDERS` -- note `invoiced` is
   the hardcoded-empty one).
4. `index.html` around line 3536 (`bulkSendToInvoice`) and around line
   3674 (`sendToInvoice`) -- both currently set `tab: 'invoiced'`.
5. `index.html` around line 3395-3396 (`syncInterval` /
   `setSyncInterval` definitions).
6. `index.html` around line 3696-3716 (`globalSyncWorkbook` -- the
   timer will call this).
7. Grep `tab === 'invoiced'` and `tab: 'invoiced'` to enumerate every
   call site that needs review.
8. Grep `o.tab` and `cur.tab` to confirm no untracked consumers.

---

## TASK 1 -- Introduce `tab='sent'` as a distinct state

The data layer currently knows: `'active' | 'invoiced' | 'paid'` (and
implicit "trash" via `deleted`). After this task it knows:
`'active' | 'sent' | 'invoiced' | 'paid'`.

Semantic split:
- `sent`: WO has been pushed from the field into the office's billing
  queue. Bid amount is locked; the office knows to invoice it next.
  **No workbook sync has happened yet.**
- `invoiced`: WO has been billed in the workbook (sync succeeded at
  least once). Reaches Paid only when manually confirmed paid.

### 1a. Add a new partition

Find the partition block (around line 3470). Insert a new memo for
`sentOrders` and **rename** the existing one (currently mislabeled).

Current:
```js
const activeOrders = React.useMemo(() => orders.filter(o => !o.deleted && (o.tab || 'active') === 'active'), [orders]);
const sentOrders   = React.useMemo(() => orders.filter(o => !o.deleted && o.tab === 'invoiced'),             [orders]);
const paidOrders   = React.useMemo(() => orders.filter(o => !o.deleted && o.tab === 'paid'),                 [orders]);
```

Replace with:
```js
const activeOrders   = React.useMemo(() => orders.filter(o => !o.deleted && (o.tab || 'active') === 'active'), [orders]);
const sentOrders     = React.useMemo(() => orders.filter(o => !o.deleted && o.tab === 'sent'),                 [orders]);
const invoicedOrders = React.useMemo(() => orders.filter(o => !o.deleted && o.tab === 'invoiced'),             [orders]);
const paidOrders     = React.useMemo(() => orders.filter(o => !o.deleted && o.tab === 'paid'),                 [orders]);
```

### 1b. Wire the view builders to the right partitions

Find `VIEW_BUILDERS` (around line 3549). Replace the `sent` and
`invoiced` entries:

```js
sent:     () => ({ title: 'Sent to invoice', total: sentOrders.length,     groups: groupByPhase(sentOrders, phases) }),
invoiced: () => ({ title: 'Invoiced',        total: invoicedOrders.length, groups: groupByPhase(invoicedOrders, phases) }),
```

Leave `active`, `paid`, `trash` untouched.

### 1c. Update the Sidebar counts wiring

Grep `counts.invoiced` and `counts.sent` to find the counts assembly
(it lives in App near where Sidebar is rendered, search
`counts={{`). Wire `sent: sentOrders.length` and
`invoiced: invoicedOrders.length` separately. If the existing assembly
double-counts (e.g. `sent: sentOrders.length, invoiced:
sentOrders.length`), fix it.

### 1d. Split the transitions

`sendToInvoice` and `bulkSendToInvoice` currently jump straight to
`tab: 'invoiced'` AND trigger workbook sync. After this task they
become **Send to billing queue** (Active -> Sent, NO sync) and a new
**Mark invoiced** action (Sent -> Invoiced + sync).

Two precise edits:

**Edit A** -- `bulkSendToInvoice` (around line 3536). Change `tab:
'invoiced'` to `tab: 'sent'`, drop the `syncStatus: 'pending'` write
(no sync yet), and update the history entry text from `'sent to
Invoiced (bulk)'` to `'sent to billing queue (bulk)'`. Do NOT remove
the action; only retarget it.

**Edit B** -- `sendToInvoice` (around line 3674). Same retarget: set
`tab: 'sent'`, drop `syncStatus: 'pending'`, drop the `await
syncWOToWorkbook(o)` call at the end, update history string to `'sent
to billing queue'`. The function now ONLY moves the WO to the queue.

**Edit C** -- add a new action `markInvoiced(id)` that performs the
old behavior (Sent -> Invoiced + sync). Insert it near `sendToInvoice`:

```js
const markInvoiced = React.useCallback(async (id) => {
  const o = orders.find(x => x.id === id);
  if (!o) return;
  updateOrder(id, cur => ({
    ...cur,
    tab: 'invoiced',
    syncStatus: 'pending',
    history: [...(Array.isArray(cur.history) ? cur.history : []),
              { ts: Date.now(), action: 'marked invoiced', detail: '' }],
  }));
  await syncWOToWorkbook(o);
}, [orders, updateOrder, syncWOToWorkbook]);
```

Also add a bulk variant `bulkMarkInvoiced` modeled on
`bulkSendToInvoice` but writing `tab: 'sent' -> tab: 'invoiced'`,
gated on `o.tab === 'sent'`. After writing, sync once via
`globalSyncWorkbook`-style batch (or just call
`syncWOToWorkbook` per-id -- acceptable for now, optimize later if
slow).

**Edit D** -- the global sync still needs to mark every previously
`invoiced` WO as synced on success (line 3707). That logic stays --
just verify it still references `tab === 'invoiced'` (it should,
unchanged).

### 1e. Migration for existing data

Existing users have WOs with `tab === 'invoiced'` that semantically
should be `'sent'` (because they were just pushed to the billing queue
in the old single-step flow). However, distinguishing those from "real"
invoiced WOs after the fact is impossible without user input. Policy:
**leave existing `'invoiced'` WOs as-is.** The user can manually demote
any that have not actually been billed.

Add a one-line comment near the partition block:
```js
// Phase 13: pre-13 WOs with tab='invoiced' remain in Invoiced. Migrate
// manually via row context menu if any were never actually billed.
```

Do NOT add a bulk migration. Risk of false reclassification is too
high; the user explicitly knows which WOs are real.

### 1f. Row action: "Mark invoiced" entry point

The new `markInvoiced` callback needs at least one UI entry point so
the Sent tab is not a dead end.

Grep `sendToInvoice` to find the existing button in the row detail
pane / list row footer. There should be a primary action button on
rows in `tab === 'active'` (or wherever). Find it. Add a sibling
button shown when `tab === 'sent'`:

```jsx
{data.tab === 'sent' && onMarkInvoiced && (
  <ActionBtn primary onClick={() => onMarkInvoiced(data.id)}>Mark invoiced</ActionBtn>
)}
```

Wire `onMarkInvoiced` down through props the same way `onSyncWO` is
wired (grep `onSyncWO=` to copy the wiring exactly).

If the prop drilling gets noisy, that is acceptable for Phase 13 --
do not refactor to a context just for this. Phase 14 can clean up if
the user complains.

---

## TASK 2 -- Sync-interval timer

The `syncInterval` setting (values: `'30s' | '2m' | '10m' | 'manual'`)
must drive a periodic auto-sync. On `'manual'`, no timer fires (only
the explicit "Sync workbook" button).

### 2a. Add an interval-to-ms helper

Find the top-of-file tokens region (just after `DENSITY_MAP` and
`densityFor`, before `MIGRATION_VERSION`). Add:

```js
// Sync-interval token -> milliseconds. 'manual' returns 0 (no timer).
const SYNC_INTERVAL_MS = {
  '30s': 30 * 1000,
  '2m':  2  * 60 * 1000,
  '10m': 10 * 60 * 1000,
  'manual': 0,
};
function syncIntervalMs(value) {
  return SYNC_INTERVAL_MS[value] || 0;
}
```

### 2b. Wire a timer effect inside App

Find the App component, specifically near the other `React.useEffect`
blocks that depend on settings (the tray effect around line 3478 is a
good neighbor). Insert:

```js
// Phase 13: periodic workbook sync. Runs only when syncInterval !=
// 'manual' AND a workbookPath is set AND the bridge is present.
// Re-arms whenever syncInterval changes -- no need to manually clear.
React.useEffect(() => {
  const ms = syncIntervalMs(syncInterval);
  if (!ms) return;
  if (!workbookPath) return;
  if (!window.workbook || !window.workbook.sync) return;
  const handle = setInterval(() => {
    // Fire-and-forget. globalSyncWorkbook handles its own toasts and
    // error states. Do NOT toast 'Syncing...' here -- 30s cadence
    // would spam the user.
    globalSyncWorkbook();
  }, ms);
  return () => clearInterval(handle);
}, [syncInterval, workbookPath, globalSyncWorkbook]);
```

### 2c. Quiet the toast during auto-sync

`globalSyncWorkbook` (around line 3703) currently emits `toast('Syncing
workbook...')` on every call. For a 30s timer that becomes intolerable.

Two acceptable mitigations -- pick one:

**Option A (preferred):** Make `globalSyncWorkbook` take a `silent`
flag, default false. The new timer passes `true`. Existing callers
(button presses) keep the toast.

```js
const globalSyncWorkbook = React.useCallback(async (opts) => {
  const silent = !!(opts && opts.silent);
  if (!window.workbook || !window.workbook.sync) {
    if (!silent) toast('Workbook sync unavailable', 'err');
    return;
  }
  if (!silent) toast('Syncing workbook...');
  try {
    const r = await window.workbook.sync(workbookPath || '');
    if (r && r.ok) {
      batchUpdate(o => !o.deleted && o.tab === 'invoiced', cur => ({ ...cur, syncStatus: 'synced' }));
      if (!silent) toast('Workbook synced');
    } else {
      const msg = (r && (r.err || r.error)) || 'Unknown error';
      // Failures DO toast even in silent mode -- user needs to know.
      toast('Workbook sync failed: ' + String(msg).split('\n')[0], 'err');
    }
  } catch (e) {
    toast('Workbook sync failed', 'err');
  }
}, [batchUpdate, toast, workbookPath]);
```

Then the timer in 2b calls `globalSyncWorkbook({ silent: true })`.

**Option B:** Skip auto-sync entirely on 30s; treat 30s as a typo
warning. Reject this -- the user picked 30s for a reason.

Pick A.

### 2d. Confirm no main.js work needed

Grep `syncInterval` in `main.js` -- should return zero. Auto-sync is a
renderer concern; main only handles the IPC handler `sync-workbook`
which already exists. No edit to main.js or preload.js this phase.

---

## TASK 3 -- Verification

Run these greps; report all results.

**Tab restructure:**
1. `tab: 'sent'` -- at least 2 hits (single + bulk send-to-billing).
2. `tab: 'invoiced'` -- at least 2 hits (markInvoiced + bulk variant +
   any preserved logic).
3. `invoicedOrders` -- at least 2 hits (memo definition + view
   builder).
4. `function markInvoiced` -- 0 hits (it's a `useCallback`, not a
   function declaration).
5. `markInvoiced =` -- at least 1 hit.
6. `bulkMarkInvoiced` -- at least 2 hits (definition + use site).
7. `VIEW_BUILDERS` -- the `invoiced` entry must no longer be `total:
   0`. Grep `invoiced: () =>` and read the line -- must reference
   `invoicedOrders.length`.

**Sync timer:**
8. `SYNC_INTERVAL_MS` -- exactly 1 definition.
9. `function syncIntervalMs` -- exactly 1 hit.
10. `syncIntervalMs(syncInterval)` -- at least 1 hit (the effect).
11. `{ silent: true }` -- at least 1 hit (the timer's sync call).
12. `syncInterval` in `main.js` -- exactly 0 hits.

**Regression checks (do NOT skip):**
13. `function migrateOrders` -- still exactly 1 hit (Phase 11).
14. `function densityFor` -- still exactly 1 hit (Phase 12).
15. `Catppuccin` -- still at least 1 hit (Phase 12 TT_LIGHT header).
16. `'#eff1f5'` -- still at least 1 hit (Phase 12).
17. `TT_LIGHT = {` -- exactly 1 hit. TT_DARK unchanged.
18. `new Tray\(` in `main.js` -- still exactly 1 hit (Phase 10).
19. `function hexToRgba` -- still exactly 1 hit (Phase 9).
20. Grep `o.priority` -- still only inside `migrateOrders` (Phase 11).

**Live test (rule 4):**
- Take a WO in Active. Press "Send to invoice". It should land in the
  **Sent** sidebar tab (not Invoiced).
- On that WO in Sent, the row should show a "Mark invoiced" button. Press
  it. It should move to **Invoiced** AND trigger a workbook sync.
- Settings -> Workbook -> Sync interval -> 30s. Wait. Open DevTools
  Network tab or watch the main process console. A sync IPC call should
  fire every 30 seconds. Switch to Manual; calls stop.
- The 30s auto-sync should NOT pop a toast. The button-press sync still
  should.

If either visual check fails, STOP and re-read the relevant section
before patching.

---

## Out of scope (do NOT do)

- Real Needs Attention computation refactor (Phase 14 candidate).
- Per-row syncStatus indicators beyond what already exists (Phase 14).
- Backup-checkbox wiring in MigrationDialog (low value, defer).
- Touching TT_DARK or TT_LIGHT.
- Touching `main.js` or `preload.js`. Phase 13 is renderer-only.
- Bulk migrating pre-Phase-13 `tab='invoiced'` WOs to `'sent'`. The
  comment in 1e explains why.

---

## Risk flags (mitigate before committing)

1. **Stale closure in the sync timer.** The `useEffect` depends on
   `globalSyncWorkbook`, which is itself a `useCallback` whose deps
   include `workbookPath` and `toast`. If those change, the callback
   identity changes, the effect re-runs, the timer rearms -- correct.
   But if a future refactor inlines the sync logic, this guarantee
   breaks. Leave the dep array explicit; do NOT add an `eslint-disable
   exhaustive-deps`.

2. **30s sync may exceed RazorSync IO throughput.** The sync writes the
   workbook from disk on every call. Five users on 30s = 10 writes/min.
   Acceptable for a single-user app on a local file. If the user
   reports lag, the next phase can debounce or switch to mtime check.
   Do not pre-optimize.

3. **"Sent" with zero WOs feels empty for new users.** Before this
   phase, all billing-bound WOs landed in "Sent to invoice" (which was
   actually `'invoiced'`). After this phase, fresh `sendToInvoice`
   calls go to the new `'sent'` bucket. Existing data sits in
   `'invoiced'`. Users will see two populated tabs the first time the
   distinction matters; that is intended (the new bucket exists). Do
   NOT auto-redistribute.

4. **markInvoiced sync failure handling.** If `syncWOToWorkbook` fails
   inside `markInvoiced`, the WO is still in `tab='invoiced'` with
   `syncStatus='failed'`. The user can retry via the existing
   "Retry sync" button (grep `retrySyncWO`). Acceptable; no rollback.

5. **Tab transitions and Phase 11 migration interaction.** Phase 11's
   `migrateOrders` does not touch `o.tab`. Re-running migration on
   Phase-13-era data is still safe (the idempotency guards still hold).
   Confirmed by reading migrateOrders.

6. **Light-mode hard-coded white was checked in static review** (Phase
   12 risk flag). Conclusion documented inline: the 3 hits of `#fff` /
   `rgba(255,255,255,...)` are all white text on the
   accent-colored bulk-action bar and update banner. Intentional;
   render correctly under both themes. No fix needed. Mitigation
   recorded per rule 4.

---

## Commit message

`phase13: real Sent/Invoiced tab split + sync-interval timer`
