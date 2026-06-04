# CHANGE #10 — Module rework: chevron nav, Overview module, Maps module, header redesign

Scope: relocate module navigation arrows out of the full-height side rails into a per-module top header strip; turn the current FullScreenLanding into a proper "Overview" module reachable only via a dedicated home-chevron; reorganize ModuleLauncher into two titled rows; add a Google Maps Embed module; redesign Work Orders module header to match the other modules' style; remove the "proceed to WOs" button from the in-app Attention surface; disable Claude Code's "what's new" startup banner.

Repo: `C:\dev\Work-Order-Tracker`. App version 3.2.x. Electron + React via Babel-standalone (no build step). User reloads with Ctrl+R.

## Rules (from CLAUDE.md — obey)
- No emojis or em-dashes in code/UI.
- Read files before editing; do not re-read unchanged files.
- Verify APIs by reading code/docs; do not guess.
- Port mechanism, not just surface, when modeling from existing components.
- Surgical changes; match existing style.
- Flagged risk = mitigate or design a live test before proceeding.

---

## Confirmed user decisions (do not re-litigate)

1. Hybrid chevron style: Linear-minimal (small `‹`/`›`, ghost button, hover bg tint, disabled at 0.3 opacity, tooltip on hover).
2. Chevrons live in each module's top header strip; rails (index.html:7031-7070) deleted.
3. Each module's header gets the same look: Bricolage Grotesque title (size 20), subtitle (size 12, text-3), controls row, border-bottom. WO module gets this style for the first time.
4. WO module header extras (my pick, approved): view tab pills (Active/Sent/Invoiced/Paid/Trash) + minimal count chips. Removes need to round-trip through sidebar for tab switch.
5. Module launcher reorganized into two titled rows:
   - **Order Management**: Work Orders, Itinerary, Maps
   - **Accounting**: Invoices, Service Items
6. Landing page becomes the **Overview module** (id `overview`). Fullscreen (no sidebar), reachable only via a taller home-chevron on every module header (NOT in MODULE_ORDER cycle). Untitled in launcher (not shown there).
7. Google Maps integration: **Tier 2 = Maps Embed API**. Free with no usage limits and no charges accrue, but Google requires a billing account on the Cloud project to enable any Maps Platform API (card required at signup as fraud prevention). Mitigation: lock the key to "Maps Embed API" only in the Cloud Console so a leaked key cannot call billed APIs (Places, Directions JS SDK, etc.). Embedded via iframe. Module is "Maps", sits in Order Management row after Itinerary.
8. Attention view: drop the "Proceed to work orders" button (it was the implicit landing-screen action). All other attention behavior stays.
9. Sidebar: keep on all modules EXCEPT Overview. Non-WO modules currently re-use the WO sidebar; carry-over rule = move the only useful element (Active Inbox indicator/return-to-WO) into the non-WO module's header. Sidebar content per module deferred to a separate slice (out of scope here — keep showing existing sidebar for now, but flag it).
10. Chevron behavior: hard-stop at both ends of MODULE_ORDER. No wrap-around. Overview not in MODULE_ORDER (home-chevron only).
11. Claude Code's "what's new" banner: disable via Claude Code config (separate from app — instructions section near end).

---

## Verified investigation

### A) Current module nav (to be replaced)

`index.html`
- `MODULES` array (line 5110): `work-orders, itinerary, service-items, invoices` — used by ModuleLauncher.
- `MODULE_ORDER` array (line 6354): `work-orders, itinerary, invoices, service-items` — used by goPrev/goNextModule.
- Mismatch is the root of the launcher-order bug user reported.
- `goPrevModule` / `goNextModule` (lines 6378-6385) use MODULE_ORDER.
- Side rails (lines 7031-7070): `position:fixed`, full-height, left=220 and right=0, 64px tall buttons. Wrapped in `{!showLanding && !launcherOpen && ...}`.
- `currentModule` state (line 5845), default `'work-orders'`.
- `showLanding` flag (search later) drives FullScreenLanding overlay.

### B) Module headers (style template)

Itinerary header — `index.html:5486-5513`:
```
flexShrink:0, padding:'14px 18px 10px', borderBottom:'1px solid var(--border-1)'
  Bricolage title (font 20, weight 700, -0.02em)
  subtitle row (font 12, text-3, marginTop 2)
  controls row (display:flex, gap 10, alignItems center, marginTop 10)
```
Invoices header — `index.html:5223-5244` — identical style.
ServiceLibrary header — to verify (out of scope below if not same).

WO module = ListPane (index.html:1910+). Currently has search/filters/sort row but NO Bricolage title strip. Will gain one.

### C) FullScreenLanding (current)

`index.html:4186-4305`. Modal overlay, `position:fixed inset:0 zIndex:250`. Renders:
- GambleMark logo, "Trade Tracker", "by Gamble..." tagline
- "Welcome back" + date
- "Needs your attention" + first 6 alerts via FSAlertCard
- "Proceed to work orders" button at bottom

Driven by `showLanding` state. To rework as Overview module: extract the inner content (logo + welcome + alerts + new metrics) into an `OverviewModule` component rendered fullscreen.

### D) Attention view

`computeAlerts` (line 839), `alerts` (line 6075). Attention surface in sidebar (counts[attention] line 6241). The in-pane Landing component at line 3053 may be related — to verify in implementation.

### E) ModuleLauncher

`index.html:5116-5150`. Renders `MODULES.map(...)` as a flex-wrap row. Needs grouping by category.

---

## Design — chevrons

```
[sidebar 220px] | [home «]  [‹ prev]   [Module Title]                  [next ›]
                |           subtitle…
                |           controls row…
```

- Home chevron: glyph `«` (double-left chevron), height 28px (taller than prev/next which are 22px), ghost button, no border, hover bg `var(--bg-row-sel)`, color `var(--text-2)`. Tooltip "Home" / "Overview". Sits leftmost in header, after sidebar.
- Prev/Next chevrons: glyph `‹` / `›`, height 22px, same ghost-button treatment. Tooltip shows destination module title.
- Disabled state: opacity 0.3, cursor default, no hover effect.
- All three rendered by a shared `<ModuleNavChevrons module currentModule .../>` component placed at the top of each module's header strip.

Keyboard: keep existing key handlers (search later in code); arrows are click-only for now. (Defer Cmd+[/] to a separate slice.)

---

## Design — WO module header (replaces ListPane's headerless top)

New strip at top of ListPane:
```
[home «] [‹]  Work Orders                              [›]
              Triage and bill jobs
              [Active] [Sent] [Invoiced] [Paid] [Trash]   (view tab pills)
              [search input]   [PM ▾] [Type ▾] [Status ▾] [Tech ▾]
              Active (47) · 5 emergency · 2 stale         Sort: [...] [↑]
```

