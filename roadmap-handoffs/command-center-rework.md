# COMMAND CENTER — WO module rework (tri-panel → full-width list + per-WO command-center overlay)

## STATUS 2026-06-29 — ALL SLICES IMPLEMENTED (A1-A4, B1-B2). Build clean. Not yet released.
Verified in a seeded browser harness (stubbed window.storage + Leaflet CDN): clean mount, zero
console errors; full-width list; click opens overlay; Esc closes; MapInset = ONE Leaflet
instance + "Open in Maps"; DayTimeline shows the scheduled day + "Open in Itinerary";
prev/next "2/3"; phase stepper; Siblings + Nearby dropdowns; note add + edit register with
focus retained; Clients sidebar (All/AMH/MSR/Private Customer) with AMH filtering the list;
PM pill removed.
STILL NEEDS A REAL ELECTRON CLICK-TEST (harness can't prove the Electron-specific
[[bug_note_card_input_lock]] is absent, and uses synthetic events): note add/edit/MoreInfo in
the overlay, capture-from-portal (AMH), Go-to-folder, and the Leaflet tiles actually painting.
Files touched: src/app.jsx, src/maps.jsx, src/itinerary.jsx, src/detail.jsx, src/listpane.jsx,
src/invoices.jsx, src/settings.jsx. New exports: CommandCenter/CCTopBar/CCDropdown/PhaseStepper/
QuickJump (app.jsx), woMarkerIcon/MapInset (maps.jsx), DayTimeline (itinerary.jsx). New App
state: coOpen, visibleOrder, quickJumpOpen (+ openWO/highlightWO).

Scope: deprecate the Work Orders tri-panel (`Sidebar | ListPane | DetailPane`). List goes
full-width (eats the old detail column). Clicking a WO opens a near-full centered modal
"command center" for that WO: existing DetailPane (header + notes + activity) on the left,
a right rail with a live Leaflet map inset + a read-only itinerary day-timeline inset, plus
overview/navigation aids (prev/next, phase stepper, sibling WOs, nearby-same-trade dropdown,
recent strip, quick-jump palette, keyboard contract).

Repo: `C:\dev\Work-Order-Tracker`. Released v4.5.0; target v4.6.0 (bump `package.json` +
`APP_VERSION` together — see memory `ref_release_repo_path`).

Build is REAL (not Babel-standalone — older handoffs say otherwise; they are stale):
- esbuild bundles `src/app.jsx` → `bundle/app.js`. Command: `npm run build:renderer`.
- `npm run watch:renderer` for iterative work. `npm start` = build + electron.
- After a build, reload the renderer with Ctrl+R. index.html loads the bundle.

## Rules (from CLAUDE.md — obey)
- No emojis or em-dashes in code/UI.
- Read files before editing; do not re-read unchanged files.
- Verify APIs by reading code/docs; do not guess.
- Port the MECHANISM (stack/tool/technique), not just selectors/constants/field names.
- Surgical changes; match existing style. Reuse an existing field/state before adding new.
- Flagged risk = mitigate or design a live test before proceeding.
- 2nd failed attempt at same problem → re-examine approach, not symptoms.

---

## Confirmed user decisions (do not re-litigate)

1. **Mechanism: modal overlay** (not inline accordion, not slide-over). One Leaflet instance
   alive at a time; list stays put underneath; Esc closes.
2. **Size: near-full centered** (~1100px wide × ~80vh).
3. **Map inset: live Leaflet** (interactive mini-map, single marker, fixed high zoom on RDU).
4. **Itinerary inset: read-only** view + jump to full module. No inline drag-reschedule.
5. **All 8 overview/nav enhancements below are IN.** None skipped.
6. **#5 nearby refinement:** nearby list filtered to **same trade (including dual-type)**,
   rendered as a **dropdown** to select any of the listed nearby WOs (not a static list).

---

## Verified investigation (file:line)

