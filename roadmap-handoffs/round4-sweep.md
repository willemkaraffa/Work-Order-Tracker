# ROUND 4 — bug + deprecation sweep (2026-06-29)

## STATUS — ALL IMPLEMENTED + harness-verified. Build clean. Not released.
- BUG-S1: settings scroller made full-bleed (padding moved to inner wrapper) -> Appearance + Maps
  both scroll at the modal edge (padR 0, gap 1px on both). Fixed.
- DEP-1: status display select now Show/Hidden (legacy pills/single normalize to Show). Verified.
- DEP-2: orphaned --age-1/2/3 vars deleted (both themes). Build clean, no refs.
- UX-1: nested settings editors (PMsEditor/StatusesEditor) get a capture-phase Esc (useEditorEscClose)
  -> Esc closes only the editor, settings stays open. Verified.
- ROUND 5 notifications: header BELL + badge + dropdown replaces the ✦ attention button; overdue
  derived + alerts + update + capture events feed it; clicking an item opens the WO / import modal
  / installs; capture (onImport/onFoundWos/captureAllAMH) now pushes a notification instead of
  auto-popping a modal; attention tri-pane RETIRED (Landing/AlertCard + dead `counts` removed);
  CaptureBanner de-fixed (in-flow, no header overlap). Verified: bell badge=1 (overdue), dropdown
  lists it, click opens WO; ✦ gone; console clean. NOT testable headless: live scraper ->
  notification -> import modal (needs Electron); CaptureBanner in-flow during a real scrape.
Tray badge still uses alerts.length (OS-level, intentionally kept).

(original investigation below)


Per [[feedback_handoff_before_fix]]: findings logged here; vet + decide course before touching
code. Build currently clean.

## BUG-S1 — Settings tab scrollbars inconsistent (some at modal edge, some inset)
Reported after N4 (settings -> popup). Could NOT reproduce headless: the preview viewport here is
too small, so EVERY tab overflows and scrolls via the single content div
(settings.jsx:78 `padding:28px 32px; overflow:auto`), whose scrollbar sits at the panel's right
edge (measured gap = 1px on all tabs). The inconsistency needs a TALL Electron window where short
tabs fit (no outer scrollbar) and only inner-scroll sub-elements show — those are inset by the
content div's 32px right padding.
Inner-scroll sub-elements found (the inset-scrollbar candidates):
  - settings.jsx:1520 — Trades / Tech-Job-Types section wraps a wide table in
    `overflowX:auto; maxWidth:100%` -> a HORIZONTAL scrollbar inset by 32px.
  - settings.jsx:1116-1126 — Maps geocode-test `<pre>` `maxHeight:280; overflow:auto` -> inset
    vertical scrollbar (only appears after running the test).
  - Nested editors (PMsEditor:666, StatusesEditor:862) are separate centered dialogs with their
    own scroll — not "tabs".
NEED FROM USER: which exact tab(s) show the misaligned scrollbar? That pins it (likely Trades,
or whichever has a tall list). 
Fix direction (decide after pinpoint): make the section's content scroll at the single content-div
level (remove the inner fixed-height/overflow so the outer edge scrollbar handles it), OR if the
inner box is intentional (geocode log), leave it. Likely real fix = the offending SECTION sets its
own height/overflow that should be removed so it inherits the content-div scroll.

## DEP-1 — displayMode "Pills" vs "Single" now identical  [redundant after F]
The per-phase status display select (settings.jsx:458-468) offers Pills / Single / Hidden. After
the F list rework, ListRow renders BOTH pills and single as the same colored status TEXT
(listpane.jsx:408 `showStatus`, no pill in the list anymore). So "Pills" and "Single" are
indistinguishable; the label "Pills" is now a misnomer (there is no pill in the list).
Proper fix: collapse to a 2-way choice — e.g. "Show" (status text + colored left bar) / "Hidden".
Keep stored values backward-compatible: treat legacy 'pills' and 'single' both as "show". Update
the select options + label. Low risk (listpane already treats them the same).

## DEP-2 — `--age-1/2/3` theme vars orphaned  [unused after F]
Defined in both themes (app.jsx:62-64 light, :113-115 dark) but referenced NOWHERE after F moved
age from a row-bg tint to the colored "Xd" counter (which uses hardcoded hex in listpane.jsx).
`ageBg` and `pmOptions` are already fully removed (no dangling refs — clean).
Proper fix: remove the 6 `--age-*` lines. OPTIONAL nicer alternative: have the age counter reuse
a theme token instead of hardcoded hex (but the old --age values are light bg washes, poor as
text — so hardcoded is acceptable; just delete the dead vars). Trivial, zero-risk.

## UX-1 — Settings Esc closes everything even over a nested editor
SettingsOverlay (app.jsx) closes on Esc -> currentView='active'. But PMsEditor / StatusesEditor
(opened INSIDE settings) have no Esc handler, so Esc over them closes the WHOLE settings popup,
losing the editor context. Minor.
Proper fix: give the nested editors their own Esc handler that closes just the editor (and
stopPropagation), or have SettingsOverlay's Esc no-op while a nested editor is open. Low priority.

## Checked + clean (no action)
- Command center still opens post-N4; map inset (zoom 11) renders; X (z30) closes.
- Maps status submenu key warning fixed (cloneElement); console clean.
- ageBg / pmOptions removal left no dangling references.
- Inline Client dropdown gated on `onSetClient` (safe when absent).