- View tab pills: 5 pills in a horizontal group. Selected = filled background `var(--accent)`, color `var(--accent-fg)`. Others = ghost `var(--bg-surface)` border `var(--border-1)`. Clicking calls existing `selectView(viewId)`.
- The "current view" pill replaces the sidebar's view-selection click for the WO module. Sidebar view list stays (it still hosts inboxes/presets/attention/settings).
- Count chips: small inline text `text-2`, no border, separated by `·`. Recompute from current `visibleCount` + alert breakdown.
- The full ListPane header area becomes scroll-shrink-safe via the existing `flexShrink:0` pattern.

---

## Design — Overview module (replaces FullScreenLanding)

- New `OverviewModule` component, rendered as **fullscreen** (no sidebar, no chevrons).
- `MODULE_ORDER` does NOT include `overview`. `MODULES` does NOT include `overview` (not in launcher).
- App boots into Overview by default (replaces `showLanding`). Default `currentModule = 'overview'`.
- Reachable any time via the home `«` chevron on any non-overview module header.
- Inside Overview, an "Exit to Modules" affordance: home `«` chevron NOT shown (already there). Instead a `→ Continue` button center-bottom (same Bricolage style as current Proceed button) navigates to last-used module (persist `lastModule` in settings; default `work-orders`).

### Overview content (full screen)

Two-column layout to mimic the sidebar-flanked feel:
```
[ left panel 280px:                  ][ main:
  GambleMark + Trade Tracker title    welcome line + date
  Counts strip:                        ───────────────
    Active 47                          [throughput chart card]
    Sent 5                             [tech utilization card]
    Invoiced 12                        [recent activity card?]
    Paid 88
  Quick-jump links to each module    ]
                                     ]
                                     center-bottom: [→ Continue]
```

### Metrics (in-scope, confirmed)

1. **WO Counts** (minimal): horizontal mini-stat list in left column. Tab counts only (active/sent/invoiced/paid). No bid total ($ pipeline deferred).
2. **Throughput chart**: 8-week weekly bars showing created vs invoiced vs paid per week. Computed from `orders` `dateCreated` + `invoice.dates` + `tab` transitions. SVG bar chart, no library (match existing inline-SVG style).
3. **Tech utilization**: this week's scheduled job count per tech, from `orders` with current-week `schedule.date`. Horizontal bar per tech, color from existing tech color map if present.
4. **Alerts**: condensed list (top 6 by severity), each clickable → navigates to `attention` view in WO module. NO "Proceed to WOs" bottom button on the attention view itself (the Continue button on Overview is the unified entry).

### Throughput data feasibility check

- `dateCreated` exists per WO.
- `tab` is current state; transitions are tracked by `history` entries (e.g. 'sent to invoice', 'marked invoiced', 'marked paid'). Will compute weekly counts from history entries' timestamps when present; fall back to `dateCreated` for "created" series.
- Risk: history-entry format/strings may vary across older WOs. Mitigation: defensive parsing — match on string includes (`invoice`, `paid`), tolerate missing entries. Live test: render against current real data, eyeball the chart against known recent activity.

---

## Design — ModuleLauncher rework

```
                       Modules
                       ───────

           Order Management
   ┌──────────────┬──────────────┬──────────────┐
   │ Work Orders  │ Itinerary    │ Maps         │
   └──────────────┴──────────────┴──────────────┘

           Accounting
   ┌──────────────┬──────────────┐
   │ Invoices     │ Service Items│
   └──────────────┴──────────────┘
```

- Convert `MODULES` to an array of category groups: `[{ category, items: [...] }]`.
- `MODULE_ORDER` derived as `flat(items.map(i=>i.id))` — single source of truth, fixes the launcher-order bug.
- Each category gets a section title row (Bricolage, font 16, text-3, marginBottom 12). Cards within a category stay current card style.

---

## Design — Google Maps module (Tier 2)

- New `MapsModule` component.
- Module header same style: title "Maps", subtitle "Route to a work order".
- Body: simple list of active WOs on the left (~280px), each clickable → updates an iframe on the right with `https://www.google.com/maps/embed/v1/place?key=API_KEY&q=ENCODED_ADDR`.
- API key handling: stored in settings (Settings → API Keys section, new row "Google Maps Embed API key"). If unset, body shows a one-time setup message with a link to Google's "Get a Maps Embed API key" doc. NEVER hardcode the key. NEVER commit it.
- No backend, no JS SDK, no billing — Embed API is unlimited free with just an API key.
- Defer route-stop chaining / Directions Embed mode to a later slice (Itinerary integration). Place mode is enough for v1.
- Sidebar visible on Maps module like other modules.

### Risk: API key UX

Module is useless until the user pastes a key. Mitigation: on first load, show clear "Add your API key in Settings → API Keys" message with a one-click navigate. Live test: launch with empty key, confirm message + navigate; paste a real key, confirm embed renders.

---

## Design — Sidebar adaptation

In-scope here:
- Sidebar HIDDEN on Overview (full-screen).
- Sidebar VISIBLE on all other modules, content unchanged from today.

Out-of-scope (separate future slice, just note):
- Non-WO modules should eventually get module-specific sidebar content. Currently only the Active-Inbox indicator is useful outside WO. Move it to non-WO module headers in a later slice; today, keep sidebar identical.

---

## Implementation order (commit per slice)

1. **Launcher order fix**: collapse `MODULES` + `MODULE_ORDER` to a single grouped source. Two rows (Order Management / Accounting). No category title styling yet. Verify launcher renders WO → Itin → Maps placeholder/none → Invoice → Service. (Maps shows in launcher but module not built — disable card with "Coming soon" or short-circuit to a placeholder MapsModule that just renders the header.)
2. **Chevron migration**: delete rails block (index.html:7031-7070). Build `<ModuleNavChevrons>` component. Insert into each existing module header (Itinerary, Invoices, ServiceLibrary). Verify prev/next work, disabled states correct.
3. **WO module header**: add Bricolage title strip + view pills + count chips inside ListPane top. Move search/filters/sort into the new strip's controls area. Insert `<ModuleNavChevrons>` at top of the strip.
4. **Home chevron**: add `«` to `<ModuleNavChevrons>`. Wire to `setCurrentModule('overview')`.
5. **Overview module**: scaffold `OverviewModule` component. Render fullscreen branch in App when `currentModule === 'overview'` (no sidebar grid column). Move FullScreenLanding's logo + alerts content into OverviewModule. Add Counts + Throughput + Tech Utilization sections. Add `[→ Continue]` button → `setCurrentModule(lastModule || 'work-orders')`. Default `currentModule = 'overview'`. Delete `showLanding` state + FullScreenLanding component + Landing overlay.
6. **Attention view button removal**: locate the in-pane Landing (line 3053) or attention view's Proceed button; remove it.
7. **Maps module**: build `MapsModule` (Embed API). Add API-key Settings row. Replace launcher placeholder.

