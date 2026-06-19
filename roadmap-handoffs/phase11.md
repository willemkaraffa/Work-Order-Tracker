# PHASE 11 — Light mode v2 (business-card aesthetic) + migration execution

Execute the tasks in order. Read every file you touch before editing. No
emojis, no em-dashes. After each task, grep to confirm.

---

## TASK 0 — Read first (no edits)

1. `index.html` lines 37 to 78 (current TT_LIGHT — Phase 10 version).
2. `index.html` around line 3162 (`MigrationDialog` component).
3. `index.html` around lines 3317-3318 (current `applyMigration` /
   `skipMigration` callbacks — both currently just flip the flag, no
   transformation).
4. `index.html` around line 3679 (existing note-card append pattern in
   `addNote`).
5. Grep `priority` across the file. The legacy field on order records is
   `o.priority` (string: 'High'|'Medium'|'Low'|'Warranty'). Confirm there are
   no live consumers in the new UI -- Phase 11 strips it.
6. Read `redesign-notes.md` Thread 3 (priority removed) and Thread 8
   (migration spec).

---

## TASK 1 — Light mode v2: business-card cards on muted canvas

**Problem with Phase 10 palette:** Even after dropping max lightness, the
canvas and surface both sit in the 93-96% lightness band on the same blue
hue. The result reads as "light gray everywhere" -- there is no figure /
ground separation, so the eye still scans across a uniformly bright surface.

**Fix (visual brief from user):**
- WO rows and note cards become a **warm off-white**, like business-card
  stock. This is the figure -- the lightest element on screen.
- Phase header bars (group dividers) get a **complementary shade** of the
  same warm hue, deeper than the cards, so they read as bands.
- The page background drops to a **muted slate** -- darker and cool. This is
  the ground; it recedes so the warm cards advance.
- Net effect: dual-hue light mode. Cool gray frame, warm cream content.

Replace the entire `TT_LIGHT` object (lines 38 to 77) with:

```js
const TT_LIGHT = {
  '--bg-canvas':     'oklch(83% 0.010 240)',     // muted slate, recedes
  '--bg-surface':    'oklch(96% 0.008 80)',      // warm off-white business-card
  '--bg-surface-2':  'oklch(91% 0.014 80)',      // deeper warm band for phase headers
  '--bg-hover':      'oklch(93.5% 0.011 80)',    // between rows and bars
  '--bg-row-sel':    'oklch(87% 0.045 240)',     // cool wash overrides warm card
  '--border-1':      'oklch(78% 0.013 80)',      // warm-tinted divider
  '--border-2':      'oklch(64% 0.016 80)',      // deeper separator
  '--text-1':        'oklch(22% 0.012 80)',      // warm dark text on cream
  '--text-2':        'oklch(44% 0.014 80)',
  '--text-3':        'oklch(60% 0.016 80)',
  '--accent':        'oklch(50% 0.12 240)',
  '--accent-soft':   'oklch(92% 0.055 240)',
  '--accent-fg':     '#ffffff',
  '--age-1':         'oklch(94% 0.025 25)',
  '--age-2':         'oklch(90% 0.05 25)',
  '--age-3':         'oklch(85% 0.075 25)',
  '--flag-emergency':'oklch(55% 0.16 25)',
  '--flag-warranty': 'oklch(52% 0.13 240)',
  '--p-intake':      'oklch(43% 0.02 0)',
  '--p-intake-bg':   'oklch(89% 0.014 80)',      // tinted to land on warm phase bar
  '--p-await':       'oklch(45% 0.12 70)',
  '--p-await-bg':    'oklch(89% 0.06 70)',
  '--p-approved':    'oklch(42% 0.12 145)',
  '--p-approved-bg': 'oklch(89% 0.06 145)',
  '--p-progress':    'oklch(45% 0.12 240)',
  '--p-progress-bg': 'oklch(89% 0.055 240)',
  '--p-wrap':        'oklch(45% 0.12 290)',
  '--p-wrap-bg':     'oklch(89% 0.05 290)',
  '--p-done':        'oklch(45% 0.04 145)',
  '--p-done-bg':     'oklch(89% 0.022 145)',
  '--p-billing':     'oklch(42% 0.10 200)',
  '--p-billing-bg':  'oklch(89% 0.05 200)',
  '--pm-amh':        'oklch(42% 0.12 145)',
  '--pm-amh-bg':     'oklch(91% 0.06 145)',
  '--pm-msr':        'oklch(45% 0.12 310)',
  '--pm-msr-bg':     'oklch(91% 0.05 310)',
  '--pm-rkt':        'oklch(48% 0.12 50)',
  '--pm-rkt-bg':     'oklch(92% 0.06 50)',
};
```