## BUG-S1 — ROOT FOUND (user screenshots: Appearance bar inset, Maps bar at edge)
Cause: per-section width wrappers. `AppearanceSection` wraps content in
`<div style={{maxWidth:720, margin:'0 auto'}}>` (settings.jsx:183); other sections do too via
inner `maxWidth`. The single scroll container (content div, settings.jsx:78
`padding:28px 32px; overflow:auto`) should put its scrollbar at the modal edge — but with the
32px right padding + narrowed/centered section content, the bar visually detaches from the edge
on some tabs and not others.
DECIDED behavior: the scrollbar must ALWAYS ride the modal's right edge, regardless of how wide
the section's text/inputs are.
Fix spec: make the content div the consistent full-bleed scroller with NO right padding that
detaches the bar — move horizontal breathing room to an INNER wrapper. Concretely:
  - content div (78): keep `overflow:auto`, change padding so the RIGHT edge has 0 (e.g.
    `padding: 28px 0 28px 0` on the scroller) and put the actual 32px left/right padding +
    optional max-width on a single inner wrapper that ALL sections share (so the scrollbar sits
    at the scroller's edge = modal edge, and content is padded inside).
  - Simpler alternative: keep padding on the content div but ensure EVERY section is full-width
    (remove the per-section `maxWidth/margin:0 auto`, e.g. settings.jsx:183) so the bar is always
    at the same place. Pick one; verify in Electron that Appearance + Maps bars now align.
Collateral: removing AppearanceSection's centering widens its content to full width (acceptable;
matches Maps). Check other sections with inner maxWidth (search `maxWidth` in settings.jsx).

---

# ROUND 5 — Notifications dropdown (retire Alerts tri-pane). User-confirmed decisions.

Decisions: sources = stale/attention alerts + capture/scraper results + app-update + schedule
overdue. Persistence = session-only (alerts derived live; capture/update events in session
state; cleared on restart; unread badge = count). Retire the old attention view; Overview
attention summary stays. Capture progress = slim bar repositioned below header + a result item
dropped into notifications on completion.

## Mechanism (reuse-first)
- Alerts already derived: `computeAlerts(orders, alertThresholds)` -> `alerts` (app.jsx:4695),
  items `{kind, blurb, wo}`. Schedule-overdue: add a derivation (reuse `isOverdueSched`) either
  inside computeAlerts or a small parallel memo. NO new stored field (rule 5).
- Capture events: today `captureAllAMH` (app.jsx:5482) sets `importInspect` and `findNewMsr`
  (5551) sets `newMsrWos`, which AUTO-OPEN their modals (6219, 6230). REDIRECT: on completion
  push a session `notifEvent` carrying the payload; clicking the notification calls
  `setImportInspect(payload)` / `setNewMsrWos(payload)` to open the SAME modal on demand. The
  modals stay; only their trigger moves (no auto-pop). One new session state: `notifEvents` (array
  of `{id, kind, ts, label, sub, payload}`), justified — capture/update results are events, not
  derivable from WO data.
- Update available: `updateState` (4260) -> a notif item (action = install / show UpdateBanner).
- Notification list = derived-alerts (mapped to a common shape) + `notifEvents`, sorted by ts /
  severity. Unread count = items since last open (a session `notifSeenTs`), badge on the bell.

## UI
- HeaderChips (app.jsx:3270): replace the `✦ {attentionCount}` attention button (3299-3304) with
  a BELL button + unread badge -> opens a dropdown panel (absolute, same pattern as the `⋯` menu)
  listing notifications. Item click: alert -> jump to WO (existing onSelectAlert path); capture ->
  open its modal; update -> install. Empty state "No notifications".
- `HeaderActionsContext.onOpenAttention` -> repurpose to open the dropdown (or drop; bell owns it).

## Retire attention tri-pane (collateral — mostly deletion)
- Remove `currentView === 'attention'` branch (app.jsx:5810) + the `Landing` render; `Landing`
  (2159) becomes unused -> delete or leave.
- `showSidePanel` (5882) was `currentView==='attention'` only (settings is an overlay now) -> with
  attention gone it is always false. Remove `showSidePanel` + the right-column `{showSidePanel &&
  ...}` block + the now-unused `rightPane` variable (only Settings used it, and Settings is an
  overlay).
- ListPane `onSelectWO`/`selectedWO` guards referencing 'attention' (6165-6172): drop the
  attention parts, KEEP settings handling.
- `attentionCount` (4704, 5995) -> becomes the notif unread count.
- KEEP: OverviewModule's attention summary + `onSelectAlert` (separate surface, unchanged).

## Progress bar (header overlap)
- `CaptureBanner` (2737) is `position:fixed; top:0; zIndex:500` -> overlays the header. It is
  ALREADY placed in-flow in the top flex column (app.jsx:6002-6007) under UpdateBanner; the
  `position:fixed` overrides that. Once capture no longer auto-pops a modal (this round), remove
  `position:fixed` so it is in-flow and pushes content down (no header overlap). Verify it still
  shows during a scrape and disappears after.

## Collateral / risks
- Redirecting capture to notifications must NOT lose the import-review step — clicking the notif
  must open the exact same ImportInspectModal/newMsrWos modal with the captured batch. Test the
  full capture -> notification -> open-modal -> review path (Electron; harness can't run scraper).
- Single-WO capture (5440) currently just shows the banner (no modal) -> optionally also a notif;
  low priority.
- Schedule-overdue notifications could be noisy; cap/group like the existing alert chips.

## VERIFY AFTER
- BUG-S1: Appearance + Maps scrollbars both at modal edge (Electron).
- DEP-1/DEP-2/UX-1.
- Notifications: bell badge counts; dropdown lists alerts+events; alert item jumps to WO; capture
  item opens import modal; update item installs; attention view fully gone; progress bar no longer
  covers header.

## Proposed ordering
BUG-S1 + DEP-1 + DEP-2 + UX-1 (quick, isolated) -> Round 5 notifications (bell dropdown, retire
attention, redirect captures, reposition CaptureBanner).
