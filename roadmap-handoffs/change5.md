# CHANGE #5 - (A) Mass status change via right-click + (B) App-wide UI scaling

This handoff has TWO independent parts, committed separately:
- **PART A** (ROADMAP line 13): mass status change on multi-selected list rows via right-click. Edits `index.html` only.
- **PART B** (carryover bug, RESOLVED): the launch-landing footer clip that survived Change #4. Real root cause was `FullScreenLanding` (a different component than Change #4 targeted); fixed in `index.html` (commit 7f81733), and an interim zoom attempt in `main.js` was reverted (a229503). See the "CHANGE #5B" post-mortem below.
Parts A and B are unrelated; do them in either order and commit each on its own.

You are continuing a roadmap on the Work Order Tracker (Electron + React-via-Babel desktop app). Work in this repo:

```
C:\dev\Work-Order-Tracker
```

Branch: `claude/roadmap-v3.1`. App version 3.0.1. User runs dev build with `npm start` from this directory (quit installed-app tray instance first - single-instance lock). Reload with Ctrl+R. JSX compiled at runtime by Babel standalone (index.html:28); no local build step. Verify syntax by reading; user reloads to test.

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

## ROADMAP item (line 13)
"CHANGE: Allow for multiple selection of list items to accommodate more actions, like mass-changing status with right click."

The multi-selection infrastructure ALREADY EXISTS and works (checkboxes, shift-range select, the BulkBar, and the existing per-view bulk actions). What is MISSING is the specific action the roadmap names: **mass-changing status**, reached **via right-click** on the selection. This handoff adds exactly that and nothing else.

---

## Verified investigation (HEAD 6206100 - read these before coding, confirm still current)

### What already exists (do NOT rebuild - wrap it)
- **Selection state**: `selectedIds` Set + `clearSelection` at `index.html:4188-4194`; auto-cleared on view change at `:4196`; range/shift toggle in `handleCheck` at `:4354-4375`.
- **Row checkboxes**: `ListRow` renders a checkbox at `index.html:2035` wired through `checked`/`onCheck` props; the ListPane passes them per-row at `:1923-1925`.
- **BulkBar** (sticky bar shown when count > 0): component at `index.html:3714`; rendered inside the list scroll region at `:1891`; its buttons come from the per-view `bulkActions` memo at `:4338-4352`.
- **Bulk mutation engine**: `batchUpdate(predicate, mutator)` at `index.html:1002-1019` - maps over all orders, applies `mutator` where `predicate(o)` is true, persists via `window.storage.set('wo_data', ...)`. This is the exact mechanism every existing bulk handler uses.
- **Existing bulk handlers** (the pattern to copy): `bulkSendToTrash` `:4274`, `bulkRestore` `:4284`, `bulkHardDelete` `:4294`, `bulkSendToInvoice` `:4300`, `bulkMarkInvoiced` `:4561`. Each calls `batchUpdate(o => selectedIds.has(o.id), cur => ({...}))`, then `toast(...)`, then `clearSelection()`.
- **Single-WO status change** (the action to mass-ify): `woAction(id, 'setStatus', payload)` at `index.html:4680-4686` writes `status` and appends a `history` entry `'<old> → <new>'`, then toasts.
- **Right-click context menu**: ListPane owns `ctxMenu` state at `index.html:1697` (`{ woId, x, y, tab } | null`), a dismiss effect at `:1733-1746`, the open handler at `:1926-1931`, and the menu render at `:1938-1971`. In the **`active` tab** the menu already renders a "Set status" caption plus one `MenuItem` per status (`(statuses || DEFAULT_STATUSES).map(...)`) at `:1949-1955`, each calling `onWoAction(ctxMenu.woId, 'setStatus', s)`. **This per-status list is exactly what we reuse for bulk** - same statuses, same menu, different target set.
- **statuses source**: App-level `const statuses = data?.statuses || DEFAULT_STATUSES;` at `index.html:4009`; passed to ListPane as `statuses={statuses}` at `:4907`; `DEFAULT_STATUSES` defined at `:148`.
- **ListPane signature** at `index.html:1692` already receives `bulkActions, selectedIds, onCheck, onClearSelection, statuses, onWoAction`.
- **ListPane call site** at `index.html:4884-4909`.

