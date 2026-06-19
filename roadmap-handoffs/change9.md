# CHANGE #9 - Custom inboxes / route lists (ROADMAP line 15)

Manual-membership "inboxes" in the left panel, like email folders/labels: hand-pick specific WOs into a named list, reorder them (for daily technician routes), and view that curated, ordered set as its own page. Creatable from the Tools dropdown; WOs are added via the list right-click menu.

This is a large, standalone feature. Commit in coherent slices (suggested sequence at the end). Do NOT push. Do NOT publish.

Repo: `C:\dev\Work-Order-Tracker`. Branch: `claude/roadmap-v3.1`. App version 3.0.1. Electron + React via Babel-standalone (no build step; JSX compiled at runtime, index.html:32 `data-presets="env,react"`). User runs dev with `npm start` (quit installed-app tray instance first - single-instance lock), reloads with Ctrl+R. Verify syntax by reading; user reloads to test.

## Rules (from CLAUDE.md - obey exactly)
- Read existing files before writing. Don't re-read unless changed.
- No emojis or em-dashes.
- Do not guess APIs, versions, flags, SHAs, or package names. Verify by reading code/docs.
- Work silently; chat only after the task is complete; minimal wording.
- Before implementing, search for existing working code and prefer wrapping it.
- When porting from a working reference, port the MECHANISM, not just the surface details.
- When you flag a risk in static review, either mitigate it or design a live test for it before proceeding.
- On the second failed attempt at the same problem, stop and re-examine the approach before a third try.
- Commit each discrete change separately. Do NOT push. Do NOT publish.
- (Memory) When something "still" looks wrong after a fix, grep the user-visible string and confirm WHICH component renders it before editing. This repo has duplicate components sharing labels.

## Confirmed scope (user decisions - do not re-litigate)
- **Membership = manual pick.** A WO joins an inbox by right-click "Add to inbox", not by filter criteria. (Filter-based "Saved views" already exist - see below - and are a SEPARATE, untouched system.)
- **Inboxes are orderable.** The user can reorder WOs within an inbox to reflect a driving route. Order persists per inbox.

---

## Verified investigation - the EXISTING systems to wrap/mirror (read before coding)

### A) Filter-based "Saved views" (presets) - DO NOT confuse with inboxes; mirror its plumbing
There is already a full saved-view system. Inboxes are a PARALLEL system modeled on it, NOT an extension of it.
- Data envelope carries `presets` (`index.html:922` defaults, `:947` parse guard). Each preset: `{ id:'pv_*', name, query, filters, sort }`.
- Handlers `addPreset` (`:1054-1062`), `updatePreset` (`:1064-1071`), `deletePreset` (`:1073-1080`) - each mutates `dataRef.current`, calls `setData`, and persists via `window.storage.set('wo_data', JSON.stringify(next))`. PORT THIS EXACT MECHANISM for inbox handlers.
- The hook return tuple exposes them (`:1210`): `[data, updateOrder, batchUpdate, updateSettings, addOrder, deleteOrderHard, addPreset, updatePreset, deletePreset, deleteOrdersHard, upsertOrders, updateData]`. Add the new inbox handlers here and to the destructure at `:4130`.
- Sidebar renders presets under a "Saved views" caption (`:1524-1538`) via `PresetSBRow` (`:1582`). Selecting sets `currentView='sv:'+id`.
- View resolution: `activePresetId`/`activePreset` (`:4460-4461`), `effective{Query,Filters,Sort}` (`:4462-4464`), and `viewData` builds from `VIEW_BUILDERS.active()` with the preset name (`:4469-4470`).
- `onSaveView`/`onRenamePreset`/`onDeletePreset` at `:4714-4732`.

