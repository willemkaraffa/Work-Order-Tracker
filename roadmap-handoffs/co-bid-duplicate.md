# CHANGE-ORDER BID DUPLICATE - dated subfolder copies the original bid

Blueprint. Small, bounded change to ONE main-process IPC handler. Do NOT push. Do
NOT publish. Part of WO folder automation (shipped v4.3-4.5), not invoicing.

Repo: `C:\dev\Work-Order-Tracker`. Branch: `main`. Done-gate: `npm run verify`.

## Why
MSR now requires change-order (CO) bids to reflect the TOTAL price of the WO
(original bid + CO lines), not just the CO amount. So a CO bid must START from the
original filled bid, then have CO lines added. Today a dated subfolder is empty.

## User decisions (settled - do not re-litigate)
- Trigger: REUSE the existing "Create dated subfolder" action. No new menu item.
- The duplicate: copy the original bid's contents (line items + address), re-date to
  today, and name it with "CO" instead of "Bid". Address stays; only date changes.

## VERIFIED current code
- Action `createSubfolder` -> preload `subfolder` (`preload.js:72`) ->
  [wo-create-subfolder](../main.js:607). Menu label "Create dated subfolder" in 3
  renderer sites (`src/detail.jsx:145`, `src/app.jsx:865`, `src/app.jsx:1470`) - all
  fire the same action, so editing the handler covers all entry points.
- Root bid is created by [wo-create-folder](../main.js:561) MSR branch: raw
  `fs.copyFileSync(skel, dest)` of the blank skeleton, then
  [patchBidSheet](../main.js:503) writes address + date cells. File named
  `<sanitized address> Bid <DD-MM>.xlsx` in the WO root folder.
- Reusable pieces (PORT these, do not reinvent): `resolveWoFolder(rec)`
  (../main.js:529), `patchBidSheet(dest, sheetName, addrRef, dateRef, addrVal,
  dateVal)` (surgical xlsx-zip cell edit, preserves template byte-for-byte),
  `BID_CELLS` (../main.js:475) sheet/addr/date refs per trade, `sanitizeName`,
  the DD-MM `fileDate` + MM/DD/YY `cellDate` builders (../main.js:570-574), and the
  trade pick `/hvac|heat|cool|furnace/i.test(rec.type) ? 'HVAC' : 'Plumbing'`
  (../main.js:579). BID sheets exist for MSR ONLY (AMH/other have none).

## AS-BUILT (2026-07-02) - real-data corrections + CO-merge requirement
Sampling real folders (WO 03307717) drove several corrections; user confirmed each:
- CO sheets are CUMULATIVE (each carries bid + all prior COs). So NO line-item
  merge: the newest existing Bid/CO already reflects the WO total -> copy THAT.
- Source = newest Bid/CO `.xlsx` anywhere in the WO folder tree (RECURSIVE; COs
  live in Visit N / dated subfolders), name contains "Bid" or "CO", excl ~$ temp.
- Ranked by CREATION time (birthtime), NOT mtime: mtime is bumped by OneDrive/edits;
  birthtime reflects when each CO was made and sidesteps inconsistent filename date
  formats (some MM-DD, some DD-MM). Windows populates birthtime; mtime fallback.