### The gap (root of the task)
1. There is no bulk equivalent of `setStatus`. `bulkActions` (`:4338-4352`) offers Send to Invoice / Send to Trash / Mark Invoiced / Restore / Delete permanently - never "set status".
2. The right-click menu's "Set status" items operate on a single `ctxMenu.woId` only. When the user has several rows checked and right-clicks one of them, the status items still change just the one row.

### Design (mechanism-preserving, minimal)
Right-click is the home for status (the menu already lists every status there). So the change is: **when the right-clicked row is part of an active multi-selection, the "Set status" items apply to the whole selection instead of the single row.** This reuses the existing status-list render verbatim and routes it to a new bulk handler that wraps the existing `batchUpdate` engine. No new menu, no BulkBar redesign (BulkBar buttons are flat and cannot host an N-option submenu; status belongs in the right-click menu per the roadmap wording).

Selection-membership rule (unambiguous):
- If `selectedIds.size > 1 && selectedIds.has(ctxMenu.woId)` -> **bulk mode**: status items call the new bulk handler over `selectedIds`; caption reads `Set status (N selected)`.
- Otherwise -> **single mode**: unchanged, status items call `onWoAction(ctxMenu.woId, 'setStatus', s)`.
(Right-clicking a row that is NOT in the selection acts on that single row only, leaving the checkbox selection intact - standard behavior, and it falls out of the rule above for free.)

---

## Task 1 - add `bulkSetStatus` handler in App (wrap the existing engine)
In App, alongside the other bulk handlers (after `bulkSendToInvoice` ends at `index.html:4311`, before the `VIEW_BUILDERS` block at `:4313`), add a handler modeled EXACTLY on `bulkSendToTrash` (`:4274`) but writing `status` and the same history string `woAction` uses:
```jsx
const bulkSetStatus = React.useCallback((status) => {
  const ts = Date.now();
  const ids = selectedIds;
  batchUpdate(
    o => ids.has(o.id),
    cur => ({ ...cur, status,
              history: [...(cur.history || []), { ts, action: 'status', detail: (cur.status || '') + ' → ' + status }] })
  );
  toast(ids.size + ' set to ' + status);
  clearSelection();
}, [selectedIds, batchUpdate, toast, clearSelection]);
```
Notes:
- History `action: 'status'` + `detail: '<old> → <new>'` matches `woAction`'s single-WO entry (`:4683`) so the detail-pane history reads consistently for both paths.
- `clearSelection()` after, matching every other bulk handler.

## Task 2 - thread the handler to ListPane
- Add `onBulkSetStatus={bulkSetStatus}` to the `<ListPane ... />` props at `index.html:4884-4909` (put it next to `onWoAction={woAction}` at `:4908`).
- Add `onBulkSetStatus` to the ListPane destructured signature at `index.html:1692`.

## Task 3 - bulk-aware "Set status" in the context menu
In the menu render, the active-tab block at `index.html:1949-1955`. Replace the single-target status list with a bulk-aware one. Compute the mode once just before the menu render (e.g. right after the `{ctxMenu && (` opens, or inline):
```jsx
const ctxBulk = ctxMenu && selectedIds && selectedIds.size > 1 && selectedIds.has(ctxMenu.woId);
```
Then in the `active` block:
```jsx
{ctxMenu.tab === 'active' && (<>
  <MenuCaption>{ctxBulk ? ('Set status (' + selectedIds.size + ' selected)') : 'Set status'}</MenuCaption>
  {(statuses || DEFAULT_STATUSES).map(s => (
    <MenuItem key={s} onClick={() => {
      if (ctxBulk) { onBulkSetStatus && onBulkSetStatus(s); }
      else { onWoAction && onWoAction(ctxMenu.woId, 'setStatus', s); }
      closeCtx();
    }}>{s}</MenuItem>
  ))}
  <MenuDivider />
</>)}
```
Leave the rest of the menu (View details, Send to Trash, the sent/invoiced move-back items) unchanged. Do NOT make those bulk in this change - the roadmap names status only; broadening to bulk-trash/move is a separate item (line 14) and would widen blast radius. If you want, add a single-line `// TODO(line 14): bulk variants for Send to Trash / move-back` at the divider so the next implementer finds the spot.

Commit Tasks 1-3 together as one change (one feature: mass status change via right-click).

## Risk + required live test
Risk flagged: (a) `selectedIds` is a Set captured in `bulkSetStatus`'s closure - confirm the dep array includes `selectedIds` (it does above) so it sees the current selection, not a stale one. (b) `batchUpdate` persists immediately; a wrong predicate would rewrite the wrong rows. (c) The active-tab status list is shared by single and bulk paths - a mistake regresses the existing single-WO right-click status change shipped in Change #2. Mitigation is the live test below; run it fully before declaring done.

