# CHANGE #1 - Per-phase sorting of WOs

You are continuing a roadmap of changes on the Work Order Tracker (Electron + React-via-Babel desktop app, Python sync backend). Work in this repo:

```
C:\dev\Work-Order-Tracker
```

Branch: `claude/roadmap-v3.1`. App version 3.0.1. The user runs the dev build with `npm start` from this directory (must quit any installed-app tray instance first - single-instance lock). NOTE: the old `WO_Tracker-Source` worktree referenced in earlier handoffs (fix5/fix6) was deleted; this repo at `C:\dev\Work-Order-Tracker` is now the only checkout.

## Rules (from CLAUDE.md - obey exactly)
- Read existing files before writing. Don't re-read unless changed.
- No emojis or em-dashes.
- Do not guess APIs, versions, flags, SHAs, or package names. Verify by reading code/docs.
- Work silently; chat only after the task is complete; minimal wording.
- Before implementing, search for existing working code and prefer wrapping it.
- When you flag a risk in static review, either mitigate it or design a live test for it before proceeding.
- On the second failed attempt at the same problem, stop and re-examine the approach before a third try.
- Commit each discrete change separately with a clear message. Do NOT push. Do NOT publish.

## Roadmap line (ROADMAP.md line 9)
"CHANGE: Allow per Phase sorting of WOs by status/age/etc. ascending/descending Sort dropdown per Phase Header. Alternatively, add this sorting to the main Sort feature instead. Whichever is cleaner."

Closely related (ROADMAP.md line 10, a natural follow-on that touches the SAME code): "CHANGE: Allow sorting (ascending/descending) of WOs by last note date." Consider whether to bundle line 10 once line 9's approach is settled - it is one more SORT_DEFS entry plus one accessor.

## Current sort architecture (verified - read these before changing anything)

The sort is currently GLOBAL (one `{ key, dir }` applied identically to every phase), not per-phase.

1. `SORT_DEFS` - `index.html:3265-3270`. Four keys only: `created`, `age`, `addr`, `wo`. There is NO `status` key and NO `lastNote` key yet.
2. `SortDropdown({ sort, onChange })` - `index.html:437-485`. Single dropdown rendered in the list header. Lets the user pick a SORT_DEFS key, toggle Direction asc/desc (line 478-480), or clear back to "Phase order (default)" (empty key, line 468-469). Direction toggle and clear already work.
3. `groupByPhase(orders, phases)` - `index.html:682-713`. Buckets orders into phases, and WITHIN each phase sorts rows by the status's position in that phase's status list (`p.statuses`), tie-broken by newest `createdTs`. This is the "Phase order" default (line 696-702).
4. `sortRows(rows, sort)` - `index.html:715-728`. Applies the active global sort to a row array. Handles `age`, `addr`, `wo`, else falls back to `created`.
5. Wiring in `ListPane` - `index.html:1733-1735`. When `sort.key` is set, `sortRows` is mapped over EACH group's rows, overriding the per-phase status-position default. When `sort.key` is empty, the groupByPhase default stands. So a single global sort already re-sorts within every phase identically.
6. View definitions call `groupByPhase` per tab - `index.html:4171-4175` (active/sent/invoiced/paid/trash).
7. `sort`/`setSort` state is owned above ListPane and threaded as props (see `ListPane` signature `index.html:1680`). Trace where `sort` is initialized and persisted (grep `setSort` and `sort:` in the App component) before adding per-phase state, so per-phase choices persist the same way the global one does.

## OPEN DECISION - ask the user before coding (use AskUserQuestion)

The roadmap explicitly offers two designs; pick with the user:

- **Option A - per-phase Sort dropdown in each phase header.** Each phase remembers its own `{ key, dir }`; a phase with no explicit choice falls back to the global sort, then to "Phase order". More powerful, more state to persist, more header UI. Requires a per-phase sort map (e.g. `settings.phaseSort[phaseName]`) and changing `groupByPhase`/ListPane so each group applies its own sort.
- **Option B - enhance the single main Sort only.** Keep one global dropdown but make it fully cover "status/age/etc. asc/desc". Direction already works; this mainly means adding a `status` sort key (sort by status position within phase) so the menu matches the roadmap wording. Much smaller, cleaner, lower risk.

Recommend Option B as the cleaner default (the roadmap sanctions it: "whichever is cleaner"), and only do Option A if the user specifically wants independent per-phase control. Confirm before coding.

## Key file map
- `index.html:3265` SORT_DEFS; `:437` SortDropdown; `:682` groupByPhase; `:715` sortRows; `:1680` ListPane signature; `:1733` sort wiring; `:4171` view defs.
- For line 10 (last-note sort): find where notes live on an order (grep `notes` / note timestamps in index.html) and add an accessor returning the newest note ts; add a `lastNote` SORT_DEFS entry and a `sortRows` branch.

## Required approach
1. Read the cited ranges fully before editing.
2. Use AskUserQuestion to settle Option A vs B (and whether to bundle line 10).
3. Implement. If adding a `status` sort key, reuse the phase status-position logic already in `groupByPhase:696-702` rather than reinventing ordering.
4. Live-test: user runs `npm start`, Ctrl+R, then exercises the Sort control across the Active tab (multiple phases, multiple statuses) and confirms asc/desc + clear-to-default all behave. Give explicit step-by-step test instructions.
5. Commit each discrete change separately. Report SHAs and test steps.

## Notes / gotchas
- JSX is compiled at runtime by Babel standalone (CDN, index.html:28); no local build step, no static compile. Verify syntax by careful reading; the user reloads (Ctrl+R) to test.
- The installed app at `%LOCALAPPDATA%\Programs\Work Order Tracker\resources\` is a SEPARATE frozen copy; your edits do not affect it. Test only via `npm start`.
- Order data store: `%APPDATA%\work-order-tracker\wo-data.json` (top key `wo_data` is a JSON string; parse twice). Settings persist via `storage-set` IPC -> `wo_data.settings`.
- Prior work on this branch (do not disturb): preflight load_overrides port, note-card menu, manage-list focus, reorder controls, phase-order row sort + "Phase order" default, chromedriver popup fix, FIX #5 workbook sync (reads sent+invoiced, real error toasts, path UX), FIX #6 extension-import verification (no code change - already confirmed no confirmation gate exists).
