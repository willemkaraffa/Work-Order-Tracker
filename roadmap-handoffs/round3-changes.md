# ROUND 3 — change requests (2026-06-29). Specs vetted BEFORE coding; verify after.

## STATUS — N1-N4 IMPLEMENTED + harness-verified. Build clean. Not released.
- N1: maps right-click -> "Change status" submenu -> pick -> order status updated (verified via
  captured save); Schedule item opens ScheduleModal. (Fixed a React key warning my submenu
  introduced — mapped item() divs needed keys; now React.cloneElement {key:s}. Console clean.)
- N2: HVAC filter persisted across module switch (line-through, HVAC WO hidden from list+markers).
- N3: MapInset zoom 15->11 (constant; RDU-area). Visual-only, not DOM-assertable.
- N4: Settings now a fixed z-400 centered popup; tabs reachable, list behind, Esc + Close exit;
  nested Manage Clients opens above it.
- G (carried R2): schedule 1001 -> status 'Bid Approved - Return' (schedule tag); re-schedule ->
  'Pending-Complete' (returnschedule tag). Verified end-to-end through the maps Schedule modal.
- S2 (carried): complete/closed WOs are NOT in the schedulable pools or on the map (activeOrders
  only), so auto-status can't reach them from the UI. Left UNGUARDED; documented as unreachable.
Console clean across the full pass. Carried note-input-lock + AMH Capture/Go-to-folder still
need real Electron (harness can't).



Workflow per [[feedback_handoff_before_fix]]: specs + collateral here first, then implement
exactly, then harness-verify R3 AND the carried-over R2 flagged items. Same repo/build.

## N1 — Change WO status from Maps via right-click (+ schedule already there)
Maps marker/sidebar right-click menu (`ctxMenu`, maps.jsx:776+) is a flat `item()` list.
Add a status submenu mirroring the list/detail WOContextMenu pattern.
Spec:
  - MapsModule: new prop `statuses` (status-name array). New state `ctxStatus` (bool).
  - In the menu: add `item('Change status ▸', () => setCtxStatus(true))` WITHOUT closing the menu
    (so refactor: the status item must not call closeCtxMenu). When `ctxStatus`, render the
    status list instead of the main items: `(statuses||[]).filter(s => !LOCKED_STATUSES.has(s))`
    each `-> onWoAction(woId,'setStatus', s)` + closeCtxMenu; plus a `← Back` row.
  - `import { LOCKED_STATUSES } from './constants.js'` in maps.jsx.
  - App: pass `statuses={statuses}` to MapsModule.
  - Schedule item already present (E: 'Schedule/Reschedule' -> openScheduleForm). No change.
Reuse: `woAction(id,'setStatus',s)` (app.jsx:5540) — handles completion auto-flip + visited.
Collateral:
  - Setting a completion status from the map flips the WO to tab=complete and clears schedule ->
    its marker drops (offmap/completed). Expected; not a bug.
  - `closeCtxMenu` must also reset `ctxStatus=false` (else the submenu re-shows next open). Patch
    closeCtxMenu or the menu's open effect.
  - The current `item()` closes the menu on click; the "Change status" item needs a variant that
    does NOT close. Add an optional `keepOpen` arg or inline that one row.

## N2 — Maps type filter sticky across module switches
`hiddenTypes` is local `useState` in MapsModule (maps.jsx) -> resets when the module unmounts on
nav. Lift to App (mirror `mapsSelected` / `itinTech`, app.jsx:3707).
Spec:
  - App: `const [mapsHiddenTypes, setMapsHiddenTypes] = React.useState({})`. Pass
    `hiddenTypes={mapsHiddenTypes} setHiddenTypes={setMapsHiddenTypes}` to MapsModule.
  - MapsModule: remove local `hiddenTypes` state; use the props.
Collateral: App stays mounted across module switches, so the filter persists (page reload resets,
matching itinTech behavior). No persistence to settings (session-only) — acceptable; note it.

## N3 — Map inset (WO modal) zoom out to RDU
MapInset (maps.jsx) `setView([lat,lon], 15)` -> too tight. Change zoom 15 -> 11 (sees the
Raleigh-Durham area at a glance). Single value. Collateral: none.

## N4 — Settings as a popup modal (not the right-column sidebar)
Today settings renders as `rightPane` in the right column when `currentView==='settings'`
(app.jsx:5784, part of `showSidePanel` 5852) -> cramped, tabs cut off. SettingsDrawer is a
self-contained `<section height:100%>` grid (180px nav | content, settings.jsx:33-91).
Spec:
  - App: `showSidePanel = currentView === 'attention'` (drop settings).
  - Build `settingsOverlay` = a CommandCenter-style backdrop (`position:fixed inset:0
    background rgba zIndex 400`) + large panel (~1120px x 85vh, `display:flex` so the drawer's
    `height:100%` fills) containing `<SettingsDrawer .../>` (move the existing rightPane build
    here). Render `{settingsOverlay}` near `{commandCenter}`.
  - Esc closes: add a keydown effect -> `setCurrentView('active'); setPendingSettingsSection(null)`
    (same as the drawer's onClose). The drawer keeps its in-nav Close button too.
Collateral:
  - Nested editors (PMsEditor, StatusesEditor) are their own `zIndex:400` fixed overlays rendered
    INSIDE the drawer -> later in DOM -> paint above the settings panel. Fine (same z, DOM order).
  - List renders full-width BEHIND the settings overlay (currently beside it). ListPane already
    forces selectedWO=null on settings view (app.jsx:6126) — keep.
  - The gear/openSettings sets currentModule='work-orders' + currentView='settings' — unchanged;
    the overlay shows over the WO list. Confirm Service-Items / other modules don't also try to
    show it (settingsOverlay gated on currentView==='settings' only; that view only exists in WO
    module flow). Low risk.

---

## VERIFY AFTER (R3 + carried-over R2 flagged items)
R3:
  - [ ] N1: right-click marker -> Change status -> pick -> status updates; completion status drops
        the marker. Back button works. Schedule item still opens ScheduleModal.
  - [ ] N2: set a type filter, switch module and back -> filter persists.
  - [ ] N3: open a WO modal with a geocoded WO -> inset shows RDU-area zoom.
  - [ ] N4: open settings -> centered popup, every tab reachable + no cutoff; open Manage Clients
        (nested) -> appears above; Close + Esc both exit.
Carried R2 (previously flagged, untested):
  - [ ] S2: schedule a Closed/Cancelled WO -> does G auto-status wrongly flip it? If yes, guard
        setSchedule to only auto-set from active/non-terminal statuses.
  - [ ] G: schedule an unscheduled WO -> status becomes the `schedule`-tagged one; schedule again
        -> `returnschedule`-tagged.
  - [ ] Maps type filter actually hides markers (not just the list).
  - [ ] Anything else spotted (UX/code) during the sweep -> log here, vet, fix.
