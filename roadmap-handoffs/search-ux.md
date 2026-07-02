# SEARCH UX - woId search bug + type-to-search + clear keybind

Blueprint. Three parts, ship in slices. Do NOT push. Do NOT publish.
Repo `C:\dev\Work-Order-Tracker`, branch main. Done-gate: `npm run verify`.

## Part 1 (BUG, ship first): search misses the real WO number (woId)
### Root cause (CONFIRMED against real data)
MSR (and captured) WOs store a minted `id` like `WO-002` and the REAL portal
work-order number in `o.woId` (e.g. `02615338`). Sent WO-002 -> woId 02615338.
Every WO search matcher tests `o.id` but NOT `o.woId`, so pasting/typing the real
number returns nothing. This is the "Invoices search returns nothing" report, and
it is a CLASS bug (every module), not one site.

### All sites (fix each to also match woId, case-insensitive, String()-guarded)
- [invoices.jsx:606-611](../src/invoices.jsx:606) InvoicesModule `matches(o)` - add `o.woId`.
- [app.jsx:341-349](../src/app.jsx:349) `toDisplayRow` - add `woId: o.woId || ''` to the row
  (the WO list matcher reads the display row, not the order).
- [listpane.jsx:116-121](../src/listpane.jsx:118) - add `(r.woId || '').toLowerCase().includes(q)`.
- [maps.jsx:240-242](../src/maps.jsx:240) list filter - add `o.woId`.
- [itinerary.jsx:243-245](../src/itinerary.jsx:243) unscheduled-pool filter - add `o.woId`.
- [app.jsx:952-954](../src/app.jsx:952) QuickJump palette - add `o.woId`.
- Service Library search ([invoices.jsx:146](../src/invoices.jsx:146)) searches catalog items,
  not WOs - NO woId change.

### Verify
Logic test (new `test/search-match.test.js`): a sent order `{id:'WO-002',
woId:'02615338', ...}` matches query `02615338` and `2615338`; a bare-numeric-id
AMH order still matches by id. Extract the matcher(s) if practical, or assert the
shared predicate. Then live: paste 02615338 in Invoices -> WO-002 appears.

## Part 2: type-to-search (all modules)
When a module is active and NO modal/edit field is focused, a printable keystroke
routes into that module's search bar (focus + insert the char). No click needed.

### Mechanism (PORT the existing `/`-focus handler, generalize it)
[WorkOrdersHeader](../src/app.jsx:2003) already mounts a window keydown that focuses
its search on `/`. Generalize into a shared hook used by every module search:

`useTypeToSearch({ setValue, inputRef, clearKey, disabled })` (put in a small shared
module, e.g. src/search-hook.js, React import only):
- window `keydown` listener, cleanup on unmount (A6/A7: stable handler, deps stable;
  read latest clearKey via a ref, use FUNCTIONAL setValue so no per-key rebind).
- Skip when: `disabled`; a modal is open (see guard); or
  `document.activeElement` is INPUT / TEXTAREA / SELECT / isContentEditable
  (user already typing somewhere).
- Skip modifier combos: `e.ctrlKey || e.metaKey || e.altKey` -> return
  (leave Ctrl+K etc. alone).
- Clear key: `e.key === clearKey` -> `e.preventDefault(); setValue('')`.
- Printable: `e.key.length === 1` -> `e.preventDefault();
  inputRef.current?.focus(); setValue(v => (v || '') + e.key)`.
Because focus moves into the input after the first char, subsequent keys (incl.
Backspace) edit natively - the global handler only acts when NOT already in a field.

