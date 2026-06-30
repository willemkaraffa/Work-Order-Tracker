# Round 5 — Batch B (UI fixes)

Source: `06-30 New round Tracker` notes + live screenshot feedback. UI/CSS items:
live-verify (reload the app), mostly not unit-testable. Build + renderer-smoke
gate still runs. Baseline: command-center rework + QA framework (1edddb1).

## B/#4 — Command-center Nearby/Recent dropdowns — DONE (39d6600)

Three issues, one commit:
1. Covered by Map inset. ROOT CAUSE (prior z-bump failed): MapInset is
   position:relative with no z-index, so Leaflet's panes (z 200-700) hoist into
   the modal stacking context and beat the top bar (z:20). Fix: isolation:isolate
   on the right-rail container -> Leaflet panes contained -> bar + dropdowns win.
2. Listed WO# -> now street address (primary). Still picks by id.
3. Nearby sub leaked tech names (`o.tech || city`) -> now city only. Recents now
   resolve to address + city too.
LIVE-VERIFIED PASS (user, 2026-06-30): dropdown above the map, rows = address +
city, no tech names. isolation:isolate was the correct root fix.

## Remaining Batch B (not started)

- #6 right-click menu not disappearing on click-off — likely missing/leaked
  click-off listener (A6). Find the WO context menu; ensure a mousedown-outside
  handler with stable cleanup.
- #9 update banner not showing — UpdateBanner exists (app.jsx:2524), updateState
  at ~4042. Debug why state stays null / banner not rendered.
- #10 notes entry/edit fields don't scale to text height / not resizable — the
  note textarea(s). Add autosize-on-input + allow resize.
- #5 folder button -> dropdown (Create root / Create dated subfolder / View) —
  extends shipped folder automation (v4.3-4.5; main.js IPC).
- #3 service-library quick access from WO modal (+ invoice integration) — FEATURE.

UI items are verified live (reload / electron), not by the test gate.
