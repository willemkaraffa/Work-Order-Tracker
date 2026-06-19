# CHANGE #7 - ROADMAP line 14 (context-menu overhaul) + 3 formatting/bug follow-ups

This doc batches FOUR items. They live in different parts of `index.html` but are grouped here because the user requested them together. Commit EACH part SEPARATELY (repo rule: "commit each discrete change separately"). Do NOT push. Do NOT publish.

- **PART A** (formatting follow-up to Change #6): right-align the WO number in the meta row so it sits under the right-aligned city.
- **PART B** (ROADMAP line 9-ish sort feature, user directive): deprecate the "Address" sort option; replace with a hardcoded **City** sort whose priority is **status > city > days-open** (routing-oriented).
- **PART C** (FIX, rolled in by user): the note-card Edit action occasionally will not let you edit. Diagnose, then fix.
- **PART D** (ROADMAP line 14): overhaul the list-panel right-click context menu so every toggleable per-WO field (status, PM, type, tech, emergency, warranty) is editable from it, with **Status as a side/nested submenu** (not a flat list).

Repo: `C:\dev\Work-Order-Tracker`. Branch: `claude/roadmap-v3.1`. App version 3.0.1. Electron + React via Babel-standalone (no build step; JSX compiled at runtime, index.html:28). User runs dev with `npm start` (quit installed-app tray instance first - single-instance lock), reloads with Ctrl+R. Verify syntax by reading; user reloads to test.

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

---

## Verified investigation (read before coding; confirm still current - Change #6 already landed: commits f00861f Part A, 3d3079d Part B)

### Single list-row renderer: `ListRow` (`index.html:2019`)
After Change #6, the meta row (`:2069-2082`) currently reads, in order:
```jsx
<div style={{ fontSize: d.line2, color: 'var(--text-2)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
  {!useSyncPill && <>
    <StatusPill status={row.status} size="sm" />
    <Dot />
  </>}
  <PMChip pm={row.pm} />
  <TypeIcon kind={row.type} />
  <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-2)', fontSize: 13 }}>{row.wo}</span>
  {row.tech && <>
    <Dot />
    <span>{row.tech}</span>
  </>}
  {showSyncPill && <SyncPill status={row.syncStatus} />}
</div>
```
The headline row above it (`:2052-2067`) now ends with a right-aligned group (`marginLeft:'auto'`) holding city then age (day counter). So in the headline row the city sits immediately left of the day counter, both pinned right.

### Sort definitions
- `SORT_DEFS` (`index.html:3422-3429`): `created`, `age`, `addr` (label "Address"), `wo`, `status` (label "Status (reverse)"), `lastNote`.
- `sortRows(rows, sort, phaseStatuses)` (`index.html:719-740`): switch on `sort.key`. `addr` branch is `:724` -> `String(a.addr).localeCompare(String(b.addr)) * dir`. `status` branch (`:730-736`) uses a phase-status `orderMap`. `age` branch (`:723`) uses `ageDays`.
- `SortMenu` UI (`index.html:~445-488`): renders "Phase order (default)" then maps `SORT_DEFS` to MenuItems (`:479-483`). Status forces `dir:'desc'` on select (`:480`).
- `row.city` exists on every row (derived via `splitAddress(o)`, `:647-658`); legacy rows have city parsed out of `o.address`.

### Note card edit path
- `DetailPane` renders notes (`index.html:2340-2347`): `key={n.id ?? i}`, spreads `{...n}`, passes `onEdit` ONLY when `onEditNote && !n.legacy` (`:2343`).
- `data.notes` is rebuilt every render (`index.html:842-859`): maps `o.noteCards` to `{ id: n.id, type, time, body, pinned, edited }`, sorted **pinned-first then newest-ts-first** (`:845`). A trailing `legacy` card (`id:'_legacy'`) is appended when `o.notes` (old single-string notes) is non-empty.
- `NoteCard` (`index.html:2438-2545`): local `editing`/`draft` state. `showMenu = !legacy && (onEdit||onDelete||onPin)` (`:2461`). Edit item sets `editing` true (`:2532`). `saveEdit` (`:2455`) calls `onEdit(trimmed)` only if `trimmed && trimmed !== body`.
- `editNote` handler (`index.html:4669-4677`): `noteCards.map(c => c.id === noteId ? {...c, body:newBody, edited:true} : c)` - matches by **id equality**.
- New cards always get an id: `addNote` (`:4659`) mints `id: 'n_' + Date.now().toString(36)`.
- A migration pass exists at `index.html:3913-3951` that ensures `o.noteCards` (folds legacy `o.notes` string into a card). CONFIRM whether it assigns an `id` to every card it creates - this is central to PART C (read it before coding).

### Context menus (two, do not confuse)
- **List-panel** right-click menu: `ListPane`'s `ctxMenu` block (`index.html:1938-1981`). Currently: a flat "Set status" caption + one MenuItem per status (`:1953-1960`), then tab-specific move items, "View details", "Send to Trash". Already has bulk awareness via `ctxBulk` (`:1950`). Has TODO markers for line 14 / line 15 (`:1974-1975`). Dispatches via `onWoAction(woId, kind, payload)` and `onBulkSetStatus(status)`.
- **Detail-pane** `⋯` menu: `DetailMenu` component (`index.html:~2115-2202`). THIS IS THE WORKING REFERENCE for PART D. It already implements a nested status submenu via a `statusOpen` state: "Change status..." sets `statusOpen=true` (`:2166`); when open it shows the status list + a "<- Back" item (`:2191-2197`). It also has Duplicate, `toggleEmergency`/`toggleWarranty` (`:2169-2170`), softDelete. Dispatches via `onAction(kind, payload)` -> `detailAction`.
- Action handlers (App level):
  - `woAction(id, kind, payload)` (`index.html:4708-4742`): handles `setStatus`, `backToActive`, `backToSent`, `softDelete` ONLY. Passed to ListPane as `onWoAction` (`:4940`).
  - `detailAction(kind, payload)` (`index.html:4745-4810`): delegates the four shared kinds to `woAction`, and additionally handles `markPaid`, `backToInvoiced`, `restore`, `hardDelete`, `duplicate`, `toggleEmergency` (`:4794`), `toggleWarranty` (`:4801`). These last two mutate `cur.emergency`/`cur.warranty` with a history entry.
- Edit-form field set = the canonical "toggleable items per WO" (`index.html:1293-1308`): `pm` (select over `pms`), `type` (select over `types`), `tech` (datalist over `techs`), `status` (select over `statuses`), `emergency` (checkbox), `warranty` (checkbox). PM/type/tech option lists come from `data.pms|types|techs` (defaults `DEFAULT_PMS`/`DEFAULT_TYPES`/`DEFAULT_TECHS`).

---

## PART A - right-align WO# under the city
**Target:** meta row `index.html:2077` (the WO# span).
**Change:** give the WO# span `marginLeft:'auto'` so it is pushed to the right edge of the meta row, landing under the right-aligned city/age group of the headline row. Move `tech` to BEFORE the WO# so the WO# is the rightmost text element; keep `SyncPill` last. New meta-row body:
```jsx
  {!useSyncPill && <>
    <StatusPill status={row.status} size="sm" />
    <Dot />
  </>}
  <PMChip pm={row.pm} />
  <TypeIcon kind={row.type} />
  {row.tech && <span>{row.tech}</span>}
  {showSyncPill && <SyncPill status={row.syncStatus} />}
  <span style={{ marginLeft: 'auto', flexShrink: 0, fontVariantNumeric: 'tabular-nums', color: 'var(--text-2)', fontSize: 13 }}>{row.wo}</span>
```
Notes / interpretation (under scrutiny):
- "Under the city" is implemented as right-anchored (`marginLeft:'auto'`), mirroring how Change #6 right-anchored the city. Both the city (headline) and the WO# (meta) are now pinned to the row's right edge, so they share the same right margin and read as a column. Their LEFT edges still vary with text length; this is NOT a fixed pixel column. If the user wants the WO# digits to start at exactly the same x as the city, that needs a reserved-width column (different layout) - confirm before doing that; do not assume it.
- The meta row has `flexWrap:'wrap'`. With `marginLeft:'auto'` on the last item, at narrow widths the WO# can wrap to its own line and still right-align. Confirm in the live test that this reads cleanly.
- Removed the standalone `<Dot />` that used to separate tech; tech now stands alone before the auto-margin gap (the gap itself is the separator). Verify no dangling dot.

Live test (A): Active view - each row's meta line leads with status pill, then PM/type/tech, and the WO# sits hard right, vertically under the city tag. Toggle density (compact/comfortable) - alignment holds at both sizes. Sent/Invoiced - SyncPill present, WO# still right-aligned, nothing throws.

Commit Part A alone.

## PART B - deprecate Address sort; add hardcoded City sort (status > city > days-open)
**User directive verbatim:** "Deprecate the address sort option for a hardcoded sort by city under status in priority and above days open, as this is far more useful for routing technicians."

Interpretation (confirm if uncertain): replace the `addr`/"Address" sort entry with a `city` sort, and implement it as a COMPOUND comparator with priority **status (primary) > city (secondary) > days-open/age (tertiary)** so a technician sees work grouped by status, then clustered by city for routing, then oldest-first within a city. This is a compound key, unlike the existing single-field keys.

**Targets + changes:**
1. `SORT_DEFS` (`index.html:3425`): replace `{ key: 'addr', label: 'Address' }` with `{ key: 'city', label: 'City (route)' }`. (Keeping it positioned between `age` and `wo` in the menu is fine; the menu order is cosmetic. The user's "under status / above days open" refers to the comparator PRIORITY, handled in step 2, not the menu position.)
2. `sortRows` (`index.html:719-740`): remove the `addr` branch (`:724`) and add a `city` branch implementing the compound order. Reuse the existing status `orderMap` logic (copy from the `status` branch `:730-736`) for the primary key:
```jsx
    if (k === 'city') {
      const orderMap = new Map((phaseStatuses || []).map((s, i) => [s, i]));
      const ai = orderMap.has(a.status) ? orderMap.get(a.status) : Infinity;
      const bi = orderMap.has(b.status) ? orderMap.get(b.status) : Infinity;
      if (ai !== bi) return ai - bi;                       // status priority (primary)
      const c = String(a.city || '').localeCompare(String(b.city || ''));
      if (c !== 0) return c * dir;                         // city (secondary, honors dir)
      return ((b.ageDays ?? -1) - (a.ageDays ?? -1));      // days-open: oldest first (tertiary)
    }
```
Decisions baked in (call out to user if any is wrong):
- Status primary order uses the phase status `orderMap` (same as the existing `status` sort), NOT reversed. The `dir` toggle applies to the CITY level (asc = A->Z), which is what a routing user toggles. Days-open tertiary is fixed oldest-first.
- Rows with empty city sort together (empty string) - acceptable; legacy rows mostly have city via `splitAddress`.
3. Verify nothing else references `sort.key === 'addr'` (grep `'addr'`). The header direction toggle gate at `index.html:~1727` (`dirDisabled = ... || sort.key === 'status'`) does not need `city` added - city honors direction. Confirm.
4. Check saved presets / `effectiveSort` (`index.html:~4357`) - an existing saved view persisted with `sort.key:'addr'` will now hit the default branch (created) since the `addr` case is gone. That is a graceful degrade, not a crash. If you want to be safe, map a stored `'addr'` to `'city'` where presets load - OPTIONAL, mention to user; do not over-engineer.

Risk: removing `addr` could orphan a persisted sort. Mitigated by the graceful-default above; confirm in live test by selecting each remaining sort option and the new City option without error.

Live test (B): Sort menu shows "City (route)" where "Address" was; selecting it groups rows by status then orders by city; toggling direction flips city A-Z/Z-A; no console error; previously-saved views still load.

Commit Part B alone.

## PART C - fix the note-card Edit that "occasionally" will not edit
**Leading hypothesis (verify before fixing - do not fix blind):** some persisted `noteCards` lack a stable `id` (created/imported before id-minting, or the migration at `:3913-3951` does not assign ids to all cards). Two failure modes follow from a missing `id`:
1. In `DetailPane` the React `key={n.id ?? i}` (`:2342`) falls back to the array INDEX. Because the notes list is re-sorted pinned-first/newest-first every render (`:845`), index-based keys are unstable: adding/pinning a note shifts indices, React reuses the wrong `NoteCard` instance, and its local `editing`/`draft` state attaches to a different card - the Edit click "does nothing" or the textarea shows the wrong note.
2. `editNote` matches by `c.id === noteId` (`:4674`). If `noteId` is `undefined`, it matches the FIRST id-less card (or none), so the save lands on the wrong card or silently no-ops.

**Required diagnostic step first:** read the `noteCards` migration (`:3913-3951`) and confirm whether every card gets an `id`. Grep how imported orders set `noteCards` (`upsertOrders`/import path, `:1100-1180`). Confirm WHICH real data has id-less cards before editing - per repo memory rule.

**Fix (apply the minimal set the diagnosis supports):**
- Guarantee every `noteCard` has a stable `id` at the data layer: in the migration pass (`:3913-3951`), assign `id: 'n_' + ...` to any card missing one (mint a unique, non-colliding id per card; do not reuse `Date.now()` for multiple cards in the same tick - append an index or a counter). This is the root fix.
- Defensive: in `DetailPane` change `key={n.id ?? i}` to a guaranteed-unique key (e.g. fall back to a composed key, but the migration should make `n.id` always present). Do NOT key by index.
- Confirm `saveEdit`'s `trimmed !== body` guard (`:2457`) is not itself the "won't save" symptom for the case where the user re-types the same text - that is intended (no-op), not a bug; do not change it unless the user reports that specifically.

**Live repro test (design before fixing - rule):** create an order whose `noteCards` contains 2+ cards where at least one has NO `id` (either via the import path, or temporarily hand-seed `wo-data.json` at `%APPDATA%\work-order-tracker\wo-data.json` with an id-less card, reload). Before the fix: pin/add a note to force a re-sort, then try to edit the id-less card - reproduce the "won't edit / edits wrong card" symptom. After the fix: every card edits correctly and the edit persists to the right card across pin/sort. Also retest the trailing `legacy` card (`id:'_legacy'`) - it intentionally has NO edit menu (`showMenu` excludes legacy); that is correct, leave it.

Commit Part C alone.

## PART D - overhaul the list context menu (ROADMAP line 14)
**Goal:** the right-click menu on a list row should let the user change every toggleable per-WO field without opening the edit form: **Status (nested submenu), PM, Type, Tech, Emergency (toggle), Warranty (toggle)**. Keep the existing View details / move / Send to Trash items and the existing bulk behavior.

**Port the MECHANISM from the working `DetailMenu`** (`index.html:~2115-2202`), do not invent a new one. Specifically reuse its nested-submenu pattern: a piece of menu state (it uses `statusOpen`) that swaps the menu body between the top-level list and a "Set status ... <- Back" sub-list. The list menu (`ctxMenu`, `:1938-1981`) currently has no such sub-state; add it. Because `ctxMenu` is a single object `{ woId, x, y, tab }` (`:1697`), extend it with a `sub` field (e.g. `sub: 'status' | 'pm' | 'type' | 'tech' | null`) rather than adding parallel state, OR add a local `React.useState` for the open submenu in `ListPane` - either works; match whatever is cleanest with the existing `closeCtx`/outside-click effect (`:1734-1746`).

**New top-level menu (active tab), replacing the flat status list at `:1952-1962`:**
- `Set status >` -> opens the status sub-list (the user explicitly wants Status as a side dropdown, not inline). Sub-list = one MenuItem per `statuses` + a `<- Back` item, mirroring `DetailMenu` `:2191-2197`. On select: bulk-aware - if `ctxBulk`, `onBulkSetStatus(s)`, else `onWoAction(woId,'setStatus',s)`, then `closeCtx()`.
- `Set PM >` -> sub-list over `statuses`' sibling list `pms` (pass `pms`/`types`/`techs` into `ListPane` as new props - they are available at App level, see SettingsDrawer wiring `:2699`/`:2816`). On select: `onWoAction(woId,'setPm',name)`.
- `Set type >` -> sub-list over `types`. On select: `onWoAction(woId,'setType',t)`.
- `Set tech >` -> sub-list over `techs` (+ an "Unassigned"/clear entry). On select: `onWoAction(woId,'setTech',t)`.
- divider
- `Mark emergency` / `Clear emergency flag` (label from current value) -> `onWoAction(woId,'toggleEmergency')`.
- `Mark warranty` / `Clear warranty flag` -> `onWoAction(woId,'toggleWarranty')`.
- divider
- existing `View details`, tab move items, `Send to Trash` (unchanged).

To know the row's current emergency/warranty/pm/type/tech for the labels, look it up by `ctxMenu.woId` from the orders/rows available to `ListPane` (the rows already carry `pm`, `type`, `tech`; emergency/warranty are on the raw order - confirm what `ListPane` has access to; if not present, pass a lookup or add the fields to the row projection at `:662-689`/`:812-836`).

**Extend `woAction` (`index.html:4708-4742`)** with the new kinds, reusing the exact mutation shapes already proven in `detailAction`:
- `setPm`: `updateOrder(id, cur => ({ ...cur, pm: payload, history:[...] }))` + toast.
- `setType`: same shape with `type`.
- `setTech`: same shape with `tech` (allow empty -> Unassigned).
- `toggleEmergency`: copy `detailAction`'s case `:4794-4799` verbatim (it already takes an id and does not depend on selectedWO).
- `toggleWarranty`: copy `:4801-4806`.
This consolidates the toggle logic in `woAction`; OPTIONAL cleanup: have `detailAction` delegate `toggleEmergency`/`toggleWarranty` to `woAction` like it already delegates the four shared kinds (`:4749`) - reduces duplication. Do this only if it does not change behavior.

**Bulk awareness:** for status, bulk already works via `onBulkSetStatus`. The user did not ask for bulk PM/type/tech/flag; scope PART D to single-WO for those (the menu already shows the per-WO labels). If you want bulk for them, that is a SEPARATE follow-up - do not expand scope here without asking.

**Wiring checklist:**
- `ListPane` signature (`:1692`): add `pms`, `types`, `techs` props (and emergency/warranty access if needed).
- ListPane call site (`:~4935-4940`): pass `pms={pms} types={types} techs={techs}` (these state values exist at App level - confirm names; statuses is already passed).
- Submenu state + render inside the `ctxMenu` block (`:1949-1979`), porting `DetailMenu`'s open/back mechanism.
- New `woAction` cases.

**Risks (mitigate or live-test):**
1. Outside-click / Escape close (`:1734-1746`) must not fire when navigating INTO a submenu (clicking "Set status >"). The detail menu handles this with `e.stopPropagation()` on submenu-open clicks (`:2166`) - port that. Live-test: open each submenu, click around inside, confirm the menu does not close until you pick an item or click outside.
2. Menu height: with status/PM/type/tech submenus, the active-tab top-level menu is short, but the status sub-list can be long. The detail menu caps with `maxHeight:360; overflowY:auto` (`:2151`). The list `ctxMenu` container (`:1940-1946`) has NO max-height - add `maxHeight` + `overflowY:auto` so a long status/tech list does not run off-screen. Also confirm the menu still fits when opened near the bottom edge (it is `position:fixed` at the click point; long submenus may overflow the viewport bottom - clamp `y` if needed, or rely on internal scroll).
3. `ctxBulk` interaction: when multiple rows are selected, only Status is bulk; PM/type/tech/flags act on the right-clicked `woId` only. Make the labels/captions unambiguous so the user is not surprised (e.g. status caption already shows the count; the per-WO items should NOT show a count). Live-test with 2+ selected.

**Live test (D):** right-click a row in Active - submenus for Status/PM/Type/Tech each open as side/back panels and apply correctly; emergency/warranty toggle and the label flips; View details / Send to Trash still work; a long status or tech list scrolls inside the menu instead of clipping; with multiple rows selected, Status applies to all selected while PM/type/tech/flags apply to the clicked row; nothing throws; the menu closes on outside click / Escape / after an action.

Commit Part D alone.

---

## Suggested commit sequence (4 commits, in any safe order; D is the largest)
1. Part A: right-align WO number under city in list row meta (formatting)
2. Part B: replace Address sort with City route sort (status > city > days-open)
3. Part C: fix note-card edit by guaranteeing stable noteCard ids
4. Part D: overhaul list context menu - editable per-WO fields + nested Status submenu (ROADMAP line 14)

## File map (verify line numbers before editing - they shift as you commit each part)
- `index.html:2019` `ListRow`; meta row `:2069-2082` (PART A); headline row `:2052-2067` (Change #6, context only).
- `index.html:719-740` `sortRows`; `:3422-3429` `SORT_DEFS`; `:~445-488` `SortMenu` (PART B).
- `index.html:842-859` `data.notes` builder; `:2340-2347` DetailPane note render; `:2438-2545` `NoteCard`; `:4669-4677` `editNote`; `:3913-3951` noteCards migration (PART C).
- `index.html:1938-1981` list `ctxMenu`; `:1692` `ListPane` signature; `:~4935-4940` ListPane call site; `:2115-2202` `DetailMenu` (PORT REFERENCE); `:4708-4742` `woAction`; `:4745-4810` `detailAction` (toggle reference) (PART D).
- Out of scope: `AlertCard` (`:~2601`), `FSAlertCard` (`:~3685`), `FullScreenLanding` (`:3568`), in-pane `Landing` (`:2534`). Do not touch.

## Notes / gotchas
- JSX compiled at runtime by Babel standalone; verify by reading, user reloads (Ctrl+R).
- Installed app at `%LOCALAPPDATA%\Programs\Work Order Tracker\resources\` is a SEPARATE frozen copy; test only via `npm start`.
- Order store: `%APPDATA%\work-order-tracker\wo-data.json` (renderer persists via `window.storage.set('wo_data', ...)`).
- This repo has duplicate components sharing labels - grep the visible string and confirm WHICH component renders it before editing.
- Prior branch work (do not disturb): all FIX items; sort keys + lastNote + Status(reverse) lock + direction toggle; Change #2 (scroll preservation, detail status dropdown, right-click menu + `woAction`, multi-select + BulkBar + bulk handlers); Change #3 (TypeIcon colorize + `TYPE_COLORS`, "View details" rename); Change #4 (in-pane Landing grid bound); Change #5 (mass status via right-click `bulkSetStatus`/`ctxBulk`; FullScreenLanding clip fix - scroll wrapper + `flexShrink:0` footer); Change #6 (status pill to far-left of meta row f00861f; city right-aligned by day counter 3d3079d).
- Remaining roadmap after this: line 15 (custom filters/pages via Tools dropdown), line 18 (scraper full address parsing - street vs city/zip), line 19 (scraper reliability + spreadsheet import).