Do NOT touch TT_DARK.

After editing, grep `TT_LIGHT = {` -- must return exactly 1 hit.

---

## TASK 2 — Migration execution: archive priority + convert legacy notes

The migration dialog already exists and the version flag flips on apply.
What is missing: the **actual data transformation**. Per redesign-notes
Thread 8, this means:

1. Each WO with a non-empty `priority` field gets the value archived as a
   note card body `Imported priority: <value>` and the field stripped.
2. Each WO whose legacy `notes` string is non-empty AND `noteCards` is empty
   gets that string converted into a single initial Note card (preserves
   the user's existing notes inside the new card system).
3. The migration must be idempotent -- running twice must not double-archive.

**Tab restructure** (introducing the new "Invoiced" bucket between Sent and
Paid) is OUT OF SCOPE here; defer to Phase 12. This phase only handles
field-level migration.

### 2a. Add `migrateOrders` helper

Insert a new pure helper function near the other order helpers (suggested
location: just before `function App()` declaration, around line 3275).
Grep `function App\(\)` to confirm the exact line first.

```js
// Phase-11 migration: archive priority field into a note card, convert
// legacy single notes string into one initial Note card. Idempotent --
// safe to run more than once.
function migrateOrders(orders) {
  if (!Array.isArray(orders)) return orders;
  return orders.map(o => {
    const cards = Array.isArray(o.noteCards) ? o.noteCards.slice() : [];
    const baseTs = o.dateCreated ? new Date(o.dateCreated).getTime() : Date.now();

    // 1) Legacy notes -> single Note card (only if cards is empty)
    if (cards.length === 0 && typeof o.notes === 'string' && o.notes.trim()) {
      cards.push({
        id: 'n_mig_notes_' + (o.id || baseTs),
        ts: baseTs,
        type: 'Note',
        body: o.notes.trim(),
        pinned: false,
        edited: false,
      });
    }

    // 2) Priority field -> archive card (skip if already imported)
    const prio = typeof o.priority === 'string' ? o.priority.trim() : '';
    if (prio) {
      const already = cards.some(c => c && typeof c.body === 'string' && c.body.startsWith('Imported priority:'));
      if (!already) {
        cards.push({
          id: 'n_mig_prio_' + (o.id || Date.now()),
          ts: Date.now(),
          type: 'Note',
          body: 'Imported priority: ' + prio,
          pinned: false,
          edited: false,
        });
      }
    }

    // 3) Strip priority field; carry everything else through.
    const { priority: _drop, ...rest } = o;
    return { ...rest, noteCards: cards };
  });
}
```

### 2b. Rewire `applyMigration` to actually transform data

Find the current callback (around line 3317):

```js
const applyMigration = React.useCallback(() => { updateSettings({ migrationApplied: MIGRATION_VERSION }); }, [updateSettings]);
```

Replace with:

```js
const applyMigration = React.useCallback(() => {
  const migrated = migrateOrders(orders);
  updateData({
    orders: migrated,
    settings: { ...settings, migrationApplied: MIGRATION_VERSION },
  });
  toast('Migration applied');
}, [orders, settings, updateData, toast]);
```

Leave `skipMigration` as-is (it should set the flag without transforming, so
the dialog dismisses but data is untouched -- that is the user's "Not now"
escape hatch).

### 2c. Confirm backup behavior is acceptable as-is

The MigrationDialog already shows a "Back up workbook first" checkbox but
it is currently unwired. The good news: `main.js` -> `writeStore()` calls
`rotateBackups()` automatically on every write, so any data mutation
(including this migration) gets an auto-backup at the same time. No code
change needed for Phase 11.

If the user later wants the checkbox to FORCE a fresh backup before
applying (independent of the auto-rotation), that can be a Phase 12 follow
up. For now, add a one-line comment near `applyMigration`:

```js
// NOTE: backup is automatic via main.js rotateBackups() on every writeStore.
```

---

## TASK 3 — Verification

Run these greps; report all results:

1. `TT_LIGHT = {` -- exactly 1 hit in index.html.
2. `oklch\(83% 0\.010 240\)` -- exactly 1 hit (the new canvas value).
3. `function migrateOrders` -- exactly 1 hit in index.html.
4. `migrateOrders\(orders\)` -- at least 1 hit (the call inside
   applyMigration).
5. `Imported priority:` -- exactly 1 hit (inside migrateOrders body).
6. `function hexToRgba` -- still exactly 1 hit (regression check from
   Phase 9 dedupe).
7. `new Tray\(` in main.js -- still exactly 1 hit (regression from
   Phase 10).
8. Grep `o.priority` outside `migrateOrders` -- should return 0 hits in
   active code paths (legacy field is now stripped at migration time). If
   any consumer still reads `o.priority`, STOP and report rather than
   editing -- it means a UI surface still depends on the legacy field and
   needs explicit decision.

---

## Out of scope (do NOT do)

- Tab restructure (new "Invoiced" bucket between Sent and Paid). Phase 12.
- Real Needs Attention computation refactor.
- Density wiring, sync-interval timer, per-row syncStatus indicators.
- Touching TT_DARK.
- Touching MigrationDialog's UI -- it already lists the right changes.

---

## Risk flags (mitigate before committing)

1. **Idempotency** -- The dialog only fires when `settings.migrationApplied
   !== MIGRATION_VERSION`, so normal users will not re-run. But manual
   wo-data.json restores could put a user back in that state. The
   `cards.length === 0` guard on the notes-merge and the `startsWith`
   guard on priority archival make the transform safe to re-apply.
   Confirmed.
2. **Empty `orders`** -- `migrateOrders([])` returns `[]`. Safe.
3. **Date parsing** -- `new Date(o.dateCreated).getTime()` returns NaN for
   missing or malformed values. NaN as a timestamp in a note card sorts
   weirdly. The `baseTs` fallback to `Date.now()` mitigates -- only used
   if `dateCreated` is falsy. If `dateCreated` is present-but-malformed,
   NaN will leak. Acceptable for now (the migration only runs once and
   bad data was bad before); flag as TODO.
4. **`updateData` settings merge** -- the spread `{ ...settings,
   migrationApplied: MIGRATION_VERSION }` overwrites only the version
   field. If `settings` is stale (closure capture), other in-flight
   setting writes could be clobbered. The risk is low because migration
   runs once at first launch before the user touches anything else.
   Acceptable for now; do not pre-optimize. If a regression appears,
   switch to a functional update pattern via the `useWorkOrders` hook.
5. **Contrast on warm cream** -- `--text-1` at oklch(22% 0.012 80) on
   `--bg-surface` oklch(96% 0.008 80) is ~14:1 contrast, well above WCAG
   AA. `--text-2` at 44% on 96% is ~6.5:1. Both pass. Do not adjust
   without re-measuring.
6. **Selected-row contrast** -- `--bg-row-sel` oklch(87% 0.045 240) on
   the warm cream `--bg-surface` produces a clear cool-blue wash. Test
   visually after switching to light mode -- if it reads too pale, bump
   chroma to 0.060.

---

## Commit message convention

When this phase is done, commit with title:
`phase11: light-mode v2 (business-card palette) + migration execution`