- "Older than the current date" = birthtime < start-of-today, so a same-day bid
  edit or a CO made earlier today is not picked. (Verified: picks Visit 3 CO 06-30,
  not today's Bid 02-07.) Helper: `latestBidOrCoSheet(root, skipDir, beforeMs)`.
- Dest `<addr> CO DD-MM.xlsx` in the new dated folder; copyFileSync + patchBidSheet
  (date=today, address kept). No-clobber guard. patch failure -> coSkip, copy kept.
- Renderer (createWoSubfolder, app.jsx) toasts co/coSkip.
NOT GUI-run (main-process change needs an Electron RESTART, not Ctrl+R); discovery
+ birthtime pick validated in node against the real WO tree. Live-verify after
`npm start`: MSR WO, Create dated subfolder -> newest cumulative CO copied, re-dated.

## DECISION (2026-07-02): copy-newest is FINAL; line-item merge DROPPED
Legacy CO sheets are DELTAS, so copy-newest does not reflect the WO total for old
WOs. User accepted this: copy-newest is correct GOING FORWARD (future COs generated
by this app are cumulative by construction). The full cross-sheet line-item MERGE
(union all bid/CO items) is NOT built - too big/risky (row-insertion into the
template) for the payoff. Ship copy-newest as-is.

### FUTURE IDEA (not built) - calculation helper bot
Instead of merging files, a helper that reads the OPEN bid/CO sheet and computes the
CO math live. Domain facts captured for whoever builds it:
- The OTHER section is where ALL service items go (free-form rows).
- Service-call fee: EXCLUDED from the HVAC total calc, INCLUDED in the Plumbing total.
- Total mechanic: sum(line item prices) / hourly labor price -> written into the
  Labor Hours cell -> the sheet's own formula turns that into the total (= sum of
  line items). So the tool sets Labor Hours, not the total directly.
See [[project_amh_completion_bot]] for the human-triggered-bot pattern.

## Change spec (in wo-create-subfolder ONLY)
After `mkdirSync(sub)` and before `openPath`, add: if `pm === 'MSR'`, find the
original bid in the WO ROOT and duplicate it into the dated subfolder as a CO file.

1. Locate original bid: read the WO root dir, pick files matching `/ Bid \d{2}-\d{2}\.xlsx$/i`
   (the root bid naming). If several, choose the EARLIEST (the "first bid made") -
   sort by the DD-MM in the name, or by mtime; state which. If none found, do
   nothing (leave the dated folder empty = today's behavior). Non-MSR: skip entirely.
2. Dest name: same base as the original but "Bid" -> "CO" and today's DD-MM:
   `<sanitized address> CO <DD-MM>.xlsx` inside the dated subfolder.
3. Copy: `fs.copyFileSync(originalBid, dest)` (preserves original line items +
   formatting), then `patchBidSheet(dest, map.sheet, map.addr, map.date,
   String(rec.address||''), cellDate)` with `map = BID_CELLS[trade]` - address
   unchanged, date cell = today's `cellDate`.
4. Guards: never clobber an existing CO file (`if (!fs.existsSync(dest))`, mirroring
   the root-bid guard at ../main.js:586). patchBidSheet failure keeps the raw copy
   and is reported via the existing skip channel, not thrown.
5. Return shape: extend the handler's `{ ok, path }` with `{ co, coSkip }` mirroring
   `{ xlsx, xlsxSkip }` so the renderer can toast the created CO file (optional).

The handler is currently synchronous; `patchBidSheet` is async -> make the handler
`async` (wo-create-folder already is). Keep mkdir recursive so a revisit still works
before Create folder was pressed.

## Edge cases
- No root bid yet (subfolder made before the bid, or non-MSR/AMH): empty folder, as
  now. Do NOT fall back to the blank skeleton (user wants the FILLED original, or nothing).
- Multiple CO on the same day: same `YYYY-MM-DD` folder; the exists-guard prevents
  re-copy/clobber of an edited CO.
- Trade of the copy: use the same trade pick as wo-create-folder for the CELL refs;
  the copied file is already the right trade sheet, we only need the correct date cell.

## Verify
- Live: MSR WO with an existing root bid -> Create dated subfolder -> confirm the
  dated folder contains `<address> CO <DD-MM>.xlsx`, opens with the original line
  items intact, address unchanged, date cell = today.
- MSR WO with NO root bid -> dated folder is empty (no crash).
- Non-MSR/AMH WO -> dated folder is empty (no bid logic runs).
- `npm run verify` green (this is main-process IPC; add a logic test only if the
  name/date derivation is extracted to a pure helper - otherwise it is fs I/O).

## Footer
Surgical: edit only wo-create-subfolder + reuse existing helpers. No new fields.
No emojis/em-dashes. Commit separately from invoice-automation work. Do NOT push/publish.
