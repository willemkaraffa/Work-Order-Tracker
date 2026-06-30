# ROUND 2 — BUG SWEEP

## STATUS — B1, B2, B3 FIXED + harness-verified. Build clean. Not released.
- B1 (close X): z-index 2->30; harness confirmed X exists at z30 and click closes the overlay.
- B2 (cascade rename): renaming code AMH->AMHX rewrote pms[0].name AND every AMH order
  (1001,1002) -> pm 'AMHX'; color + fullName preserved; MSR untouched. Verified via captured
  storage write.
- B3 (inline client): clicking the Client field -> pick MSR -> WO 1001 chip became 'MSR' blue,
  menu closed, change persisted.
Sweep follow-ups still open: S2 (auto-status could flip a Closed WO on schedule) — not guarded;
maps Schedule-modal + G status-flip + note-lock still need real Electron (harness can't).
SCRAPER CAVEAT stands: do not rename AMH/MSR CODES (scraper re-emits them); edit full name only.

(original investigation below, retained)

---

# ROUND 2 — BUG SWEEP (investigation only, NO fixes applied)

Date 2026-06-29. Triggered by user repro: Client codes don't display (no color/code) after
editing a client; can't change Client inside the WO command-center modal; no X to close the
modal. User asked for a high-level then low-level sweep. Below: each finding with file:line,
confirmed root vs candidate, and the proper-course options. DO NOT blind-fix — review first.

Build is clean; these are runtime/logic defects, not compile errors.

---

## B1 — Command-center X (close) button hidden + unclickable  [CONFIRMED, regression]
Symptom: no X in the modal's top-right; only Esc closes (undiscoverable).
Root: the Round-2 C fix gave `CCTopBar` its own stacking layer `position:relative; zIndex:20`
(app.jsx ~941). The close button is `position:absolute; top:8; right:10; zIndex:2` on the panel
(app.jsx:853-858). The top bar spans the panel's full width at the top, so it paints OVER the
z-2 button and also intercepts its clicks. The X is physically behind the top bar.
Proper fix (pick one):
  (a) Move the X into `CCTopBar` as the last flex item (cleanest; the bar already reserves
      `padding-right:44px` for it — remove that and let it sit in-flow), OR
  (b) raise the X to `zIndex:30` (above the bar) — still overlaps the bar's right edge, uglier.
Recommend (a).

## B2 — Client code/color not displayed after editing a client  [ROOT NARROWED, needs repro]
Symptom: "tried changing client back, no color or Client code displayed" — WO chip greys out.
Mechanics: `PMChip` (primitives.jsx:11-25) resolves `pms.find(p => p.name === pm)`; `o.pm`
stores the CODE; chip text = `o.pm`, color = matched entry's color, else gray `#6b7280`.
So a grey/blank chip means **o.pm matches no `pms[].name`**.
Two ways that happens, both real:
  (i) The Manage-Clients editor lets the user edit the CODE itself (the ✎ / double-click inline
      edit renames `pm.name`, settings.jsx:799-803). There is NO cascade to orders, so renaming
      a code orphans every WO that used the old code -> grey. This directly contradicts
      requirement #2 ("if a Client name is changed, the WO should not lose it; ensure all WOs are
      re-assigned"). The code-stable model fixed fullName edits, but left CODE edits orphaning.
  (ii) Real stored data may have `o.pm` values that are not codes (e.g. a full name or legacy
      string) that never matched a `pms` entry even before Round 2.
DIAGNOSIS STEP (before fixing): in the running app, inspect a few `orders[].pm` values vs
`pms[].name`. If they mismatch after a code edit -> cause (i). If they mismatched already ->
cause (ii) (needs a one-time normalize/migration).
Proper fix:
  - For (i): EITHER make code edits cascade (`setPms` rename also rewrites every `o.pm` old->new
    via an orders update) so renames never orphan — this is what req #2 asked for — OR lock the
    code as read-only after creation and only allow fullName/color edits. Cascade matches the
    requirement better; locking is simpler/safer. DECIDE.
  - For (ii): a normalize pass mapping legacy `o.pm` values onto codes (case-insensitive /
    fullName match), run once in data.js migration.

## B3 — Cannot change the Client from inside the WO modal  [GAP, by design today]
Symptom: clicking the Client field in the command center does nothing.
Mechanics: DetailPane renders Client as a static `<Field>` with a `PMChip` (detail.jsx:327);
only the STATUS pill is interactive (opens a status menu, detail.jsx:262-286). The only way to
change the client is the Edit form (topbar "Edit" / overflow -> Edit details -> WOForm Client
`<select>`, app.jsx:1194-1198), which is wired correctly (setModal edit -> editTarget ->
Modal `open={!!editTarget}`, app.jsx:4212, 6212) and renders ABOVE the command center (modal at
6212 is later in DOM than `{commandCenter}` at 6144, equal zIndex 400). So Edit DOES work — the
user likely expected to click the field directly, and/or was blocked by being unable to exit
(B1) and conflated the two.
Proper fix: make the Client field in the DetailPane header a click-to-open dropdown of clients
(mirror the existing status-pill menu pattern, detail.jsx:262-286) calling an `onSetClient`
handler -> updateOrder pm. Reuses the status-menu mechanism; no new modal. Confirm Edit-modal
stacking once B1 is fixed (verify the form actually appears on top in Electron).

---

## High-level sweep — other Round-1/2 areas reviewed (lower confidence; verify in Electron)

- S1 (maps type filter): markers iterate `list`, and the marker-render effect lists `list` in
  deps, so toggling `hiddenTypes` re-filters markers + sidebar together. Looks correct; verify
  a hidden type actually drops its markers.
- S2 (G auto-status): `setSchedule` (app.jsx ~5060) sets the schedule/returnschedule-tagged
  status on any non-null schedule. EDGE: scheduling a WO whose status is Closed/Cancelled would
  also flip it. Probably fine (you don't schedule closed WOs) but note it; consider guarding to
  only auto-set from "open/active" statuses. Also requires the user to TAG two statuses in
  Settings -> Workflow, else nothing happens (no default tag) — confirm that's understood.
- S3 (list status removal): `showStatus = view!=='sent' && statusMode!=='hidden'`
  (listpane.jsx). The old per-phase `displayMode==='single'` (plain text) now renders as colored
  text like the others — behavior change, not a bug, but confirm no phase relied on 'single'.
- S4 (X/topbar z): with the topbar at z20, re-check OTHER absolutely-positioned children of the
  panel besides the X (none currently, but the rail's future insets must stay below z20 or above
  intentionally). Low risk now.
- S5 (PMChip width): changed to `minWidth:28; padding:0 4px` so a longer code won't clip; a very
  long code (user types a long "code") could still widen rows. Cosmetic.
- S6 (sidebar "All" highlight): `onClient = av.startsWith('cl:')`; "All" highlighted when not a
  client view. On a complete/trash tab the Clients section still shows "All" highlighted — minor.

## Items the harness could NOT exercise (need Electron) — still open from prior status
- E maps: type-toggle hiding markers; Schedule-from-map opening ScheduleModal.
- G: status actually flipping on a real schedule, and return-trip on the 2nd schedule.
- Note-input-lock ([[bug_note_card_input_lock]]) inside the overlay (Electron focus quirk).
- B2 real-data repro (orders[].pm vs pms[].name).

---

## REVIEW / recommended course
DECIDED (user): B2 = cascade rename to all WOs. Fix B1+B2+B3 together; verify each fix spec is
pristine here first and account for collateral. Specs below.

---

## VETTED FIX SPECS (implement exactly these)

### B1 — close button stacking  [1 line, no prop threading]
Change the X button `zIndex: 2` -> `zIndex: 30` (app.jsx:854). The X is a SIBLING of `CCTopBar`
(both children of the positioned panel), so z30 > the bar's z20 -> X paints above + is clickable.
The bar already reserves `padding-right:44px` so its content never underlaps the corner.
Collateral: none. Dropdown menus (z1000) still sit above the X if one ever opens under it (fine).
Verify: harness hit-test that the X is the topmost element at its rect; clicking closes overlay.

### B2 — cascade code rename (so renames never orphan WOs)
New App handler (place near setPms, app.jsx ~3910):
```
const renameClientCode = React.useCallback((oldCode, newCode) => {
  const o = (oldCode || '').trim(), n = (newCode || '').trim();
  if (!n || o === n) return;
  const nextPms    = pms.map(p => p.name === o ? { ...p, name: n } : p);
  const nextOrders = orders.map(w => w.pm === o ? { ...w, pm: n } : w);
  updateData({ pms: nextPms, orders: nextOrders }); // atomic single write (data.js:443)
}, [pms, orders, updateData]);
```
Thread: App `<SettingsDrawer onRenameClientCode={renameClientCode} .../>` ->
`WorkflowSection` (settings.jsx:80) -> `PMsEditor` (settings.jsx:497). PMsEditor `commitRename`
calls `onRenameCode(pms[idx].name, val)` instead of its local `setPms` rename; fall back to the
old setPms path if the prop is missing (defensive).
Collateral / RISKS (must respect):
  - Match is exact-and-trimmed on `w.pm === oldCode`; covers ALL tabs (active/complete/sent/
    trash) since we map all `orders`. WOs with other codes untouched.
  - Renaming a code to one that ALREADY EXISTS merges the two clients' WOs onto the surviving
    entry. Acceptable but note; do not dedupe pms automatically.
  - **SCRAPER CAVEAT (important):** AMH/MSR codes are emitted by the scraper (scrape_amh.py /
    extension write o.pm = 'AMH'/'MSR'). Cascade fixes EXISTING WOs, but the NEXT import will
    arrive with the original code and orphan again. So renaming a scraper-backed CODE is
    fundamentally unsafe regardless of cascade. UI guidance: for AMH/MSR edit the FULL NAME, not
    the code. Consider (later) marking scraper codes read-only; out of scope now — document only.
  - `updateData` overwrites pms+orders wholesale; the map preserves every other field. Verify no
    other in-flight write races (single-threaded React; fine).
Verify: harness — rename a code, confirm every matching WO's chip follows + stays colored, and a
non-matching WO is untouched.

### B3 — inline Client dropdown in DetailPane header
Make the Client `<Field>` value (detail.jsx:327) a click-to-open menu mirroring the status-pill
menu (detail.jsx:262-286): a `position:relative` wrapper, click toggles a menu listing `pms`
(render `code · fullName`), pick calls `onSetClient(data.wo, code)` and closes; document-click /
Esc close effect (reuse the existing statusMenuOpen effect pattern, detail.jsx:215-222 — or add a
parallel `clientMenuOpen`).
New App handler:
```
const setClient = React.useCallback((id, code) => {
  updateOrder(id, o => ({ ...o, pm: code,
    history: [...(Array.isArray(o.history) ? o.history : []),
      { ts: Date.now(), action: 'client set to ' + code, detail: '' }] }));
}, [updateOrder]);
```
Pass `onSetClient={setClient}` into the DetailPane built inside `commandCenter` (app.jsx ~5876).
DetailPane already receives `pms`. 
Collateral:
  - New state `clientMenuOpen` in DetailPane — a second menu alongside statusMenuOpen; ensure
    only the intended one is wired (don't reuse statusMenuOpen). One new boolean, justified.
  - Menu z-index: use the status-menu's z (60) so it clears the modal body; the top bar (z20) is
    above the body but the menu opens within DetailPane's own stacking — match the status menu
    which already works inside the modal.
  - The DetailPane right-click context menu (handleContextMenu) ignores INPUT/TEXTAREA only; the
    dropdown is divs, so right-click still opens the WO ctx menu — unchanged, acceptable.
  - Edit form still also changes client (unchanged path); both routes write o.pm = code.
Verify: harness — click Client field, pick another client, confirm chip + o.pm update and menu
closes; confirm status menu still works independently.

### Post-fix
Re-run the harness sweep (B1 hit-test, B2 cascade, B3 pick); rebuild; update STATUS. Leave S2
(auto-status on closed WOs) as a noted follow-up unless trivially guarded.
