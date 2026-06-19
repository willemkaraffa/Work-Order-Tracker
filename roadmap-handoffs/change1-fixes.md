# CHANGE #1 - follow-up fixes (sort: Last Note bug, Status lock, direction toggle)

Continues the sort work on the Work Order Tracker (Electron + React-via-Babel desktop app, Python sync backend). Work in this repo:

```
C:\dev\Work-Order-Tracker
```

Branch: `claude/roadmap-v3.1`. App version 3.0.1. User runs the dev build with `npm start` from this directory (quit any installed-app tray instance first - single-instance lock), reloads with Ctrl+R. The installed app at `%LOCALAPPDATA%\Programs\Work Order Tracker\resources\` is a separate frozen copy; edits here do not touch it.

## Rules (from CLAUDE.md - obey exactly)
- Read existing files before writing. Don't re-read unless changed.
- No emojis or em-dashes.
- Do not guess APIs, versions, flags, SHAs, or package names. Verify by reading code/docs.
- Work silently; chat only after the task is complete; minimal wording.
- Before implementing, search for existing working code and prefer wrapping it.
- When you flag a risk in static review, either mitigate it or design a live test for it before proceeding.
- On the second failed attempt at the same problem, stop and re-examine the approach before a third try.
- Commit each discrete change separately with a clear message. Do NOT push. Do NOT publish.

## What already shipped (commit cc11da8 on this branch - DONE, do not redo)
Added two sort keys to the global Sort dropdown plus phases threading:
- `SORT_DEFS` (now `index.html:3281`) gained `{ key: 'status' }` and `{ key: 'lastNote' }`.
- `sortRows` (`index.html:715`) gained a `phaseStatuses` param, a `status` branch (reuses groupByPhase orderMap logic) and a `lastNote` branch.
- `ListPane` (`index.html:1692`) gained a `phases` prop; `sortedGroups` looks up each group's phase config and passes its `statuses` to `sortRows`.
- `phases={phases}` passed at the ListPane call site (`index.html:4733`).

That commit is correct EXCEPT for one misplaced field (Task 1 below).

## VERIFIED root cause of "Last Note sort does nothing" (do not re-investigate - fix it)
There are TWO row builders:
- `toDisplayRow(o)` - `index.html:658-680`. This is the LIST builder; `groupByPhase` (`:687`) calls it, and its rows are what `sortRows` sorts. Its returned object has `status` (`:675`) and `createdTs` (`:678`) but **NO `lastNoteTs`**.
- `toDetailData(o)` - `index.html:806`. The DETAIL-PANE builder. The `lastNoteTs` field (`index.html:856`) was mistakenly added HERE, where the sort never reads it.

Result: list rows have `lastNoteTs === undefined`, so `(a.lastNoteTs||0) - (b.lastNoteTs||0)` is always `0` and nothing reorders. Status appears to "do nothing / be redundant" for a different reason: `status` ascending equals the groupByPhase default order, so it is invisible (see Task 2).

Data verification (already done, for confidence): `%APPDATA%\work-order-tracker\wo-data.json` has 104 live orders, 17 with `noteCards` carrying distinct `ts` values; 28 active orders sit in the "Open Work Orders" phase, 9 of them noted. A simulation of the `lastNote` comparator against that data produces a clear, correct reorder (noted WOs to top, `ts=0` to bottom). So the logic is sound; only the field placement is wrong.

## Task 1 - fix Last Note (move the field to the list builder)
- Add `lastNoteTs` to `toDisplayRow` (`index.html:658-680`), computed the same way: newest `ts` across `o.noteCards`, else 0:
  ```
  lastNoteTs: (Array.isArray(o.noteCards) ? o.noteCards : []).reduce((m, c) => Math.max(m, c.ts || 0), 0),
  ```
- Remove the stray `lastNoteTs` from `toDetailData` (`index.html:856`) - nothing reads it there.
- Commit alone. Live-test: pick "Last Note" sort on the Active tab; the 9 noted WOs in "Open Work Orders" must reorder by recency.

## Task 2 - lock Status sort to descending and rename (user decision)
Decision (confirmed with user): Status sort is only useful in the reverse-of-phase-order direction; ascending duplicates the default. Lock it.
- In `SortDropdown` (`index.html:437-485`): when the Status item is chosen, force `dir: 'desc'` rather than carrying the current dir (the generic handler is at `:473`). Status must not be flippable by the direction control.
- Rename the SORT_DEFS label so it reads as reverse order, e.g. `{ key: 'status', label: 'Status (reverse)' }` at `index.html:3281`. Confirm the exact wording with the user if unsure; intent is "reverse of phase status order".
- In `sortRows` (`:715`) the `status` branch currently multiplies by `dir`. Once locked, ensure it always yields reverse-status order regardless of the (now-hidden) direction state - simplest is to hard-code descending for `status` inside the branch so it cannot be subverted by the toggle in Task 3.
- Commit alone.

## Task 3 - move the asc/desc control out of the dropdown into a toggle beside it
- Today direction lives inside the menu as a "Direction: Ascending/Descending" item (`index.html:479`). Remove it from the menu.
- Add a small toggle button next to `<SortDropdown>` in the ListPane header (`index.html:1840-1845`, inside the `Sort:` span) that flips `sort.dir` between `asc`/`desc` and shows the arrow. It should be disabled/greyed when the active key ignores direction (Status, locked desc; and the cleared "Phase order" state).
- Keep using the existing `setSort` so the choice persists to `settings.viewSorts[currentView]` (see `index.html:3998-4002`).
- Commit alone. Live-test: arrow toggle flips Age/Address/WO/Created/Last Note; is inert for Status and Phase order.

## Observation (not a task unless user asks)
Default sort is `{ key: 'created', dir: 'desc' }` (`index.html:3999`), so a fresh view is "Created desc", not the "Phase order" the dropdown shows when cleared (`key:''`). If the user wants the true default to be Phase order, change that default key to `''`. Out of scope here.

## File map (verified line numbers, current HEAD cc11da8)
- `index.html:658` toDisplayRow (LIST builder - Task 1 target); `:806` toDetailData (stray field at `:856`).
- `index.html:682` groupByPhase, orderMap at `:696`; `:715` sortRows (status branch `:726`, lastNote branch `:733`).
- `index.html:437` SortDropdown (key handler `:473`, direction item `:479`); `:3281` SORT_DEFS.
- `index.html:1692` ListPane signature (`phases` prop); `:1733` sortedGroups; `:1840-1845` Sort header render; `:4733` ListPane call site.
- Sort state: `:3998` viewSorts, `:3999` currentSort default, `:4000` setSort.

## Notes / gotchas
- JSX is compiled at runtime by Babel standalone (CDN, `index.html:28`); no local build step, no static compile. Verify syntax by careful reading; user reloads (Ctrl+R) to test.
- Order store `%APPDATA%\work-order-tracker\wo-data.json` (top key `wo_data` is a JSON string; parse twice). Notes live in `o.noteCards` `[{ id, ts, type, body, pinned, edited }]`; legacy string `o.notes` is migrated into a noteCard by `migrateOrders` (`index.html:3770`) with `ts = dateCreated`.
- Prior work on this branch (do not disturb): preflight load_overrides port, note-card menu, manage-list focus, reorder controls, phase-order row sort, chromedriver popup fix, FIX #5 workbook sync, FIX #6 extension-import verification, and commit cc11da8 (sort keys above).