Live test (user runs `npm start`, Ctrl+R):
1. **Single still works**: with NOTHING checked, right-click one active-tab row, pick a status. Only that row changes; toast `Status: <s>`; its detail-pane history shows `<old> → <new>`.
2. **Bulk happy path**: check 3+ active rows (use shift to range-select). Right-click one of the *checked* rows. Caption reads `Set status (3 selected)`. Pick a status. All 3 change; toast `3 set to <s>`; selection clears; each row's history shows the transition.
3. **Right-click outside selection**: with rows checked, right-click a row that is NOT checked. It must behave as single mode (caption `Set status`, only that one row changes) and must NOT wipe the existing checkbox selection.
4. **Persistence**: after a bulk change, Ctrl+R; confirm the new statuses survived (written to `%APPDATA%\work-order-tracker\wo-data.json`).
5. **No regression in other tabs**: open Sent / Invoiced / Trash, confirm their right-click menus and the BulkBar buttons are unchanged and still work.

If step 2 changes only one row, `ctxBulk` is false when it should be true - re-check the `selectedIds.has(ctxMenu.woId)` membership and that `onBulkSetStatus` is actually threaded (Task 2), before any third attempt.

---

---

# CHANGE #5B - Launch landing clip (RESOLVED - real root cause was a different component)

## What actually happened (post-mortem; commits d5977fa..7f81733)
The landing-footer clip survived BOTH Change #4 and an attempted zoom fix because every prior diagnosis pointed at the wrong component. The deep code search that finally found it:

- There are TWO landing components. `Landing` (`index.html:2534`) is the in-pane welcome shown only when you click the sidebar "Needs attention" item (`currentView==='attention'`), rendered as the 1.2fr grid column. Change #4 and this handoff's earlier drafts targeted THIS one.
- The clip is in the OTHER one: **`FullScreenLanding`** (`index.html:3568`), the "Fullscreen launch landing" shown at app launch. It renders at `index.html:4960` gated by `showLanding` (`:4162`, keyed on `sessionStorage 'tt-seen-launch'`) as a `position:fixed; inset:0; zIndex:250` overlay - OUTSIDE the shell grid entirely.

**Root cause (in FullScreenLanding):** its outer div was `display:flex; flexDirection:column; overflow:hidden` pinned to the viewport, stacking a `marginTop:8vh` logo block, fixed-margin welcome/alerts blocks (up to 6 alert cards), then a `<div style={{flex:1}}/>` spacer, then the Proceed button as the last child. When the stacked content exceeded the window height, the spacer collapsed to 0 but the fixed-height children still overflowed; with `overflow:hidden` and the button after the spacer, the button was pushed past the bottom edge and clipped. Nothing scrolled or shrank.

**Why the two earlier fixes could not work:**
- Change #4 (`gridTemplateRows:'minmax(0,1fr)'` + in-pane `Landing height:'100%'`, commit 6206100) edited the grid and the in-pane Landing. FullScreenLanding is a fixed overlay outside the grid, so the grid change never touched it. (Change #4 is still correct for the in-pane Landing and was KEPT.)
- The zoom attempt (`setZoomFactor`, commit 5b83877, **reverted in a229503**) only shrank when the window was smaller than its 1100x740 baseline. The launch landing appears at the default/launch window size (~1280x820), where the factor clamped to 1.0 -> no scaling ever engaged at the size where the bug shows. Wrong mechanism for this bug.

## The fix that shipped (commit 7f81733)
Local to `FullScreenLanding`, mirroring the mechanism the in-pane `Landing` already uses correctly (scroll-middle + pinned footer):
- Wrapped the logo + welcome + alerts blocks in a single middle region: `flex:1; minHeight:0; width:'100%'; overflowY:'auto'; display:flex; flexDirection:column; alignItems:'center'`.
- Removed the empty `<div style={{flex:1}}/>` spacer (the scroll wrapper now consumes the flex space and pushes the footer down).
- Made the Proceed button block a non-shrinking footer with `flexShrink:0`.
Result: the button is always visible; the content scrolls internally at any window size, independent of zoom.

