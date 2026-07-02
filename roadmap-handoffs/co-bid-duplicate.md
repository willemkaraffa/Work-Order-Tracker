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