### B) The list-row right-click menu (where "Add to inbox" goes)
`ListPane` `ctxMenu` block (rebuilt in change7 Part D). It already has nested submenus (`ctxSub` state) for status/PM/type/tech and a literal placeholder comment **`{/* TODO(line 15): Add to custom filter submenu */}`** near the "Send to Trash" item. That TODO is THIS feature's hook. The menu is bulk-aware via `ctxBulk` (selected set contains the right-clicked row). Submenu actions dispatch through `onWoAction(woId, kind, payload)` or `onBulkSetStatus`. `ListPane` receives `pms` via `usePMs()`, plus `types`/`techs`/`statuses` props.

### C) The reorder mechanism to PORT (there is NO drag-and-drop in this repo)
`ReorderBtns` (up/down arrow buttons) + `swapAt(arr,i,j)` (`index.html:2906-2923`) is the repo's ONLY ordering mechanism; it is used by every Workflow editor (phases/statuses/PMs/types/techs). Use it for route ordering: each row in an inbox view gets up/down buttons that call `reorderInbox` via `swapAt`. This satisfies "manually order the stops" with the proven, consistent, low-risk pattern.
- RISK/decision: the user said "drag/reorder". True HTML5 drag-and-drop is NET-NEW to this codebase (nothing to port) and materially riskier (drag ghosting, scroll-during-drag, touch). RECOMMENDATION: ship up/down `ReorderBtns` first (it is real manual ordering and matches the app). If the user still wants pointer-drag after seeing it, add it as a separate follow-up. Confirm with the user before building drag; do NOT assume drag.

### D) View building / order arrays
`VIEW_BUILDERS` (`:4452-4458`) builds each view from the pre-split order arrays (`activeOrders`, `sentOrders`, ...) through `groupByPhase`. Inbox views need a DIFFERENT builder: take the inbox's ordered `woIds`, map to order objects, and render in that manual order (NOT grouped by phase, NOT re-sorted). You will need access to the full order list to resolve ids across tabs (a WO on a route might be active/sent/etc.). Confirm the in-scope order pool (likely all non-trashed orders, or all orders); read how `activeOrders` etc. are derived (grep `activeOrders =`).

---

## Data model
Add an `inboxes` array to the data envelope (parallel to `presets`):
```
inboxes: [ { id: 'ib_<base36>', name: 'Route - Tue', woIds: ['WO-247','WO-92', ...] } ]
```
- `woIds` is an ORDERED array; order = route sequence.
- `id` prefix `ib_` (distinct from preset `pv_`).
- Sidebar selection key is `ib:<id>` (distinct from preset `sv:<id>`).
- Defaults: add `inboxes: []` at `:922` and a guard `if (!Array.isArray(parsed.inboxes)) parsed.inboxes = []` at `:947`.