### Wire per module (each owns its search state + ref)
- WO: replace the inline `/` effect; pass `disabled` when preset/inbox
  (setQuery is no-op'd there - [app.jsx:5928](../src/app.jsx:5928)).
- Invoices, Service Library, Maps, Itinerary pool: add the hook with their setter+ref.
- QuickJump is itself a modal - do NOT attach (it would self-trigger).

### Modal-open guard (needed; no signal exists today)
Add a ref-count `window.__modalOpen` (or a React context) incremented on mount /
decremented on unmount by the generic [Modal](../src/app.jsx:658) AND by the
full-screen overlays that are not Modal-based: InvoiceEditor, QuickJump,
ImportInspectModal, the module launcher overlay, the schedule form, edit-details,
FullScreenLanding. Guard = `window.__modalOpen > 0`. Enumerate + grep `position:
'fixed', inset: 0` and `zIndex >= 500` to catch them all. The activeElement check
covers overlays that focus an input; __modalOpen covers those that do not.

## Part 3: configurable clear-search keybind (default Backspace)
- New setting `clearSearchKey` (default `'Backspace'`). Reuse the settings store:
  add `setClearSearchKey = updateSettings({ clearSearchKey })` beside setTheme
  ([app.jsx:3737](../src/app.jsx:3737)); read `settings.clearSearchKey` and thread
  `clearKey` into every `useTypeToSearch`. Grep first for any existing keybind
  setting to avoid a parallel field (none found at blueprint time).
- Settings UI: a "keybind capture" row in the Settings module - an input whose
  `onKeyDown` records `e.key` (show a friendly label, e.g. `Backspace`), plus a
  "reset to default" button. Match existing settings-row styling.
- Same guard rules as Part 2 (only fires when no modal/edit field focused).

## Part 4: cross-tab/module search awareness (Work Orders + Invoices only)
A search may match WOs that live in a DIFFERENT tab/module than the one on screen
(e.g. searching in Invoices for an Active WO). Surface those as a secondary list
under the current results, each badged with where it lives, click to navigate.

### User decisions (settled)
- ALWAYS show an "In other tabs" secondary list when off-view matches exist (not
  just when the current view is empty).
- Scope: Work Orders + Invoices modules only. Maps/Itinerary unchanged.

### Location model (a WO lives in a TAB; modules are views of tabs)
- `active` / `complete` / `trash` -> Work Orders module (that view).
- `sent` -> Invoices module (Billing queue).
- Badge label map (confirm vocab): active->ACTIVE, complete->COMPLETE,
  sent->SENT, trash->TRASH. (`sent` shows as "Sent to invoice" in-app; using SENT.)

### Pure logic (orders-logic.js, tested)
- `locationOfOrder(o)` -> 'active'|'complete'|'sent'|'trash' (deleted||tab==='trash' -> trash).
- `orderMatchesQuery(o, q)` -> superset predicate (orderNumberMatches OR
  address/city/pm/tech substring). Empty q -> false (off-view list only with a query).
- `findOtherViewMatches(orders, q, shownLocations)` -> [{id,woId,address,city,pm,tab}]
  for orders whose location is NOT in `shownLocations` and that match q.
  WO module passes `[currentView]` (base views only); Invoices passes `['sent']`.

### UI + nav
- Shared `OtherTabMatches({ matches, onNavigate })` (export from app.jsx; both
  listpane.jsx and invoices.jsx import from app.jsx already). Compact rows:
  `<id> · <pm> · <address>  [BADGE]`, click -> onNavigate(id).
- `navigateToWO(id)` in App (reuse the existing switch mechanism, e.g.
  [app.jsx:4507](../src/app.jsx:4507)): read locationOfOrder; sent ->
  `setCurrentModule('invoices'); setSelectedWO(id)`; else
  `setCurrentModule('work-orders'); setCurrentView(loc); highlightWO(id)`
  (highlight = select+scroll, no forced modal).
- Wire: WO module computes matches (skip when isPresetView/isInboxView) and renders
  OtherTabMatches at the bottom of ListPane's scroll area; InvoicesModule gets
  `allOrders` + `onNavigateWO` and computes with its own query state.

### Verify
Logic test: findOtherViewMatches excludes shown tab, includes others; sent WO shows
for a WO-module active view; an active WO shows in Invoices. Live: in Invoices search
9767507 -> appears under "In other tabs" badged ACTIVE -> click -> lands in Work
Orders/Active with 9767507 selected.

## Slices (separate commits; verify each)
S1. Part 1 woId class fix + test. (small, fixes the report) - DONE
S2. Part 2 useTypeToSearch hook + modal guard + wire all modules.
S3. Part 3 clearSearchKey setting + Settings UI + thread clearKey.
S4. Part 4 cross-tab matches: pure logic + test, OtherTabMatches, navigateToWO,
    wire Work Orders + Invoices.

## Open questions
- clearKey capture UI: single key only, or allow chords? (default single key.)
- Should type-to-search also apply inside the QuickJump/command palette? (No - it
  is a modal and auto-focuses its own input.)

## Footer
Surgical per site. woId matcher change is the class fix (memory: fix the class not
the example - list all sites, done above). No emojis/em-dashes. `npm run verify`
green per slice. Commit separately; do NOT push/publish.