## Lesson for future handoffs (the rule that was violated)
The change4 handoff's "verified investigation" named `Landing` as the victim WITHOUT confirming which component renders the button the user sees. Two components share the strings "Needs your attention" and "Proceed to work orders". ALWAYS grep for the user-visible string (e.g. "Proceed to work orders") and confirm which component is actually mounted before editing. The launch landing is `FullScreenLanding`; the in-pane one is `Landing`.

## Live test (run on a fresh session - the landing is gated on sessionStorage)
Because `showLanding` is keyed on `sessionStorage 'tt-seen-launch'`, you must trigger a fresh launch (new window / cleared session) to see FullScreenLanding.
1. **Default size**: launch fresh; the Proceed button is fully visible.
2. **Min height**: drag to the 600px minimum; button stays visible, content above scrolls.
3. **Many alerts**: with 6+ attention alerts, confirm the middle (logo/welcome/alerts) scrolls internally while the Proceed button stays pinned at the bottom.
4. **Short content**: with 0-1 alerts, confirm the button still sits at the bottom and the layout still looks centered (no visual regression).
5. **Proceed/Select still work**: clicking Proceed and clicking an alert card both dismiss the landing as before.

---

## File map (verified, HEAD 6206100)
- `index.html:12-14` global CSS (`html,body height:100% overflow:hidden`, `* box-sizing`) - context for Part B.
- `index.html:148` `DEFAULT_STATUSES`.
- `index.html:1002-1019` `batchUpdate` (the bulk engine; do not change).
- `index.html:1692` `ListPane` signature (Task 2: add `onBulkSetStatus`).
- `index.html:1697` `ctxMenu` state; `:1733-1746` dismiss effect; `:1926-1931` open handler.
- `index.html:1938-1971` context-menu render; `:1949-1955` active-tab "Set status" list (Task 3 target).
- `index.html:2035` `ListRow` checkbox (context only).
- `index.html:3714` `BulkBar` (context only; not modified).
- `index.html:4188-4196` selection state + `clearSelection` + clear-on-view-change.
- `index.html:4274-4311` existing bulk handlers (copy `bulkSendToTrash` shape); `:4313` `VIEW_BUILDERS` (insert Task 1 just above).
- `index.html:4338-4352` `bulkActions` memo (context only; not modified).
- `index.html:4354-4375` `handleCheck` (context only).
- `index.html:4561` `bulkMarkInvoiced` (additional reference handler).
- `index.html:4676-4710` `woAction` incl. single `setStatus` (`:4680-4686`) - the action being mass-ified.
- `index.html:4009` App `statuses`; `:4884-4909` ListPane call site (Task 2: add prop at `:4908`).
- `index.html:2534-2598` in-pane `Landing` (Change #4 markup) - NOT the launch landing; do not confuse with FullScreenLanding.
- `index.html:3568` `FullScreenLanding` (the launch overlay; Part B real fix lives here - scroll wrapper + `flexShrink:0` footer); `:4162` `showLanding` state (sessionStorage `tt-seen-launch`); `:4960` render gate.
- `index.html:4861-4870` shell grid (`:4868` `gridTemplateRows:'minmax(0,1fr)'` from Change #4) - kept.
- `main.js:163-186` `createWindow` - the reverted zoom attempt lived here; main.js is back to baseline (no zoom code).

## Notes / gotchas
- JSX compiled at runtime by Babel standalone; verify by reading, user reloads (Ctrl+R).
- The installed app at `%LOCALAPPDATA%\Programs\Work Order Tracker\resources\` is a SEPARATE frozen copy; test only via `npm start`.
- Order store `%APPDATA%\work-order-tracker\wo-data.json` (the renderer persists via `window.storage.set('wo_data', ...)`).
- Prior work on this branch (do not disturb): all FIX items; sort keys + lastNote fix + Status (reverse) lock + direction toggle; Change #2 (scroll preservation, detail-pane status dropdown, right-click context menu + `woAction`, multi-select checkboxes + BulkBar + bulk handlers); Change #3 (context-menu "View details" rename, colorized TypeIcon + `TYPE_COLORS`); Change #4 (landing footer clip fix: shell grid `gridTemplateRows: minmax(0,1fr)` + Landing section `height:100%`).
- Remaining roadmap after this: line 14 (more list context-menu actions / bulk variants), line 15 (custom filters/pages via Tools dropdown), lines 16-18 (row layout: status pills far-left, right-aligned City, scraper address parsing), line 19 (scraper reliability + spreadsheet import).