Commit after each slice. Do NOT push. Do NOT publish.

---

## Out of scope

- $ pipeline metric (awaiting reliable scraper/bid data).
- Cmd+[/] keyboard shortcuts for module nav.
- Non-WO module-specific sidebars.
- Directions/route-chain mode on Maps module.
- Itinerary↔Maps integration.

---

## Slices 3.1–3.5 (added 2026-06-01) — density pass + sidebar slim

User feedback after slice 3: too much white space across DetailPane header + WO header; sidebar largely redundant once view pills moved to header. Decision: do all five in order.

### 3.1 DetailPane header compression
- Combine WO# (28→18), status pill, ageDays, flags into ONE row.
- Address shrink 22→16, inline with WO# row when it fits; wrap otherwise.
- 9-field grid: 4 cols → 5 cols, font 13→12, rowGap 10→6, columnGap 18→14.
- Outer padding 20/28/18 → 12/20/10.
- Goal: recover ~70-90px for notes.

### 3.2 Collapsible activity log in DetailPane
- Wrap the activity log section in a collapsible. Default closed.
- Collapsed bar: 28px with `▸ Activity log (N)` clickable.
- Expanded: 140px max, scrollable in place.
- Pinned at the BOTTOM of DetailPane (flexShrink:0). Notes section above expands when collapsed.
- Goal: recover ~80px for notes when collapsed.

### 3.3 WO header density
- Collapse to ONE row: chevron-left, "Work Orders", view pills, inline search box, chevron-right.
- Drop subtitle text line.
- Drop dedicated search row.
- Filter chips + count/sort stay in ListPane top (unchanged).
- Goal: header height matches other modules' average but slimmer overall.

### 3.4 Slim sidebar (Path A)
- Sidebar shown ONLY on Work Orders module. Hidden on Itinerary / Maps / Invoices / Service Items.
- WO sidebar content cut to:
  - Tiny GambleMark + "Trade Tracker" brand (top-left)
  - "Saved views" list (presets)
  - "Inboxes" list
  - Flex-grow spacer
  - (Settings / Modules / Add WO / Tools / view list / attention — ALL removed, see 3.5)
- Sidebar width may shrink 220→200px if comfortable; verify by eye.
- Grid template adjusts conditionally: `'220px 1fr 1.2fr'` (WO) vs `'1fr 1.2fr'` or `'1fr'` (non-WO, full-bleed). Simpler: always render the grid column but render `null` for non-WO Sidebar, leaving the column empty — visually clean if column collapses; otherwise force 0 width via condition.

### 3.5 Header chip cluster
- Top-right of every module header (right of chevron-right):
  - `+ Add WO` button (icon+text) — opens Add WO modal. Always visible.
  - `★ Attention (N)` chip when alerts > 0 — clicks to attention view in WO module. Hidden when zero.
  - `⊞` kebab/menu for: Tools (Export CSV, New inbox), Modules launcher, Settings. Or split:
    - `⊞ Modules` button → launcher (already covered by chevron, but explicit click affordance kept)
    - `⚙` gear → settings view
    - `⋯` kebab → Tools menu (Export CSV / New inbox)
- Cluster lives at the right edge BEFORE the right chevron.

### Risks
- DetailPane density: tight grid may overflow on narrow detail pane (col 1.2fr). Live test: select a long-address WO at minimum window width.
- Activity log accordion: existing 100px in-place scroll was sometimes useful while reading notes. New default-closed may surprise users. Mitigation: persist open/closed in settings.
- Sidebar hide on non-WO: existing grid uses 3-col template; conditionally swapping templates risks layout glitches. Mitigation: keep 3-col grid always, render `null` Sidebar, set grid template `0 1fr 1.2fr` when non-WO.
- Settings/Tools move to header: users currently click sidebar gear. Mitigation: add tooltip + keep same icons.

---

## Claude Code "what's new" banner — disable instructions

