# 06-10 Change Requests — Slice Plan

Repo: `C:\dev\Work-Order-Tracker`. App v4.0.1.

## Rules (from CLAUDE.md — obey)
- Read files before editing.
- No emojis or em-dashes.
- Surgical edits matching existing style.
- Verify code path before claiming done.
- Prefer wrapping existing working code over rewriting.
- Two failed fixes -> re-examine approach, not symptoms.
- Static-review risks must be mitigated or live-tested before proceeding.

## Locked decisions (do not re-litigate)

- **Overdue threshold (#3):** global, set in Settings (minutes). No per-WO override.
- **Mark Complete bid prompt (#5):** reuse Send-to-Invoice modal, identical warn behavior.
- **Service Library prompt (#6):** modal w/ name, price, catalog dropdown, sub-category dropdown. Sub-categories editable in Settings. Sub-categories internal only — never exported to CSV.
- **Collapsible sidebars (#7):** persist collapse state per-session (sessionStorage).
- **Tech Job Types (#8):** custom trade list w/ custom colors. Per-tech sub-state: `{ selected: bool, weight: 'low'|'med'|'high' }`. Unselected trades never surface in routing.
- **Phase model (#9):** Hybrid phase-hooks. Phases stay user-editable. Each phase gets optional `systemTag` dropdown (`scheduled`, `bid_ready`, `complete`, `cancelled`, none). Triggers fire on tag, not on hardcoded name. Phases ordered by completion level — same-level statuses share phase, different-level statuses split phases. WO advances only; regression = manual correction.
- **Status pill display (#9):** per-phase `displayMode` flag: `pills` | `single` | `hidden`. User decides per phase.
- **Routing engine (#10):** Haversine straight-line distance × 1.3 road-factor. No OSRM. No true ETA. Sufficient for ranking. Visual route = Leaflet polyline straight lines.

## Slice order

- **Slice 1** — Quick UI + idle-bug fix (items 1, 2, 4, 7) — SHIPPED 2026-06-11 (see status below)
- **Slice 2** — Workflow gates + Service Library (items 3, 5, 6) — IMPLEMENTED 2026-06-11 (see status below)
- **Slice 3** — Tech Job Types (item 8) — IMPLEMENTED 2026-06-11 (see status below); prereq for Slice 5
- **Slice 4** — Phase hooks + displayMode (item 9)
- **Slice 5** — Routing v1 Haversine (item 10)

## Slice 3 status (2026-06-11) — SCHEMA LOCKED for Slice 5

Implemented + live-tested (browser preview, seeded). Awaiting user acceptance.

REDUNDANCY CORRECTION (feedback): first pass added settings.tradeList + wo.tradeTag, which DUPLICATED the existing work-order type system (settings.types + wo.type + mapTypeColors). User flagged it; per "full collapse" decision the parallel system was removed. The trades ARE the types.

LOCKED SCHEMA (Slice 5 routing reads this):
- Trades = `settings.types` (edited in Workflow > Manage types). Per-type color = `mapTypeColors` (Settings > Maps), default via TYPE_COLORS by name (HVAC/Plumbing/Electrical), else neutral gray.
- WO trade = the existing `wo.type` field (set in WOForm Type select). NO new wo.tradeTag.
- `settings.techJobTypes = { [techName]: { [typeName]: { selected: bool, weight: 'low'|'med'|'high' } } }` — the ONLY new state. Keyed by tech NAME then type NAME (techs stay a plain string array — no migration). Routing reads `techJobTypes[tech][wo.type].{selected,weight}`.
techJobTypes entries for a deleted/renamed type or tech go stale-but-harmless (no cascade prune wired; acceptable).
UI:
- New Settings tab "Tech Job Types" (TT_SECTIONS id 'trades', component TradesSection): grid ONLY — techs (rows) x types (cols, colored swatch). Each cell = checkbox + low/med/high weight (weight disabled until checked, defaults 'med'). No trade add/delete here (types live in Workflow, colors in Maps).
- NO DetailPane Trade dropdown, NO WOForm Trade field — wo.type already covers it.
Verified: grid columns = HVAC/Plumbing/Other with correct colors (HVAC #f97316 default, Plumbing #1e88e5 override, Other neutral), check+weight stores `techJobTypes.Daniel.HVAC = {selected:true,weight:'high'}`, DetailPane/WOForm show Type (not Trade), app mounts clean.
NOTE: the earlier "MigrationDialog crash" during testing was a harness artifact (repeated ReactDOM.createRoot on the same #root container); a pristine-container mount renders fine.

## Slice 1 status (2026-06-11)

Shipped after two feedback rounds. Implementation notes:
- Idle search bug: 7 A7 setTimeout-listener leaks patched (FilterDropdown, SortDropdown, PresetSBRow, InboxSBRow, DetailOverflow, DetailPane statusMenu, HeaderChips). User has NOT yet idle-tested. If bug recurs: premise wrong (rule C2) — re-investigate, do not re-patch listeners.
- Map markers: hover opens the popup itself (_hoverOpen flag on mouseover/mouseout; click = sticky). No bindTooltip. Popup shows id, addr, tech, schedule time, all unique phones (numbers only, no names).
- SidebarLauncherButton: shared component, fixed 176x40, in WO/Maps/Library/Invoices/Itinerary sidebars. NOT on Overview. Header Modules button removed from HeaderChips.
- Collapsibles: Itinerary only (Day/Tech/Unscheduled) via useCollapsedSection + sessionStorage. WO sidebar collapsibles explicitly rejected and reverted.
- WO module shell reworked: full-width header (Maps-style padding/subtitle/chevrons), Sidebar (width 200) below header; App grid sidebar column removed ('0 1fr 1.2fr' always).
- One user-reported fix still pending at session end (not yet specified). RESOLVED 2026-06-11: hover on another marker stole the click-sticky popup (Leaflet auto-closes the open popup on any openPopup()). Fix: mouseover handler skips while any other marker has a sticky popup (open and not _hoverOpen). Hover resumes after sticky popup dismissed. Live-tested in browser preview (hover preview, click sticky, hover-steal blocked, dismiss, hover re-enabled).

## Slice 2 status (2026-06-11)

Implemented and live-tested in browser preview (seeded data, synthetic events). Not yet user-accepted.
- #3 Overdue: `settings.overdue = { thresholdMinutes: 60, textColor, borderColor }` (defaults #ef4444). `isOverdueSched(date, start)` global reads module-level `OVERDUE_CFG` snapshot (assigned in App render; safe because no React.memo anywhere). Maps marker effect takes `overdueCfg` (memoized on settings.overdue) + `overdueTick` (60s interval in App) as deps. Recolors: WO list schedule span, DetailPane Scheduled field, Itinerary card (shows red time only when overdue), map marker stroke. Settings UI in Alerts section. Map popup schedule text left gold (not in spec).
- #5 Mark Complete bid prompt: `bidPrompt` state is now `{ id, mode: 'sent'|'complete' }`. `markComplete` wrapper prompts via BidPromptModal (verb prop adjusts buttons) when bid empty; `doMarkComplete` holds the old body. Bulk paths unchanged (bulk send still hard-blocks on missing bids; bulk mark-complete never prompts).
- #6 Service Library: "+ Add item" opens AddServiceItemModal (name, description, price, taxable checkbox [hidden for AMH — tax-inclusive], catalog defaulting to viewed tab, sub-category with "+ New sub-category..." inline create that appends to settings). Sub-cats list in `settings.librarySubCats`, CRUD also via Workflow section "Manage library sub-categories..." (SimpleListEditor, new `singular` prop). Table groups rows under sub-category headers + per-row sub-category dropdown (column appears only when sub-cats exist). xlsx export strips subCategory (exportLibrary field whitelist — proven via node roundtrip test); roundtrip import drops it (internal-only, accepted). Feedback round 1 (2026-06-11): desc + taxable fields and inline sub-cat creation were missing from the modal — added and re-verified against the EMPTY sub-category state. Catalogs (General/AMH) remain fixed: tied to AMH tax model, seeders, and invoice PM->catalog mapping; user-created catalogs would need those decisions first.
Feedback round 2 (2026-06-11): (a) Map marker SVG stroke clipped at crown — viewBox padded to "-2 -2 28 40" + style overflow:visible, width/height 24x34, iconAnchor [12,32], popupAnchor [0,-30]. (b) Seed General/AMH + Import/Export moved OFF the module header INTO a new Settings tab "Service Library" (TT_SECTIONS id 'library', component LibraryToolsSection). Logic extracted to shared hooks `useLibraryTools(lib, persist, toast)` + `useServiceLibraryStore()` (rule B3, no reimpl); ServiceLibrary module now consumes useServiceLibraryStore too. (c) Module header gained a "Sub-categories" button (opens SimpleListEditor); the Workflow "Manage library sub-categories..." button was MOVED into the new Service Library settings tab (removed from WorkflowSection). Per-row sub-category dropdown already lets you sort existing items once any sub-cat exists. SettingsDrawer now receives `toast` (needed by the hook). Verified cold-load: real `window.storage` stores service_library as a plain OBJECT (app load checks typeof==='object'; wo_data is the stringified/parsed one) — test shim updated to mirror that contract.

---

## Slice 1 — Quick UI + idle-bug fix

### FIX: Search bars still become non-functional after some time in app

**Symptom (user-reported):** input non-responsive after idle. Also reproduces when open note edit left idle. Restart app fixes.

**Hypothesis (pre-investigation):**
- Listener leak — debounced handler captures stale state, GC'd, never rebound.
- Modal/overlay z-index trapped — invisible overlay covers input after idle timeout.
- Electron BrowserWindow blur-state stale — focus event never refires.
- `setTimeout` in effect without cleanup (rule A7).

**Investigation (before code):**
- Spawn `cavecrew-investigator` on search-input handlers + idle/blur listeners across `index.html`.
- Grep `setTimeout`, `setInterval`, `addEventListener('blur')`, search-input id.
- Reproduce: open app, leave idle, attempt search. Capture console.

**Files (likely):** `index.html` (search input handlers), possibly `main.js` (window focus events).

**Acceptance:** search input remains responsive after 10min idle. Note edit idle does not block search.

**Risk:** root cause may span multiple subsystems. If two fix attempts fail, re-examine premise (rule C2).

---

### CHANGE: WO contact info needs to be visible on-hover in maps module

**Scope:** Map marker tooltip / popup shows contact info (name, phone, email) on hover.

**Files:** `index.html` map module section (Leaflet marker bindings).

**Implementation:** extend existing `bindTooltip` / `bindPopup` content to include contact block. Reuse contact-rendering helper if exists.

**Acceptance:** hover any WO marker -> tooltip shows address + contact name + phone + email (if present). No layout shift.

**Risk:** low.

---

### CHANGE: WO Module Launcher needs to be introduced to all module sidebars in same relative location as WO module sidebar (Keep chevron navigators)

**Scope:** Launcher button (currently in WO module sidebar only) replicated at bottom of every module sidebar. Same position, same formatting. Chevron navigators preserved.

**Files:** `index.html` — sidebar render for each module (Maps, Itinerary, Invoices, Library, Overview, etc.).

**Implementation:** extract Launcher button JSX into reusable snippet. Insert at sidebar bottom in each module. Match existing class names.

**Acceptance:** every module sidebar shows Launcher button at bottom. Click opens Launcher modal (Order Management / Accounting rows). Chevrons unchanged.

**Risk:** low. Visual regression test — manually verify each module.

---

### CHANGE: Lists in sidebars made collapsible to optionally give different sections more space

**Scope:** sidebar list sections collapsible. Collapse state per-session (sessionStorage).

**Files:** `index.html` sidebar sections.

**Implementation:** wrap each section header in toggle. Section body conditional render. Persist `{ sectionId: collapsed: bool }` to sessionStorage.

**Acceptance:** click section header -> collapses. Refresh w/in session -> stays collapsed. Close app + reopen -> resets to expanded (per-session).

**Risk:** low.

---

## Slice 2 — Workflow gates + Service Library

### CHANGE: Scheduled WOs whose scheduled time have been passed by 1hr need to have scheduled text and map marker border re-colored to indicate this (both customizable)

**Scope:** WO past `schedule + threshold` gets:
- Scheduled text recolored (in WO list, DetailPane, Itinerary)
- Map marker border recolored

Both colors + threshold (minutes) customizable in Settings.

**Files:** `index.html` (render of scheduled text + map marker styling, Settings panel).

**Implementation:**
- Add settings: `overdueThresholdMinutes` (default 60), `overdueTextColor` (default red), `overdueBorderColor` (default red).
- Compute `isOverdue(wo)` = `wo.schedule && now - wo.schedule.time > threshold`.
- Apply color when `isOverdue`.

**Acceptance:** schedule WO 2hrs in past -> text + marker border show overdue color. Settings change reflects live.

**Risk:** low. Verify no perf hit on large WO sets (compute once per render, not per marker).

---

### CHANGE: Bid prompt on Mark Completed in addition to send to invoice (extra verification)

**Scope:** Mark Complete action opens same modal as Send-to-Invoice (bid amount field, same warn behavior).

**Files:** `index.html` — Mark Complete handler.

**Implementation:** reuse Send-to-Invoice modal component. Bind to Mark Complete action. Both buttons invoke same flow w/ different `nextTab` target (`complete` vs `sent`).

**Acceptance:** Mark Complete -> modal opens -> if bid empty, warn. If user proceeds, WO -> tab=complete w/ bid saved.

**Risk:** low. Verify history entries emit `markComplete` correctly per change11 spec.

---

### CHANGE: Add Service Library Item opens prompt instead of adding new line automatically (auto-categorizes based on selected Catalog). Potentially add sub categories to more cleanly organize service items (internal — not exported upon export to csv)

**Scope:**
- "Add Service Item" button opens modal instead of inserting blank row.
- Modal fields: name, price, catalog (dropdown — auto-selected if user was viewing a catalog), sub-category (dropdown).
- Sub-categories CRUD in Settings.
- Sub-categories never exported to CSV.

**Files:** `library_io.js`, `index.html` (Service Library module + Settings).

**Implementation:**
- Add `subCategories: []` to settings or library file.
- Modal w/ form. On submit, append item to library w/ `catalog` + `subCategory`.
- CSV export: strip `subCategory` field before write.
- Settings panel: list w/ add/remove for sub-categories.

**Acceptance:** Add Service Item -> modal -> fill -> appears in library under correct catalog/sub-category. CSV export omits sub-category column. Sub-category Settings CRUD works.

**Risk:** library schema migration if existing library lacks `subCategory` field. Default to `null` on load.

---

## Slice 3 — Tech Job Types

### FEATURE: Add Tech Job Types per tech to designate which trades they can accommodate (possible toggleable [low/medium/high] weights for type preference per tech for routing Feature)

**Scope:**
- Custom trade list w/ custom hex color per trade (Settings).
- Per-tech grid: each trade has checkbox + tri-state weight dropdown (only enabled if checkbox on).
- Data shape:
  ```
  settings.tradeList = [{ name: 'Plumbing', color: '#1e88e5' }, ...]
  tech.jobTypes = {
    'Plumbing': { selected: true, weight: 'high' },
    'Electric': { selected: false }
  }
  ```
- WO gains `tradeTag` field (set manually for now; auto-detection out of scope).

**Files:** `index.html` (Settings — Trades panel, Techs panel; WO DetailPane — trade tag field).

**Acceptance:**
- Add custom trade w/ color in Settings.
- Per-tech grid shows all trades, checkbox + weight.
- WO DetailPane has trade tag dropdown.
- Data persists across reload.

**Risk:** prereq for Slice 5 routing. Lock schema before Slice 5 starts.

---

## Slice 4 — Phase hooks + displayMode

### FEATURE CHANGE (DISCUSS FIRST): Status pills and phases potentially need to be phased out for hardcoded phases to better integrate to other modules (i.e: Scheduled phase requires schedule pop-up to update Itinerary when changing phase to Scheduled, recolor Map module markers in Job Completed - Enter Bid phase or equivalent)

**Decision (LOCKED 2026-06-12 after design discussion — supersedes the original phase-tag framing below):**

Tags bind to STATUS, not phase (triggers are status-granular: "Scheduled" fires, "Contacted" in the same phase does not). Status names stay user-configurable; the handler is hardcoded, the trigger is a dropdown. Phase is DERIVED from status (`phaseForOrder` reads `o.status`) — so NO per-WO migration, risk is LOW not HIGH. Completion/cancel stay hardcoded (change11 markComplete/softDelete) — NOT re-tagged. Movement is free (user loops); no advance-only / regression enforcement.

**Data (one new field + reuse):**
- `settings.statusTags = { [statusName]: 'schedule' | 'onsite' | 'visited' | 'offmap' }`. Keyed by status name; rename/delete propagate exactly like `statusColors` (StatusesEditor ~line 4400-4435).
- `phases[].displayMode = 'pills' | 'single' | 'hidden'` (default 'pills') — stored on existing phase objects, no new map.
- `wo.returnPending` boolean flag — clones emergency/warranty pattern.
- Marker outline reuses existing `statusColors` (no new color UI).

**The 4 tags:**
- `schedule` — ONLY imperative handler. In woAction case 'setStatus' (single-WO funnel ~10456), after update, if statusTags[newStatus]==='schedule' -> setScheduleTarget(id) (reuses ScheduleModal ~10560/10971). Single interactive only; bulkSetStatus untouched (no 50x modal).
- `onsite` — pure render. Map marker outline = status color, precedence onsite > overdue(Slice2) > statusColors[status] > white. On Site beats overdue.
- `visited` — pure render. Scheduled WO with this tag leaves the Itinerary day list/pool; schedule data KEPT (history/map intact); card text gone.
- `offmap` — pure render. Marker hidden when statusTags[status]==='offmap' (the "Job Complete - Enter Bid" drop-off). ALL other active WOs stay on map, incl. unscheduled (Open/Contacted) — user wants them for route-finding.

**Settings UI:**
- StatusesEditor: per-status systemTag dropdown (none/schedule/onsite/visited/offmap), mirror existing color/phase controls + rename/delete propagation.
- WorkflowSection phase rows: per-phase displayMode dropdown.

**displayMode render (ListPane group map ~2704):** pills=current; single=status as plain label; hidden=phase header only (rows collapsed).

**Reuse (rules 1/5):** ScheduleModal, statusColors, emergency/warranty flag, StatusesEditor rename-propagation, itinerary day filter, marker stroke. All extended, none rebuilt.

**Build order (each step inspected before next, rule 6 for preview tests):**
1. statusTags data + StatusesEditor dropdown + rename/delete propagation.
2. schedule hook (modal on set).
3. Map outline-by-status + onsite precedence + offmap hide.
4. visited itinerary filter.
5. returnPending flag (form + badge + filter).
6. displayMode per phase.

**Risk (LOW):** only real hazard = rename/delete must update statusTags keys (mirror proven statusColors path). User context: real statuses are Open, Contacted, Scheduled, On Site, Return - Bid Not Entered (-> becomes the returnPending flag, Option A), Bid Submitted - Return, Return Trip Scheduled, Parts Pending, Job Complete - Enter Bid (-> offmap), plus hardcoded completed. Phases stay user-managed; app ships the controls, user arranges phases.

**Acceptance:**
- Status tagged `schedule` -> setting it on one WO opens Schedule modal; bulk-set does not.
- `onsite` -> marker outline = status color, overrides overdue border.
- `visited` -> WO leaves Itinerary, keeps schedule + map marker.
- `offmap` -> marker removed; all other active (incl. unscheduled) stay.
- displayMode single -> label only; hidden -> header only.
- returnPending flag -> badge + filter.
- Rename a tagged status -> tag follows; delete -> tag drops.

**STATUS: BUILT 2026-06-12 (all 6 steps), inspected each step in browser preview. Awaiting user whole-slice live test.**
Verified per step:
1. statusTags dropdown in Manage statuses; set persists to settings.statusTags; delete drops the key (rename = line-mirror of the proven statusColors move).
2. schedule hook: setting a schedule-tagged status on one WO opens ScheduleModal; untagged status does not; bulkSetStatus never routes through woAction setStatus (structural).
3. Map: offmap status hides marker; outline precedence onsite(status color) > overdue > statusColors[status] > white; On Site beat the overdue border live (3 markers w/ 1 offmap hidden).
4. Itinerary: visited-tagged scheduled WO dropped from the day timeline, not in the unscheduled pool, schedule data kept.
5. returnPending: list badge (↩), detail Flags text, WOForm checkbox (add + edit), submit persists; toggleReturnPending action added (mirror of toggleWarranty).
6. displayMode: per-phase dropdown in Workflow; list render single=plain label (borderRadius 0), pills=StatusPill (999px), hidden=header only (rows removed, header stays).
Notes: marker fill stays the work-type color; outline now carries status. returnPending "filter" not built (badge satisfies the at-a-glance need); add later if wanted. completion/cancel untouched (change11). No per-WO migration. Verification gotcha logged: must RELOAD the preview page after edits before remounting (remount alone runs stale loaded JS).

---

## Slice 5 — Routing v1 (Haversine)

### FEATURE (DISCUSS FIRST): Add routing functionality to app, based in Maps module to gauge distance, but used in WO and Itinerary modules to suggest optimal next WO based on most optimal route per technician job type preferences. Maps route tracker visual to track technician routes (potentially add Tech colors to app to differentiate routes per Tech)

**Decision (locked):**
- Distance: Haversine × 1.3 road-factor. No OSRM. No true ETA.
- Suggestion surface: Schedule modal (chaining WOs).
- Two tabs: **Suggested** (composite score) + **Close By** (pure distance).
- Already-scheduled WOs excluded from both lists.
- Multi-city weighting: same-city bonus + unfilled-city bonus.
- Per-tech color on map for route polylines.

**Scope:**
- Geocode existing WOs (likely already done — verify). If addresses lack lat/lon, geocode on save.
- Composite score (tunable weights in Settings):
  ```
  score(candidate, tech, lastWO) =
      w_dist * (1 / haversine(lastWO, candidate))
    + w_city * (candidate.city === lastWO.city ? 1 : 0)
    + w_unfilled_city * (otherUnscheduledInCity(lastWO.city) > 0 ? 1 : 0)
    + w_type * weightMap[tech.jobTypes[candidate.tradeTag].weight]
  ```
- Filter: `tech.jobTypes[candidate.tradeTag].selected === true`.
- Filter: `candidate not in scheduled itinerary`.
- Schedule modal: add Suggested + Close By tabs above existing form.
- Map module: each tech gets color (set in Tech Settings, Slice 3 added). Draw polyline through scheduled WOs in tech color.

**Files:** `index.html` (Schedule modal, Map module polyline render, Settings — routing weights), possibly `library_io.js` or new helper for haversine + scoring.

**Acceptance:**
- Open Schedule modal for tech w/ existing scheduled WOs -> Suggested tab shows filtered + ranked unscheduled WOs.
- Close By tab shows nearest unscheduled, no job-type filter.
- Unschedule a WO -> reappears in Suggested/Close By immediately (live).
- Map shows polyline per tech in tech color through scheduled WOs.

**Risk:**
- Geocoding gap — if WOs lack lat/lon, scoring breaks. Fallback: skip WO from list w/ warn.
- Performance — recompute on every modal open. Cache haversine matrix if N > 200.
- Live test required: schedule WO, verify removed from list. Unschedule, verify returns (per rule C4, user explicitly requested this test).

**Prereq:** Slice 3 (Tech Job Types) shipped.

---

## Investigation tasks (pre-Slice 1)

- Search-bar idle bug: spawn `cavecrew-investigator` on:
  - All `addEventListener` w/ search input
  - `setTimeout` / `setInterval` in idle paths
  - Window blur/focus handlers
  - Any modal/overlay that could trap input
- Output: file:line table of suspect handlers. Decide root cause before patching.
