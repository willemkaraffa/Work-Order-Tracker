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

## B/#6 — CC context menu not closing on click-off — DONE

ROOT CAUSE: CommandCenter modal panel (app.jsx:733) has onClick stopPropagation
(bubble). DetailPane's context-menu close listener was a BUBBLE-phase document
`click` listener (detail.jsx:185) — a click-off inside the modal was swallowed by
the panel before reaching document, so the menu never dismissed. Fix: moved the
click-close to CAPTURE phase (`addEventListener('click', onClick, true)`), which
runs top-down from document before the panel's bubble stopPropagation. Same
mechanism ListPane already used for its contextmenu capture. Menu-item clicks
still fire (React root dispatch is unaffected by native document capture), then
close. Build + renderer-smoke gate: PASS. LIVE-VERIFY PENDING (reload app).

## B/#9 — update banner not showing — PARTIAL (notif defect fixed)

Banner render path (UpdateBanner app.jsx:2529, updater wiring 4037, preload
bridge, main.js:181-199) is CORRECT and only validatable with a REAL packaged
release (auto-check is gated by app.isPackaged; dev never checks). No code bug
found in the banner. FIXED a concrete adjacent defect: the update NOTIFICATION
(app.jsx:4393) checked status `'downloaded'`, which main NEVER emits — main emits
`'ready'` (main.js:185). So the bell's "Ready to install" item never appeared and
the notif vanished mid-download. Now matches vocab available/downloading/ready.
If the banner still fails after a real release, look at the electron-updater feed
(github publish config is present in package.json; check releases aren't drafts/
prereleases — releaseType:'release').

## B/#10 — note fields don't scale to text / not resizable — DONE

Added `autosize(el)` helper in detail.jsx (height:auto -> scrollHeight). Wired
into all three note textareas: NoteComposer (was resize:'none' -> 'vertical',
minHeight floor for the focus-expand), NoteCard edit, MoreInfoCard edit. Grow-on-
change via onChange; grow-on-open piggybacks the existing editing-focus effect
(the mount signal — no A3/A4 chicken-egg). resize:'vertical' retained for manual
drag. WO form's More-Info field (app.jsx:1226) already resized — left as-is.
Gate: PASS. LIVE-VERIFY PENDING.

## B/#5 — folder button -> dropdown — DONE

New IPC `wo-create-subfolder` (main.js): mkdir recursive `<WO root>/<YYYY-MM-DD>`
+ open (creates root too if absent; no bid sheet). preload woFolder.subfolder.
Renderer: createWoSubfolder callback + onWoAction case 'createSubfolder'.
Surfaced in 3 places for consistency: CC top-bar FolderMenu dropdown (Create
folder / Create dated subfolder / View folder), WOContextMenu folder submenu,
DetailPane overflow menu. Gate: PASS. LIVE-VERIFY PENDING.

## B/#3 — service-library from WO modal (start invoice) — DEFERRED (design locked)

Chosen behavior (user, 2026-07-01): "Start invoice from WO". The library
autocomplete integration ALREADY EXISTS inside InvoiceEditor (invoices.jsx:362,
catalog-driven line items). And `openInvoiceEditor(id)` (app.jsx:4749) already
loads the fresh service_library and opens the editor for a WO. So #3 reduces to:
surface an "Invoice" action in the command-center WO modal that calls
onAction('invoice') -> openInvoiceEditor(woId). Suggested placement: a button in
CCTopBar (app.jsx:886-892, next to Edit/Folder) + wire an 'invoice' case in
onWoAction. No new library plumbing needed. Own slice; not built this session.

UI items are verified live (reload / electron), not by the test gate.