This banner is from the Claude Code CLI (Anthropic's tool), not the tracker app. To disable, set in `~/.claude/settings.json`:

```json
{
  "disableNonEssentialModelCalls": true
}
```

OR for a more targeted disable, check the Claude Code release notes / settings docs for an "onboarding" / "tips" flag (need to verify exact key — will fetch from official docs before applying). User wants this off; I will not touch settings without confirming the exact key. Will run that verification as a side task before the rework slice 1.

---

## Test plan

- Slice 1 (launcher): open launcher, confirm two titled rows, correct module order.
- Slice 2 (chevrons): nav from each module to next/prev; hard-stop at ends; disabled state at ends.
- Slice 3 (WO header): switch tabs via pills; search/filter unchanged; sidebar view list still works.
- Slice 4 (home chevron): from any module, `«` returns to Overview; not present on Overview.
- Slice 5 (Overview): first launch shows Overview fullscreen; Continue button navigates to last-used module; alerts click → attention view; throughput chart renders; tech utilization renders against known itinerary entries.
- Slice 6 (attention): Proceed button gone from attention view.
- Slice 7 (Maps): with no key → setup message; with key → iframe loads place for selected WO.

---

## Risks flagged + mitigations

- **History-entry parse for throughput**: tolerate missing/varied entries; default to dateCreated for "created" series.
- **Maps API key blank**: explicit setup CTA in module body; non-fatal.
- **Default module change to Overview**: existing user sessions store `currentModule='work-orders'`; on next launch, override only if `currentModule` is unset or `overview` doesn't exist. Add a one-shot migration guard so existing users still see Overview once on first launch after upgrade.
- **Sidebar grid change for Overview**: existing layout is `gridTemplateColumns:'220px 1fr 1.2fr'`. Overview branch must render fullscreen WITHOUT this grid wrapper. Conditionally swap container at App-level.

---

## Slice 3.5 follow-up (built 2026-06-02)

User feedback after slices 1-3.5 shipped: the slice 3.5 Modules button in the
header chip cluster is too innocuous; chevrons read as small/light. Several
unrelated tracker polish items rolled into the same pass. Consolidates
change11.md (since deleted) into this handoff.

### What shipped

1. **MoreInfoCard collapsible + customizable color** (`index.html:~2881`)
   - Collapsible (closed default, session state, resets per WO switch).
   - Preview snippet shown in collapsed header; "empty" hint when blank.
   - `color` prop drives left accent strip + `color-mix(in srgb, color 14%,
     transparent)` soft bg. Save button matches.
   - New `wo_data.moreInfoColor` (default `#d97706`). Backfilled on hydration.
2. **Status sort direction fix** (`index.html:~701`)
   - `sortRows` status branch was hard descending; now `(ai - bi) * dir`,
     ascending by default. Sort menu sets `dir: 'asc'` on status pick.
   - `dirDisabled` no longer excludes status.
3. **Filter dropdown ordering** (`index.html:~1969`)
   - `optsFor(field, ordering)` ranks values by configured Workflow lists
     (statuses, types, techs, PMs). Unknown values appended alphabetically.
4. **Modules launcher button relocation** (`HeaderChips :~5292` -> `Sidebar :1609`)
   - Removed `iconBtn` from HeaderChips.
   - Sidebar accepts `onOpenLauncher`; pinned to bottom via `flex:1` spacer.
   - Visual: accent border (1.5px), `color-mix accent 12%` bg (22% on hover),
     grid icon + "Modules" label + "Launcher" hint.
   - Trade-off: non-WO modules lose direct launcher access (chevrons-only).
5. **Chevron emphasis** (`ModuleNavChevrons.ghostBtn :~5318`)
   - fontSize 18 -> 22, fontWeight 700. Padding unchanged.
6. **Settings -> Appearance redesign** (`AppearanceSection :~3403`)
   - max-width 720 centered. Bricolage 26 title + subtitle.
   - Three `AppearanceGroup` blocks (eyebrow + divider) for Theme / Layout
     density / Detail pane accents.
   - More Info color picker now shows hex chip + live preview swatch using
     the same color-mix mechanism as the real card.
   - Color picker moved from Workflow -> Appearance.

### Revisions to original slice plan

- Slice 3.5 (Header chip cluster) originally included a `⊞ Modules` button.
  That button is now removed; module launcher lives in the Sidebar.
- Sidebar (slice 3.4) now has a footer slot that pushes the Modules button
  to the bottom; spacer takes remaining vertical space.

---

## Slice 4 (planned 2026-06-02)

Tracker polish + a missing-but-needed right-click target. AMH job-type
auto-classification bug (Other vs HVAC/Plumbing) deferred to a separate
later slice - scraper/extension domain.

### 4.1 Theme + Density pills evenly sized

`Seg` component (`:3406`) renders unequal-width buttons sized to label
length. In the redesigned Appearance section the pills look ragged. Add
an opt-in `equal` prop to `Seg` that switches the container to
`display:flex; width:100%` and each button to `flex:1; textAlign:center`.
Apply `equal` only in AppearanceSection's Theme + Density Segs so other
callers (TraySection) keep current sizing.

### 4.2 Settings Close button stable position

Current Close lives at the bottom of the left nav (`:3291`) with a
`flex:1` spacer above. Switching tabs can change perceived position when
the nav and content columns are different heights or the nav column
itself overflows. Move Close to a fixed top-right slot inside the right
content column header strip - always visible, never moves with section
content.

Implementation:
- Wrap the right content column in `display:flex; flexDirection:column;
  minHeight:0`.
- Top strip: `flexShrink:0`, padding `12 20`, border-bottom, contains the
  Close button right-aligned.
- Content area: `padding 24 32`, `overflow:auto`, `flex:1`.
- Remove the spacer + Close button from the left nav.

### 4.3 Itinerary sticky tech selection

`ItineraryModule` (`:5683`) holds `tech` as local state, defaulting to
`'ALL'` each mount. Navigating away and back resets - user loses their
filter.

Behavior:
- Default `'ALL'` on app startup (page load) - unchanged.
- After user picks a tech, persist that choice across module navigation
  inside the session.
- When a focus jump arrives with `focus.tech` (from the WO context menu
  "Jump to schedule" / "Add to schedule"), override to that tech (already
  works via the existing focus handler).
- Page reload resets to `'ALL'` - matches the "default on startup" rule.

Implementation: lift `tech` state to App; pass `itinTech` + `setItinTech`
into ItineraryModule. Do NOT persist to `wo_data` (startup reset is
intentional).

### 4.4 DetailPane right-click menu + reorganization

Today the WO context menu only opens from the ListPane. Editing a WO
requires hunting it down in the list - friction. Add right-click handler
to DetailPane targeting the currently-open WO. While in there, reorganize
the menu and add missing actions.

#### Menu reorg (applies to both ListPane and DetailPane invocations)

Order top-to-bottom:

```
Edit details
Invoice ▸          (only on tabs that have invoice context)
View details        (ListPane only - DetailPane already shows it)
────────────────
Set status ▸
Set PM ▸
Set type ▸
Set tech ▸
────────────────
Add to schedule  /  Reschedule  /  Jump to schedule
Add to inbox ▸
────────────────
Mark ▸
  Warranty  (blue flag icon)
  Emergency (red flag icon)
────────────────
Send to Trash        (existing position - bottom)
```

#### Hover-to-open submenus, leaflet-style

- Replace click-to-open submenu pattern (current `setCtxSub('status')`
  click handler) with hover-to-open: 150ms delay before expanding,
  cancel on pointer leave to a non-submenu region, close on outer click
  / Esc / main menu dismiss.
- Submenu opens to the right of its parent row at the row's vertical
  midpoint. If insufficient space on the right, flip to the left.
- Active submenu parent gets selected styling (`bg-row-sel`).
- Single submenu open at a time; hovering a different parent closes the
  previous.

#### Mark submenu (replaces inline toggle items)

Current `Mark emergency` / `Mark warranty` items become a single `Mark ▸`
submenu with two child items:
- `Warranty` - flag icon in `var(--flag-warranty)` (blue).
- `Emergency` - flag icon in `var(--flag-emergency)` (red).

If WO already has a flag, the corresponding child reads `Clear warranty`
/ `Clear emergency`. Submenu otherwise behaves as the existing toggle
handlers.

#### New items: Edit details, Invoice

- `Edit details` - existing `onEdit(woId)` already wired in DetailPane.
  Add to context menu; calls the same handler.
- `Invoice` - submenu (or single item depending on tab):
  - On `active` tab: `Send to Invoice` (calls existing `sendToInvoice`).
  - On `sent` tab: `Mark Invoiced` (calls `markInvoiced`).
  - On `invoiced` tab: `Mark Paid` (calls `markPaid`).
  - On `paid` / `trash`: omit Invoice entirely.

#### DetailPane integration

- Wrap DetailPane outer `<section>` with `onContextMenu` handler:
  preventDefault, capture event coords, open `ctxMenu` keyed to
  `data.wo`.
- Extract menu rendering into a reusable `<WOContextMenu>` component
  taking woId, x, y, tab, and all the handlers. Render from both
  ListPane and DetailPane (single source of menu structure).
- DetailPane variant defaults `ctxBulk = false` (no bulk select in
  detail) and skips `View details` (already shown).
- Skip context-menu open when the right-click target is a textarea or
  input (don't break native textarea menus inside notes/composer).

### Risks + mitigations

- **Submenu positioning at edge**: a leaflet-style submenu can clip
  outside the window. Mitigation: measure available space on hover
  trigger, flip side if needed (mirror existing menu-anchoring code
  in ListPane status menu).
- **Hover delay UX**: 150ms is the standard desktop pattern; faster
  feels jittery, slower feels laggy. Cancel timer on pointer leave to
  avoid stale opens.
- **Itinerary sticky tech vs focus jump race**: lift state to App, but
  focus jump in ItineraryModule already overrides via `setTech(focus.tech)`.
  Confirm focus handler still wins after lifting (it should - it calls
  the same setter, just App-owned now).
- **Right-click swallowing native menus**: only intercept on
  non-input/textarea targets, so notes editing keeps native menu.
- **Reorganized menu = changed muscle memory**: brief user verification
  required.

### Out of scope

- AMH job-type misclassification (HVAC/Plumbing -> Other). Likely
  scraper/extension domain; separate slice.
- Keyboard shortcuts for context menu.
- Per-section deep-link in Settings (URL/hash).

---

## Slice 4.5 (built 2026-06-02) - Modules button in non-WO module headers

Follow-up to slice 3.5 follow-up. After moving the Modules launcher button
from HeaderChips into the WO Sidebar (slice 3.5 follow-up #4), non-WO
modules lost direct launcher access since the sidebar is hidden on
Itinerary / Maps / Invoices / Service Items (per slice 3.4 Path A). User
must round-trip via chevron prev/next or home chevron + Overview, which
defeats the launcher's purpose.

### Fix

HeaderChips reads `currentModule` from `ModuleNavContext`. When
`currentModule !== 'work-orders'`, render an accent-bordered Modules
button at the FAR LEFT of the chip cluster (before `+ Add WO`). Same
position on every non-WO module header so the affordance is in a
predictable place.

Style: accent border 1.5px + `color-mix(in srgb, var(--accent) 12%,
transparent)` background (22% on hover), grid glyph + "Modules" label,
height 28 matching other chips. Smaller than the sidebar version but
visually louder than the gear/kebab icons so it does not read as
"innocuous" again.

### Ramifications traced

- WO module: button hidden in header (sidebar version still shown).
- Non-WO modules: button visible at leftmost slot of HeaderChips.
- `onOpenLauncher` already on `HeaderActionsContext` from App; no new
  prop drilling.
- HeaderChips rendered by every module header strip (Itinerary, Invoices,
  Maps placeholder, Service Library, WO header). All consume the same
  conditional render.

### Out of scope (still)

- Restoring sidebar to non-WO modules (Path A in slice 3.4 remains).
- Module-specific sidebars on non-WO modules.

---

## Slices 4 + 5 (built 2026-06-02) - Home chevron + Overview module

Bundled because chevron destination (Overview) was not yet built.

### Home chevron (orig slice 4)

- `ModuleNavChevrons` extended with `side="home"` rendering `«` at fontSize
  26 / padding `2 10` so it reads as the tallest control in the strip.
  `ghostBtn(false, true)` toggle keeps prev/next at 22.
- `ModuleNavContext` extended with `onHome: () => setCurrentModule('overview')`.
- Inserted before the left chevron in every module header: WO header
  (`:2192`), Invoices (`:5237`), Service Library (`:5754`), Maps placeholder
  (`:5892`), Itinerary (`:6165`).

### Overview module (orig slice 5)

- New `OverviewModule` component replaces the FullScreenLanding overlay.
- Layout: 280px left aside (GambleMark + Trade Tracker title + WO counts +
  quick-jump list) on `gridRow 1/3`; main content on `gridRow 1/2`
  (welcome + 8-week throughput SVG + tech utilization horizontal bars +
  top-6 alerts via existing `FSAlertCard`); Continue button on the main
  column, bottom row.
- Helpers: `overviewWeekBuckets`, `overviewThroughput`, `overviewTechUtilization`,
  `overviewTabCounts`. Defensive history-action parsing (`includes('invoice')`,
  `includes('paid')`) per the original risk note.
- App: default `currentModule = 'overview'`. Persist `settings.lastModule`
  on every transition to a non-overview module (effect watches
  `currentModule`). Continue button -> `setCurrentModule(lastModule ||
  'work-orders')`. Alert click -> WO module active view + selected WO.
- Removed: `showLanding` state, `dismissLanding` callback, sessionStorage
  `tt-seen-launch` flag, FullScreenLanding component, its render block.
- Kept: `FSAlertCard` (reused by Overview).
- Render branch: when `currentModule === 'overview'`, render OverviewModule
  inside a `themeVars` wrapper, skip the grid container (no sidebar). When
  not overview, render existing 3-column grid.

### Ramifications traced

- Overview not in MODULE_ORDER -> chevrons hide it from prev/next cycle. ✓
- Overview not in MODULES -> launcher does not list it. Home chevron is
  the only reach. ✓
- lastModule effect skips writes when value unchanged (no thrash). ✓
- First launch: settings.lastModule undefined -> Continue defaults to
  Work Orders. ✓
- Overview reload: tech util / counts / throughput recompute via useMemo
  on orders / techs change.
- Existing modals (Add WO, Edit WO, Schedule, Bid prompt, Launcher,
  Invoice editor) rendered as siblings outside the module branch so they
  remain accessible from overview if triggered externally. None are
  currently triggered from overview.
- Sidebar Modules button still works on WO module. Header Modules button
  still works on non-WO modules. Both unchanged by this slice.

### Bugfix during Overview QA - alert click does not scroll list

User reported: clicking an Overview alert opens the WO detail pane but
the list pane does not scroll the WO row into view, so the user cannot
see the row context.

Root cause: ListPane had no scroll-to-selected mechanism (Itinerary and
Invoices modules did, ListPane did not).

Fix:
- `ListRow` root gains `data-wo-id={row.wo}`.
- ListPane adds an effect on `selectedWO` that queries
  `[data-wo-id]` inside `scrollRef.current` and calls `scrollIntoView({
  block: 'center', behavior: 'smooth' })` on match.

Ramifications traced:
- Selected WO not in current filter/sort/view: query returns null, no
  scroll. Acceptable.
- Initial click on a list row: re-fires effect, scrollIntoView is a
  no-op when row already centered.
- Uses `CSS.escape` for safe attribute selector.

---

## Slice 6 (built 2026-06-02) - Attention view: remove Proceed button

Per the original handoff: in-pane `Landing` component at `:3426` had a
footer bar with "Proceed to work orders" button. Removed since Overview
Continue is now the unified entry.

- Removed the footer `<div>` block from `Landing`.
- Removed `onProceed` prop from `Landing` signature.
- Removed `onProceed` from App's Landing render site (`:7678`).

Ramifications:
- No other consumer of `onProceed`. Verified via grep.
- `onSelectWO` still navigates clicks; sidebar tab pills still switch
  views. No regressions to alert click behavior.

---

## Slice 7 (built 2026-06-02) - Maps module (Google Embed API)

Implements the spec's Tier 2 design: Google Maps Embed API, no backend,
no JS SDK, free tier, API key only.

### Changes

- `MapsModulePlaceholder` deleted. New `MapsModule` component renders:
  - Header (Maps title + "Route to a work order" subtitle + chevrons +
    HeaderChips, matching other module headers).
  - When `mapsApiKey` is empty: full-pane setup card with Google docs link
    and a button that navigates to Settings -> API Keys.
  - When set: 280px left list of active WOs (search input + sortable id),
    right iframe loading
    `https://www.google.com/maps/embed/v1/place?key=...&q=...` for the
    selected WO's address.
- Settings: new `apikeys` section in `TT_SECTIONS`. New `ApiKeysSection`
  with a password-mode input for the Google Maps Embed API key (Show /
  Save / Clear). Hint text links to Google's "Get an API key" doc.
- App: `settings.mapsApiKey` read + `setMapsApiKey` setter via
  `updateSettings`. `pendingSettingsSection` state + `initialSection`
  prop on SettingsDrawer so the Maps "Open Settings" button lands on the
  API Keys section directly. Cleared on settings close.

### Security / key handling

- Stored only in the local wo_data file. Never sent anywhere except
  Google (via the iframe URL).
- Embed-API keys are designed for client-side use; restrictions
  (HTTP referrer / IP allowlist) belong in the Google Cloud Console.
  Hint text in both the setup card and the Settings row links to the
  Google docs so the user can lock the key down.
- No hardcoded key in source. No commit of the key (lives only in user
  data file outside the repo).

### Ramifications traced

- iframe loaded without sandbox attr because Embed API needs scripting;
  `referrerPolicy="no-referrer-when-downgrade"` matches Google's
  recommended setting for Embed API.
- No CSP meta tag in index.html; iframe is not blocked by app policy.
- `activeOrders` (already memoized in App for ItineraryModule) reused
  as the source list.
- Maps already in `MODULE_GROUPS` / `MODULE_ORDER` / launcher, so home
  chevron + module nav chevrons + launcher card all reach Maps
  unchanged.
- `pendingSettingsSection` clears on close so reopening Settings via the
  gear icon defaults to Appearance, not the section the user was last
  steered to.
- `splitAddress` already used by ItineraryModule / DetailPane; reused.

### Out of scope (per original handoff)

- Directions Embed mode / route-stop chaining.
- Itinerary <-> Maps integration.

### Pivot: Leaflet + OpenStreetMap (no Google, no key, no billing)

User hit Google Cloud's mandatory prepayment requirement during signup.
Rather than fund Google, swapped the Maps module's iframe + Google Embed
API path for Leaflet.js + OpenStreetMap tiles + Nominatim geocoding -
all free, no signup, no billing, no card.

### Changes

- `<head>` adds Leaflet 1.9.4 CDN (CSS + JS from unpkg, SRI-pinned).
- `MapsModule` rewritten to render via Leaflet:
  - Container div sized `position: absolute; inset: 0` inside a
    relatively-positioned right pane.
  - `L.map(...).setView([39.8283, -98.5795], 4)` initial US-center view.
  - `L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: '...OpenStreetMap contributors', maxZoom: 19 })`.
  - Selection triggers Nominatim geocode
    (`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=...`).
    Results cached per WO id in component state to avoid re-fetching.
    1 req/sec Nominatim usage policy easily respected by single-user
    click cadence.
- Removed: empty-key setup card, "Open Settings" button, `mapsApiKey`
  and `setMapsApiKey` plumbing from App + SettingsDrawer.
- `ApiKeysSection` reduced to an informational note: "No keys required
  for current integrations. Maps uses Leaflet + OpenStreetMap +
  Nominatim, all free, no key required." Section retained for future
  credentialed integrations.

### Ramifications traced

- No CSP meta tag -> CDN loads from unpkg + tile loads from OSM both
  succeed from a file:// page. Verified empirically on session start
  (Leaflet present at window.L).
- Nominatim sends `Access-Control-Allow-Origin: *`, so fetch from
  file:// origin works.
- Stale `settings.mapsApiKey` left in user data files is inert (no
  reader); no migration needed.
- `pendingSettingsSection` state retained on App for future routes to
  Settings sub-sections.
- Leaflet map unmounts on module switch (useEffect cleanup calls
  `m.remove()`). Geocache state resets on remount; re-fetch happens
  on next selection. Nominatim handles single-call cadence fine.
- Existing `openMaps()` (used by DetailPane address-link clicks) still
  opens Google Maps in the default browser for routing - unchanged.

### All-markers + persistent geocache (built 2026-06-02)

User asked to see every WO on the map at once. Accuracy not critical -
techs route on their phones; map is for at-a-glance distribution.

#### Changes

- App: new `setGeocacheEntry(id, value)` helper. Reads/writes the latest
  `dataRef.current` synchronously so back-to-back queue writes never lose
  entries to a stale closure. Persists to `settings.geocache` so cold app
  starts are instant on subsequent sessions.
- MapsModule props now include `geocache` + `setGeocacheEntry`. Local
  per-mount state for geocache removed.
- New render path:
  - Single marker layer (`L.layerGroup`) plotted with EVERY WO in the
    current filtered list that has a cached `{lat, lon}`.
  - Effect re-renders markers on `list / geocache / selected` change.
  - Auto-fits bounds when nothing selected (padding 40, maxZoom 14).
  - Selected WO opens its popup + centers + zooms to 16.
  - Marker click selects the WO (mirrors sidebar list click).
- New queue worker:
  - Async loop runs while there are uncached items in the list.
  - 1100ms spacing respects Nominatim's 1 req/sec policy.
  - Reads cache via ref (cacheRef) so writes do not restart the loop.
  - Cancellation flag stops in-flight work when effect re-runs or the
    component unmounts.
  - Stores `{lat, lon}` on success, `{error: true}` on failure (no
    retry, no re-queue).
- New overlay:
  - Progress bar at top of map area while geocoding: "Geocoding
    addresses... 12/47" with a thin accent fill.
  - "No addresses could be located." badge when list non-empty but
    every WO failed geocoding.

#### Ramifications traced

- `[list, setGeocacheEntry]` is the queue effect's dep array; geocache
  excluded -> writes do not restart the loop. cacheRef gives latest
  values inside the loop.
- Marker render effect deps `[list, geocache, selected]`. Clears layer +
  redraws each time. O(N) per render; trivial for ~50 WOs.
- Selected effect runs separately; if marker not yet placed (effect
  ordering race), setView is skipped and the next render catches it.
- Disk write per geocode (50 WOs = 50 writes spaced 1.1s apart). Each
  write is async + small. Acceptable for now; debounce candidate.
- Stale geocache for deleted WOs accumulates in settings. Not cleaned.
  Minor.
- Error markers cached and skipped on subsequent passes - no retry. UI
  shows "No addresses could be located" if every WO in the current view
  failed. Re-geocode option deferred.
- Concurrent list updates (search typing) cancel + restart the loop
  cleanly via the cancelled flag; cache is shared.

#### Configurable default map view (built 2026-06-02)

User asked for Maps to open zoomed to their service area instead of the
US-wide fallback, while keeping the source repo location-neutral so
other operators forking the project see a blank default.

- `DEFAULT_MAPS_VIEW = null` constant in source. Source carries no
  operator-specific coordinates.
- `settings.mapsDefaultView = { lat, lon, zoom } | null` persists per
  user. Falls back to US center / zoom 4 when null.
- New `MapsSection` in Settings under a new `maps` TT_SECTIONS entry.
  Three text inputs (lat / lon / zoom 1-19), validated, Save + Clear.
- MapsModule init effect reads `defaultView` prop and centers
  accordingly on mount. After init, user pans/zooms freely; subsequent
  defaultView prop changes do NOT re-center (would fight active pan).
- New "Set view as default" button in MapsModule header. Captures
  `map.getCenter()` + `map.getZoom()`, truncates to 5 decimal places,
  writes to `settings.mapsDefaultView`. One-click round trip.

Ramifications traced:
- Init-effect deps empty (`[]`), so defaultView is read on mount only.
  Saving a new default while the map is open does not jump the view.
  Confirmed acceptable - user explicitly clicks "Set view as default"
  after positioning the map.
- Empty wo_data or fresh fork: null -> US fallback. No operator data
  leak in source.

#### Submenu bottom clamp (built 2026-06-02)

User reported the right-click submenu (e.g. Set status with many entries)
could clip the viewport bottom when the parent row was near the bottom of
the main menu.

Root cause: submenu position was computed before render at parent row's
top - 4, with no height measurement. Long submenu lists overflowed.

Fix:
- `subPos` now React state. Initial position is the same best-effort
  calculation (horizontal flip, vertical anchor at parent row top).
- New `subMenuRef` + `useLayoutEffect` measures the actual submenu
  height after first render. If `top + height > innerHeight - pad`,
  shifts top up so the bottom edge fits. Same x-axis clamp.
- `visibility: hidden` until the layout pass marks `ready: true`. No
  flicker.
- `maxHeight: calc(100vh - 16px)` caps overall height so even a
  submenu taller than the viewport scrolls instead of clipping.

Ramifications traced:
- Same pattern as the main-menu clamp from the earlier fix. Consistent
  behavior across both layers.
- Re-runs cleanly when activeSub changes (different submenu opens):
  `initialSubPos` recomputes -> state resets -> layout effect re-clamps.

#### Itinerary right-click menu + Jump to Map (built 2026-06-02)

User asked for the same context menu on Itinerary cards and a way to
jump from any WO to its map marker. Also reported the geocoding
progress bar stayed at 0/N forever.

**Geocoding root cause:** `setGeocacheEntry` in App referenced `setData`,
which lives inside the `useWorkOrders` hook, not App scope. Each call
threw a `ReferenceError` that was silently swallowed by the worker's
try/catch, so the cache never persisted and progress never advanced.

Fix:
- Extended `updateSettings(patchOrFn)` to accept a function patch.
  The function receives the latest `settings` (read via `dataRef.current`
  inside the hook) and returns the patch object. Synchronous reads
  inside the hook make back-to-back writes in the same tick safe.
- `setGeocacheEntry(id, value)` now calls
  `updateSettings(cur => ({ geocache: { ...(cur.geocache||{}), [id]: value } }))`.
  No more reference to undefined `setData`.

**Itinerary right-click:**
- `ItineraryModule` accepts `statuses`, `types`, `pms`, `inboxes`,
  `onWoAction`, `onAddToInbox`, `onAddToNewInbox`, `onRemoveFromInbox`.
- Local `ctxMenu` state + listener setup (Esc / click-outside /
  capture-phase contextmenu) mirroring ListPane + DetailPane.
- `woCard` root gains `onContextMenu={(e) => openCardCtx(e, o)}`.
- `<WOContextMenu source="itinerary">` rendered at the bottom of the
  module. `onSelectWO={onOpenWO}` routes "View details" to the WO
  module.

**Jump to Map:**
- App: `[mapsSelected, setMapsSelected]` lifted from MapsModule to App
  so external callers can pre-select.
- App `woAction` gains `case 'jumpToMap'` -> `setMapsSelected(id) +
  setCurrentModule('maps')`.
- `WOContextMenu` adds a "Jump to Map" `MenuItem` rendered when not
  bulk and `source !== 'maps'`.
- MapsModule replaces its local `selected` state with the props from
  App.
- Selected-popup effect now depends on `geocache` too, so the marker
  popup opens automatically once the WO is geocoded - covers the case
  where Jump to Map fires before the address has been resolved.

Ramifications traced:
- ItineraryModule context-menu listener uses the same capture-phase
  `contextmenu` close pattern as ListPane / DetailPane, so multiple
  panes still cannot stack menus.
- woAction deps unchanged; React setters from useState are stable
  references.
- MapsModule's marker-render effect already keyed on `geocache` so new
  cache entries trigger marker draw; the selected-popup effect now
  also re-runs on cache update, opening the popup once available.
- No regression to existing Itinerary drag/drop, hover popup, or
  schedule popup. `onContextMenu` is a separate native handler from
  `onDragStart` / `onClick`.

#### Geocoder lifted to App + post-import inspect modal (built 2026-06-02)

User asked:
- Geocoder to run at app startup and after every import (not only when
  the Maps module is open).
- A modal listing newly-imported WOs so the user can spot scraper
  errors and flag emergency/warranty before they vanish into the
  active list.

**Geocoder lift:**
- Moved the queue worker from `MapsModule` to `App` (`useEffect` keyed
  on `[activeOrders, loading, setGeocacheEntry]`). Runs from startup
  whenever there are uncached active WOs.
- Progress state (`geocodeProgress`) lifted to App too. Maps module
  reads it via `progress` prop and still renders the same progress
  bar.
- `cacheRef` (geocache snapshot for the worker) moved to App.
- MapsModule no longer needs `setGeocacheEntry` (read-only cache from
  App now). Worker still uses the same 1.1s spacing.
- Effect re-runs on real import (new `orders` array reference), so a
  fresh batch starts geocoding immediately.

**Import inspect modal:**
- `upsertOrders` now returns `{ imported, dupSkipped, batch }` where
  `batch = [{ id, isNew }]` captures every WO created or updated by
  this call.
- App stores `importInspect = { batch, ts, dupSkipped }` when the
  extension bridge import returns a non-empty batch.
- New `ImportInspectModal` component renders a table: WO# / address /
  PM / type / tech / flag toggles (Emergency, Warranty) / state
  (NEW or updated). Clicking the WO# link navigates to the WO detail
  in the WO module and closes the modal. Flag buttons reuse
  `woAction('toggleEmergency' | 'toggleWarranty')`.
- Modal closes on Done. Single batch per import.

**Ramifications traced:**
- `updateSettings` does not mutate `orders`, so a geocache write does
  not change `data.orders` reference -> `activeOrders` `useMemo` stays
  cached -> the App worker effect does not retrigger on every successful
  write. cacheRef gives latest values inside the loop.
- Imports DO change `orders` reference -> effect retriggers -> in-flight
  worker cancelled (cleanup sets `cancelled`); a new worker picks up
  including the new batch. Pending fetches check `cancelled` before
  writing, so no double-writes.
- ImportInspectModal reads `orders` prop and looks up each batch id at
  render time, so flag toggles via `woAction` re-render the modal with
  the new state immediately.
- Modal placement: alongside other modals at the App root, after the
  module branch. Modal's portal-style rendering means it floats over
  any module.
- No more MapsModule local worker -> `setGeocacheEntry` prop removed
  from MapsModule (no behavior change).

#### Geocoder accuracy hardening + no-zoom-on-select (built 2026-06-02)

User reported:
- Maps zoomed in on every WO selection (annoying for at-a-glance review).
- Nominatim returned wildly wrong locations (out-of-state hits).
  "Maximum effort" requested.

**No-zoom-on-select:**
- Selected-WO effect calls `mapRef.current.panTo(...)` instead of
  `setView(..., 16)`. Zoom level preserved.
- `fittedRef` ref guards the auto-fitBounds to fire only once per
  mount, so the App-level worker streaming in new geocodes does not
  keep jumping the map.

**Geocode accuracy strategy (maximum effort):**

Added `settings.mapsHomeState` (2-letter US state code) to the Maps
settings section. Blank by default in source. Plus a "Clear geocode
cache" affordance with confirm + cache count.

Geocoder rewritten:

1. **Structured Nominatim query** instead of free-text `q=`. Fields:
   `street`, `city`, `state`, `country=US`. `countrycodes=us`.
   `addressdetails=1` so we can cross-check the response.
2. **Viewbox bias** computed from `settings.mapsDefaultView` (lat/lon
   +/- 2 degrees ~ 220km box). With `bounded=1` on pass 1, results
   MUST land inside the box.
3. **Pass 2 fallback**: if pass 1 returns nothing, retry unbounded
   (still structured). Any result from the fallback is marked
   `suspect=true` unconditionally.
4. **State cross-check**: response `address.state_code` (or
   `address.state`) compared to `mapsHomeState`. Mismatch -> suspect.
5. **Distance check**: haversine from default view center. > 250km
   -> suspect.
6. **Cache shape**: success entries now `{ lat, lon, suspect, reasons }`.
   Old `{ lat, lon }` entries still render as non-suspect (back-compat).

**Suspect rendering:**
- Marker rendered as a 18px orange `divIcon` (vs default Leaflet blue
  pin). Visually distinguishable at a glance.
- Popup includes an inline warning bar listing reasons (e.g. "state
  FL != home NC; distance 920km") + an instruction to right-click and
  pick "Re-geocode address" to retry.

**Re-geocode action:**
- `woAction('regeocode', id)` removes the cache entry via functional
  `updateSettings`. App worker picks it up next pass. Toast confirms.
- Added "Re-geocode address" item to `WOContextMenu` (not bulk).

**Clear-cache settings affordance:**
- `MapsSection` shows current cache count and a "Clear geocode cache"
  button (with confirm). Used after changing home state or default
  view so old loose entries get re-resolved with the new bounds.

**Ramifications traced:**
- `settingsRef` keeps the worker reading the latest settings without
  retriggering the effect. Changes to home state / default view apply
  to the NEXT WO the worker fetches (no restart, no double-work).
- Old cache entries (no `suspect` field) render as normal markers.
  User can clear cache to force re-geocode under new rules.
- `panTo` preserves user zoom; `fittedRef` prevents drift during
  continuous geocoding. Auto-fit still fires once per mount when the
  first non-empty marker set lands.
- 250km threshold is a heuristic. Configurable later if needed for
  large states (TX, CA) - flagged as known limitation.
- Pass 2 fallback doubles worst-case fetches per WO (2 x 1.1s). Heavy
  initial startup if cache is empty. Acceptable per "maximum effort"
  spec.
- Cleared cache resets count to 0; worker continues running and
  re-geocodes everything from scratch with current settings.

#### Known limitations

- Nominatim User-Agent: `fetch()` cannot set a custom UA; Electron's
  default UA is used. Nominatim's policy asks for an app identifier.
  Future improvement: route Nominatim calls through the Electron main
  process via IPC so it can set a proper UA.
- Window resize: Leaflet's `invalidateSize()` not currently wired on
  pane resize. If the right pane resizes after init, tiles may have
  gaps until the next pan/zoom. Acceptable for v1.

### Bugfix during Maps QA - API key paste field overflowed

User reported: the API key input + buttons row in Settings -> API Keys
ran off the right edge of the drawer on narrow windows.

Root cause: ApiKeysSection used SettingRow, whose `children` container is
`flexShrink: 0`. The fixed 280px input + 3 buttons (~440px total) could
not shrink, so it pushed past the right edge of the drawer's content
column on common Electron window widths.

Fix: replaced SettingRow with a custom stacked layout in ApiKeysSection.
Label + hint on top; input + buttons in a `display: flex; flex-wrap:
wrap; gap: 8` row below. Input is `flex: '1 1 220px'; minWidth: 0; box-
sizing: border-box` so it shrinks to fit. Buttons keep their natural
width and wrap to a new line when the row is too narrow. Long link URL
uses `wordBreak: 'break-all'` to prevent its own overflow.

Ramifications traced:
- SettingRow itself unchanged; other Appearance / Workflow / Alerts /
  Tray rows unaffected.
- box-sizing border-box on the input prevents padding from extending
  past its flex basis (a common shrink-failure cause).
- Visual hierarchy still reads as a Settings row (label + hint + control
  cluster), just stacked instead of side-by-side.