## PART 1 - data layer (handlers + persistence)
Add five handlers in `useWorkOrders`, each PORTING the `addPreset`/`updatePreset`/`deletePreset` mechanism (`dataRef.current` mutate -> `setData` -> `window.storage.set`):
- `addInbox(name)` -> `{ id:'ib_'+Date.now().toString(36), name, woIds:[] }`; returns id.
- `renameInbox(id, name)`.
- `deleteInbox(id)`.
- `addToInbox(id, woId)` -> append `woId` to that inbox's `woIds` if not already present (de-dupe). Accept an array form too, or call per-id for bulk.
- `removeFromInbox(id, woId)`.
- `reorderInbox(id, woIds)` -> replace the ordered array (used by `swapAt` results).
Add all five to the hook return tuple (`:1210`) and the App destructure (`:4130`). Provide a `toast` on add/delete for feedback (mirror `onSaveView`'s "View saved").

Commit Part 1 (data layer) alone - it is inert but self-contained.

## PART 2 - sidebar section + Tools "New inbox"
- In `Sidebar` (`:1451`), add an "Inboxes" caption + rows BELOW the "Saved views" block (or above - your call; keep visually distinct). Render each inbox with an `InboxSBRow` modeled on `PresetSBRow` (`:1582`): label = inbox name, count = `woIds.length`, hover menu with Rename / Delete, `selected={activeView === 'ib:'+inbox.id}`, `onClick={() => onSelectView('ib:'+inbox.id)}`.
- Add a Tools-dropdown entry "New inbox..." (`:1502-1509` block, alongside Preflight/Sync/Export). On click: `window.prompt('Inbox name')` -> `addInbox(name)` -> `onSelectView('ib:'+id)`. (The roadmap explicitly says "Accessible via Tools dropdown".)
- Wire new props through `Sidebar` (it is called at `~:5040`): `inboxes`, `onAddInbox`, `onRenameInbox`, `onDeleteInbox`. Mirror the preset prop wiring (`onRenamePreset`/`onDeletePreset` at `:5046-5047`).
- App-level callbacks `onAddInbox`/`onRenameInbox`/`onDeleteInbox` modeled on `onSaveView`/`onRenamePreset`/`onDeletePreset` (`:4714-4732`), including: on delete, if `currentView === 'ib:'+id` then `setCurrentView('active')`.

Commit Part 2.

## PART 3 - inbox view rendering (curated, ordered, manual)
- View resolution (near `:4460-4475`): detect `currentView` starting with `'ib:'`, resolve `activeInbox = inboxes.find(...)`. Build `viewData` from the inbox:
  - Map `inbox.woIds` -> order objects (resolve against the full order pool; SKIP ids that no longer resolve - deleted/hard-deleted WOs). Preserve `woIds` order.
  - Render as a SINGLE flat group (no `groupByPhase`), so the manual order is visible: `{ title: inbox.name, total: rows.length, groups: [{ phase: inbox.name, count: rows.length, rows: rows.map(toDisplayRow), dot: 'var(--text-2)' }], inbox: true }`.
  - Do NOT apply the default status/city/age sort and do NOT apply `sortRows` for inbox views - order is manual. Disable/ignore the Sort dropdown when an inbox is active (mirror how preset views lock sort/filters at `:5058-5063` by passing no-op setters / a flag).
- Stale-id mitigation (RISK): a WO in `woIds` may be trashed or deleted. Filter out ids that do not resolve to a live order before rendering. Optionally show "(n archived)" if some are filtered. Do not crash on missing ids. LIVE TEST 5.

Commit Part 3.

## PART 4 - add/remove/reorder from the list
- **Add to inbox (fills the change7 TODO).** In the `ctxMenu` top-level (active tab and ideally all tabs), add `Add to inbox >` opening a submenu (`ctxSub='inbox'`) listing every inbox + a "New inbox..." item. On select: `onWoAction(woId,'addToInbox', inboxId)` (single) or, when `ctxBulk`, add ALL selected ids. "New inbox..." prompts for a name, creates it, then adds. Wire a new `woAction` kind `addToInbox` (App `woAction` ~`:4730`) that calls `addToInbox(inboxId, id)` + toast; for bulk, iterate `selectedIds`.
  - Pass `inboxes` + `onAddInbox`/`onAddToInbox` into `ListPane` (extend its signature + call site `~:5050`).
- **Remove + reorder (only when viewing an inbox).** When `viewData.inbox` is true, each row shows: a "Remove from inbox" affordance and `ReorderBtns` (up/down) that call `reorderInbox(activeInbox.id, swapAt(woIds, idx, idx+/-1))`. PORT `ReorderBtns`+`swapAt` (`:2906-2923`). Up disabled at idx 0, down disabled at last. These controls should appear only in inbox views (gate on `viewData.inbox`), not in normal views.
  - `ListRow` (`:2019`) will need an optional `inboxControls` prop (or render the buttons in `ListPane`'s row wrapper) - keep `ListRow` otherwise unchanged. Confirm where rows are mapped in `ListPane` and inject controls there.

Commit Part 4.

## Risks (mitigate or live-test)
1. **Stale woIds** (WO trashed/deleted while in an inbox). Mitigation: filter unresolved ids at render (PART 3). LIVE TEST 5.
2. **Sort/filter collision in inbox views.** Inbox order is manual; the Sort dropdown and filter bar must not reorder/hide route stops. Mitigation: lock them off when `viewData.inbox` (mirror the preset lock at `:5058-5063`). LIVE TEST 4.
3. **Reorder persistence + scroll jump.** After up/down, the list re-renders; preserve scroll (the list already saves `savedScrollTop`). Verify the moved row stays visible and order persists across reload. LIVE TEST 3.
4. **Bulk add semantics.** "Add to inbox" with multiple selected must add all selected (de-duped), not just the right-clicked row. Mirror `ctxBulk` handling already in the menu. LIVE TEST 2.
5. **Drag expectation gap.** User asked for drag; we ship up/down buttons (no drag mechanism exists to port). Confirm acceptable before adding true drag. (Flagged, not silently dropped.)

## Live test (user runs `npm start`, Ctrl+R)
1. Tools -> "New inbox...", name it - it appears in the sidebar "Inboxes" section, selected, empty-state shown.
2. Right-click a WO -> "Add to inbox" -> pick the inbox; the count increments. Select 3 rows, right-click -> Add to inbox -> all 3 added (no dupes).
3. Open the inbox: rows show in add order; use up/down to reorder; reload - order persists.
4. In the inbox view, the Sort dropdown / filters do not reorder or hide stops.
5. Trash or delete a WO that is in an inbox - the inbox view simply omits it, no crash.
6. Rename and Delete the inbox from its sidebar hover menu; deleting while viewing it returns to Active.

---

## File map (verify line numbers before editing - they shift as you edit)
- `index.html:922` envelope defaults; `:947` parse guard (add `inboxes`).
- `index.html:1054-1080` preset handlers (PORT for inbox handlers); `:1210` hook return tuple; `:4130` App destructure.
- `index.html:1451-1550` `Sidebar` (Tools dropdown `:1502-1509`, views `:1512-1522`, Saved-views `:1524-1538`); `:1552` `SBRow`; `:1582` `PresetSBRow` (model for `InboxSBRow`).
- `index.html:1690` `ListPane` signature + call site `~:5050`; `ctxMenu` block with the `TODO(line 15)` comment; filter/sort lock for preset views `:5058-5063`.
- `index.html:2019` `ListRow` (inject inbox controls around it, not inside).
- `index.html:2906-2923` `ReorderBtns` + `swapAt` (PORT for route ordering).
- `index.html:4452-4475` `VIEW_BUILDERS` + view resolution (add `ib:` branch); `:4714-4732` preset callbacks (model for inbox callbacks); `woAction` ~`:4730` (add `addToInbox` kind).
- Out of scope: `AlertCard`, `FSAlertCard`, `FullScreenLanding`, in-pane `Landing`. Do not touch. Filter-based `presets` system is SEPARATE - do not modify it.

## Suggested commit sequence
1. Part 1 - inbox data layer (envelope + 5 handlers + tuple/destructure).
2. Part 2 - sidebar Inboxes section + Tools "New inbox" + create/rename/delete.
3. Part 3 - inbox view builder (curated ordered render, sort/filter locked off).
4. Part 4 - context-menu "Add to inbox" (bulk-aware) + in-view remove + up/down reorder.

## Notes / gotchas
- JSX compiled at runtime by Babel standalone; verify by reading, user reloads (Ctrl+R).
- Installed app at `%LOCALAPPDATA%\Programs\Work Order Tracker\resources\` is a SEPARATE frozen copy; test only via `npm start`.
- Order store: `%APPDATA%\work-order-tracker\wo-data.json`; the new `inboxes` array persists in this same envelope via `window.storage.set('wo_data', ...)`.
- Inboxes store WO ids, not copies; they are views over the live orders. Deleting a WO does not delete it from disk-stored woIds, but the view filters it out (Risk 1).
- Prior branch work (do not disturb): all FIX items; sort keys; Change #2-#6; Change #7 (WO# right-align, City sort later reworked, noteCard id fix, context-menu overhaul); Change #8 (More Information/Misc card); the city-grouping default sort (status > city > days-open > created).
- After this: ROADMAP lines 18-19 (scraper full-address parsing + reliability/import) remain.