### A) Current WO module shell — `src/app.jsx`
- Module grid: `app.jsx:5599-5606`, `gridTemplateColumns: '0 1fr 1.2fr'`.
- WO branch: `app.jsx:5667-5752`. Content div `gridColumn:'2 / 4'` →
  `WorkOrdersHeader` (5669), then flex row: `Sidebar` (5698) | `ListPane` wrapper
  `flex:1 1 0` (5709) | `rightPane` wrapper `flex:1.2 1 0` (5748).
- `rightPane` = `<DetailPane .../>` built at `app.jsx:5522-5546`.
- Selection state: `selectedWO` (holds `o.id`). Set via `onSelectWO` (5725-5729),
  `pushRecent(wo)` already called there. `pushRecent` maintains recent history (reuse for #6).
- `detailData` feeds DetailPane (built earlier; `toDetailData`/`toDisplayRow`).

### B) DetailPane — `src/detail.jsx`
- `export function DetailPane({ data, ...handlers })` (`detail.jsx:173`). Renders a full-height
  `<section>`: dense header (WO#/status/age/flags/nextAction/overflow), address, 5-col field
  grid, then notes body (`MoreInfoCard` + pinned/unpinned `NoteCard` + `NoteComposer`),
  then `ActivityLogAccordion`. **Reusable verbatim as the overlay left column.**
- Overflow actions (`DetailOverflow`, `detail.jsx:64`): Edit, Edit invoice, Capture,
  Create folder, Go to folder, status, complete, duplicate, flags, trash. **#4 promotes the
  common ones to a visible button row in the overlay (keep `...` for the long tail).**

### C) Note input-lock bug — RISK
- `bug_note_card_input_lock` (memory, OPEN/recurring): editing a saved `NoteCard` can freeze
  ALL text entry until app restart. `NoteCard` edit focus logic: `detail.jsx:630-636`.
  `MoreInfoCard` same pattern: `detail.jsx:529-535`. Moving DetailPane inside a `Modal`
  changes focus/stacking context — could trigger or mask it. **GATE: live-test note add +
  note edit inside the overlay in Slice 1 before any inset work. Capture console +
  document.activeElement if it repros; do not blind-patch.**

### D) Maps / Leaflet — `src/maps.jsx`
- Leaflet is CDN global `window.L`. Init pattern: `maps.jsx:160-177`
  `L.map(container,{zoomControl,boxZoom:false}).setView(center,zoom)` + OSM `L.tileLayer`.
  Cleanup nulls `mapRef.current`.
- Marker build + color: `maps.jsx:186-294`. `fillColor` from status composite, `strokeColor`
  from `typeColors[o.type]`, overdue/suspect handling. `L.marker([g.lat,g.lon],{icon,opacity})`.
- **geocache keyed by WO# (`o.id`)** → `{ lat, lon, error? }` (`maps.jsx:199`, `:415`).
  `geocache = settings.geocache` (`app.jsx:3559`). Available in app render scope → pass to overlay.
- **MapInset reuse plan:** new small component, own `L.map` instance, `setView([lat,lon], ~15)`,
  one marker reusing the same fill/stroke/overdue logic. Port the icon-build mechanism from
  maps.jsx (do not re-derive colors). Mount only while overlay open (one instance).

### E) Itinerary / day-timeline — `src/itinerary.jsx`
- Helpers already exported from app.jsx and consumed here: `itinSlots`, `itinSnapSlot`,
  `itinFmtTime`, `itinTodayStr`, `itinShiftDay`, `itinDayLabel` (`itinerary.jsx:8-13`).
- Day grid: `slots = itinSlots()` (`:86`); `scheduledBySlot` built by snapping
  `o.schedule.start` (`:106-110`); timeline render `slots.map(slot => ...)` (`:351+`).
- Nearby (current mechanism): **same-city**, unscheduled only —
  `nearby = unscheduled.filter(u => cityOf(u) === myCity)` (`:370`, `:402`). `suggestFor`
  state drives the open nearby panel (`:51`, `:399`).
- **DayTimeline reuse plan:** carve a read-only component taking `(activeOrders, tech, date,
  highlightWO)`. Recompute `scheduledBySlot` the same way, render slot rows WITHOUT drag
  handlers, auto-scroll the highlighted WO's slot into view. Empty/`tech` unscheduled →
  "Not Scheduled". Default `date` = this WO's `schedule.date`, else today.

### F) Trade model (for #5 same-trade filter) — `src/constants.js` + `src/app.jsx`
- Types: `DEFAULT_TYPES = ['HVAC','Plumbing','Plumbing+HVAC']` (`constants.js:11`). Dual is real.
- `typeLetter(type)` (`app.jsx:415-424`): `P` if /plumb/, `H` if /hvac|heat|cool|furnace/,
  `PH` if both, else first letter.
- **Same-trade test:** derive each WO's trade set from `typeLetter` → `{P}`, `{H}`, or `{P,H}`.
  Two WOs match if their trade sets INTERSECT. Dual (`PH`) matches both P-only and H-only WOs.
  No new field — derive from existing `o.type` via `typeLetter`.

---

## Enhancements (all IN)

1. **Prev/Next WO arrows** in overlay header. Walk the current filtered/sorted list order.
   Reuse the SAME order ListPane uses for arrow-key nav: its `flatRows` (`listpane.jsx:133-139`).
   Lift that order or recompute identically so overlay and list agree. No wrap (hard-stop ends,
   matching module-nav convention).
2. **Phase stepper** — horizontal stepper of workflow phases with the WO's current phase
   highlighted. `phases` already passed to the module (drives ListPane grouping). Render-only.
3. **Same-address sibling WOs** — "N other WOs at <addr>" → click swaps overlay to that WO.
   Match on normalized address (`splitAddress(o).addr`, `app.jsx:428`). Domain: properties get
   multiple trades/visits; aligns with `findDuplicate`/`ref_wo_dedup_scraper`.
4. **Promoted action button row** — surface Capture / Go to folder / Edit / Invoice as visible
   buttons; keep `...` overflow for the long tail (reuse `DetailOverflow` handlers).
5. **Nearby same-trade dropdown** — dropdown listing nearby WOs filtered to same trade
   (intersection rule, §F). Selecting one swaps the overlay. Nearby = reuse existing same-city
   mechanism (`cityOf` match, §E) as default; radius-via-geocache is a noted upgrade, NOT
   required for v1. Reuse `suggestFor`-style single-id state; do not add a parallel system.
6. **Recent WOs strip** — last ~5 from existing `pushRecent` history, as quick chips.
7. **Quick-jump palette** — Ctrl+K, fuzzy WO#/address, opens overlay directly. Distinct from
   header search (which filters the list).
8. **Keyboard contract** — Enter opens overlay for selected row; Esc closes overlay; ↑/↓ keep
   walking the list (already wired `listpane.jsx:141-156`) and, while overlay open, restack its
   content to the newly selected WO. Single-click also opens (detail is no longer inline).

---

## State plan (reuse, per rule 5)
- Overlay open === `selectedWO != null` while in WO module. Closing the overlay clears
  `selectedWO` (or a single bool `coOpen` if we must keep highlight after close — add ONLY if
  the highlight-after-close requirement is confirmed; default = clear). One new state max,
  with stated reason.
- Prev/next + sibling + nearby + quick-jump all just call the existing select path
  (`setSelectedWO` + `pushRecent`). No new selection system.
- Insets are pure children of the open WO's data; no new global state.

---

## Slice plan (ship incrementally; each builds + Ctrl+R verified)

**Slice 1 — Shell flip + overlay scaffold + note-bug gate**
- List wrapper → full width; remove the `flex:1.2` DetailPane column from the WO branch.
- Click WO → `Modal` (near-full centered) containing existing `<DetailPane>` (left, flex) +
  empty right-rail placeholder. Esc/`onClose` clears selection.
- Wire Enter (open) / Esc (close); single-click opens.
- **GATE:** live-test note add + edit + MoreInfo edit inside the overlay (bug §C). Must pass
  before Slice 2. If it repros, capture console + activeElement, fix root cause.
- Accept: list spans full width; clicking opens overlay with working notes; Esc closes; arrows
  still walk list.

**Slice 2 — MapInset** (right rail top)
- New `MapInset({ wo, geocache, ... })`: own `L.map`, `setView([lat,lon], ~15)`, single marker
  reusing maps.jsx fill/stroke/overdue logic. No geocode → "No location" placeholder.
- "Open in Maps" jump (reuse `onOpenWO`/maps `selected` path).
- Accept: marker correct color/zoom; opens/closes without leaking Leaflet instances
  (verify `mapRef` nulled on unmount); one instance at a time.

**Slice 3 — DayTimeline inset** (right rail bottom)
- Carve read-only `DayTimeline({ activeOrders, tech, date, highlightWO })`. Default date =
  WO `schedule.date` else today. Auto-scroll highlighted slot into view. "Not Scheduled" empty.
- "Open in Itinerary" jump (reuse `itinFocus`/`onOpenWO`).
- Accept: shows assigned tech's day, scrolls to this WO's slot, empty state when unscheduled.

**Slice 4 — Overview/nav aids**
- Prev/next arrows (#1, shared list order), phase stepper (#2), sibling WOs (#3),
  promoted action row (#4), nearby same-trade dropdown (#5), recent strip (#6),
  quick-jump palette (#7), full keyboard contract (#8).
- Accept: each aid swaps/opens the overlay via the existing select path; no list reflow.

---

## New components (summary)
- `CommandCenter` (overlay shell; wraps `Modal` + DetailPane + right rail + nav aids).
- `MapInset` (Slice 2).
- `DayTimeline` (Slice 3, read-only carve from ItineraryModule).
- Nav aids may be inline within `CommandCenter` (keep small) unless one grows.

## Open micro-decisions (resolve at implement time, default in parens)
- Highlight-after-close: clear `selectedWO` on close (default) vs keep highlight (needs 1 bool).
- Nearby radius upgrade: same-city (default v1) vs geocache radius (later).
- Overlay anchor exact px: 1100×80vh centered (default); tune to content.

---

# WORKSTREAM B — Client inbox sidebar + PM→Client rename

Separable from the overlay (Workstream A) but same WO-module shell + release. Can land before
or after A.

## Confirmed user decisions (do not re-litigate)
1. Sidebar gains a **Clients** section: an **"All"** row + one row per entry in the existing
   `pms` list (Settings-editable). Gmail-style inbox-per-Client.
2. **No special private-customer logic.** User will add a Client named e.g. "Private Customer"
   in Settings and file private calls under it. Private = just another Client row. One inbox each.
3. Selecting a Client filters the list to `o.pm === <client>`. "All" = unfiltered active view.
4. **Remove the PM `FilterDropdown` pill** (`listpane.jsx:184`). Other pills (Type/Status/Tech) stay.
5. **Rename USER-VISIBLE "PM" → "Client" only.** Keep internal data: `o.pm` key, `pms` array,
   `PMsContext`/`usePMs`/`PMChip` identifiers, `filters.pm`. **No data migration** (scraper
   writes `pm`; untouched). Exclude AM/PM time strings.

## Verified investigation (file:line)
- `pms` source: `DEFAULT_PMS` (`constants.js:4`) = AMH, MSR. App: `pms = data.pms` (`app.jsx:3627`),
  `setPms` (`:3628`), provided via `PMsContext` (`:5550`).
- `o.pm` = per-WO client field (`toDisplayRow`, `app.jsx:454`).
- Sidebar (`app.jsx:1482`): renders `presets` (`sv:`) + `inboxes` (`ib:`). Add a **Clients**
  section (place at TOP, primary). Needs `clients` (=pms) + `activeClient` highlight props.
- View-prefix resolution: `sv:`/`ib:` parsed at `app.jsx:4538-4561`; `effectiveFilters` at
  `:4543`. **Add `cl:<name>` prefix** → `viewData = active()` with `effectiveFilters = {pm:name,...}`.
  `selectView` handles the prefix; "All" selects the plain `active` view.
- Pill to remove: `FilterDropdown label="PM"` (`listpane.jsx:184`) + its `pmOptions` (`:60`).
- Visible "PM" labels to rename → "Client":
  - `app.jsx:970` FormField label (WOForm).
  - `app.jsx:3311` table `<th>`; `invoices.jsx:779` table `<th>`.
  - `app.jsx:4849` CSV column header `['PM', ...]` → `['Client', ...]`.
  - `app.jsx:735` stale-alert blurb fallback `'PM'` → `'Client'`.
  - Settings PMs section: verify each of settings.jsx's ~16 `pm` hits; rename heading + helper
    text + any "PM" labels; LEAVE internal identifiers. (Enumerate during implement.)
- DO NOT rename: `app.jsx:576`, `app.jsx:3078` (AM/PM time). `usePMs`/`PMsContext`/`PMChip`/
  `DEFAULT_PMS`/`pms`/`o.pm` (internal).

## State plan (reuse, per rule 5)
- Client selection rides the existing `currentView` string (new `cl:` prefix) — same mechanism
  as `sv:`/`ib:`. No new selection state. Highlight via `activeView === 'cl:'+name`.
- Filtering reuses `effectiveFilters.pm`. No parallel filter system.

## Slices
**B1 — Rename PM→Client (visible only).** Mechanical; enumerate + change visible strings,
verify build + UI, confirm no data-key touched. Ships independently.

**B2 — Clients sidebar section + `cl:` view + remove pill.**
- Add Clients section to `Sidebar` (All + per-`pms` rows); pass `clients`/`activeClient`.
- Handle `cl:<name>` in view resolution (`app.jsx:4538-4561`) + `selectView`.
- Remove PM `FilterDropdown` + `pmOptions` from `listpane.jsx`.
- Accept: clicking a Client filters list to that client; "All" clears; highlight tracks;
  Type/Status/Tech pills still work; no PM pill.

## Open micro-decisions (B)
- Clients section order: top of sidebar (default, primary sort) vs below Saved views.
- Empty Client (a `pms` entry with 0 WOs): still show row (default) vs hide.

---

# ROUND 2 — post-implementation change requests (2026-06-29)

## STATUS — ALL IMPLEMENTED (C-G). Build clean. Harness-verified, not released.
Browser-harness checks passed: C dropdown menus z-index 1000 inside the top-bar's z-20 layer;
D list chip "AMH" in client color + fullName tooltip, sidebar "AMH · American Homes 4 Rent";
E Leaflet inset mounts; F row left-bar = status color, status as colored text, age = colored
counter. NOT runtime-exercised (need real Electron + small preview viewport here): E maps
type-filter toggle + Schedule-from-map modal, G auto-status on actual scheduling. Files touched:
constants.js, data.js, primitives.jsx, settings.jsx, maps.jsx, listpane.jsx, app.jsx.

All decisions below are user-confirmed. Same repo/build/release as above.

## C — Top-bar dropdowns render under the map inset (bug)
`CCDropdown` menu `zIndex:5` loses to Leaflet's stacking context (panes z 200-700) and the
inset paints later in DOM than the top bar. Fix: give the `CCTopBar` container
`position:relative; zIndex:20` (new stacking layer above the body) and raise the menu z.
Files: app.jsx (CCTopBar wrapper, CCDropdown menu). Trivial.

## D — Client identity + acronym  [DECIDED: code-stable + editable code]
Root cause: `PMChip` (primitives.jsx:13) resolves `pms.find(p => p.name === pm)` and renders the
name; `o.pm` stores the name, so renaming a Client orphans every WO (grey `#6b7280`).
Model: each Client = `{ code, fullName, color }`. **`o.pm` keeps the code** (e.g. 'AMH'/'MSR' —
already stored + what the scraper writes), so NO WO migration and renames never orphan.
- constants.js `DEFAULT_PMS`: add `fullName` to each entry; current `name` becomes the stable
  `code` (keep the `name` key OR introduce `code` — pick one and update all readers; least churn
  is to KEEP `name` as the code and ADD `fullName`).
- primitives.jsx `PMChip`: render the code; resolve color by code; gray only if truly unknown.
- settings.jsx `PMsEditor` (renamed Manage Clients): edit `fullName` + an editable `code`
  (auto-suggested from capitals of fullName, user-correctable — AMH does NOT auto-derive from
  "American Homes 4 Rent", so the suggestion is just a default). Verify the addPm color-swatch
  save bug (user reported the swatch not applying to a new Client).
- Sidebar Clients rows: show fullName (or code + fullName); selection still `cl:<code>`.
- Migration: backfill `fullName` for existing AMH/MSR/Other (default fullName = code).
Acronym helper: derive capitals, fall back to first 3 letters; editable.

## E — Maps QOL  (depends on D for the popup line)
- Type filter (HVAC / Plumbing / dual show-hide): small state in maps sidebar, filter `list`.
- Schedule from maps: add a "Schedule / Reschedule" item to the marker right-click menu AND the
  sidebar list row -> `onWoAction(id, 'openScheduleForm')` (reuses `ScheduleModal` app.jsx:3386;
  maps already receives `onWoAction`). Goes through `setSchedule` -> picks up the E/auto-status.
- Client code in marker popup: add a line to the popup html (maps.jsx marker build), code form.
- "Go to WO details": maps `onOpenWO` currently sets `selectedWO` but NOT `coOpen`, so the
  overlay never opens (only the list-scroll effect fires "sometimes"). Route through `openWO(id)`.

## F — WO list visual rework  [DECIDED: status left-bar + text, colored age]
listpane.jsx `ListRow` (378+):
- Remove the age-based row background (`ageBg`, :397-400 / :412). Selected/checked tint stays.
- Add a status-colored LEFT BAR per row (borderLeft, statusColor(row.status)) — mirror the
  itinerary card pattern (itinerary.jsx:194). Overdue can override.
- Status: drop `StatusPill` in the list (:430-437) for plain text. KEEP the pill in DetailPane.
- Age: render `row.age` ("Xd") as a counter colored by `row.ageLevel` (the tints currently on
  bg move to the number). 
- Reclaimed space: tighten the meta row; keep code(PMChip)/type/tech/sched/WO#. Iterate visually.

## G — Schedule auto-status + return trip  [DECIDED: derive from history]
No 'Scheduled'/'Return Trip' status and no counter exist today; `schedule` is a SYSTEM_TAG
(constants.js:78) on a user-named status; `setSchedule` (app.jsx:5041) never touches status.
- constants.js `SYSTEM_TAGS`: add `'returnschedule'` (+ label). Settings statusTags editor picks
  up new tag automatically (verify the editor lists SYSTEM_TAGS).
- `setSchedule`: when `schedule !== null`, before writing history, check if a prior `'scheduled'`
  history action exists. None -> set status to the `schedule`-tagged status; else -> the
  `returnschedule`-tagged status. Only auto-set if such a tagged status is configured and the
  current status differs. This is the single chokepoint for ALL schedule paths (itinerary drag,
  ScheduleModal, route send) -> consistent.
- "Phase Scheduled->In Progress resets counter to 1": automatic with history-derivation (a prior
  'scheduled' entry persists -> next schedule is a return trip). No counter field, no reset code.

## Recommended ordering
C (trivial) -> D (foundational; E popup needs it) -> E -> F -> G. D and G both ride existing
chokepoints (`o.pm`, `setSchedule`) so they stay surgical.
