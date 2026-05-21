# FIX #6 - Extension import: no confirmation, lands in the right place

You are continuing a roadmap of fixes on the Work Order Tracker (Electron + React-via-Babel desktop app, Python sync backend; Chrome extension feeds work orders in). Work ONLY in this worktree:

```
C:\Users\pvega\OneDrive\Desktop\AI_Daily_Report\WO_Tracker-Source\.claude\worktrees\roadmap-v3.1
```

Branch: `claude/roadmap-v3.1`. App version 3.0.1. User runs the dev build with `npm start` from this worktree (must quit any installed-app tray instance first - single-instance lock).

## Rules (from CLAUDE.md - obey exactly)
- Read existing files before writing. Don't re-read unless changed.
- No emojis or em-dashes.
- Do not guess APIs, versions, flags, SHAs, or package names. Verify by reading code/docs.
- Work silently; chat only after the task is complete; minimal wording.
- Before implementing, search for existing working code and prefer wrapping it.
- When you flag a risk in static review, either mitigate it or design a live test for it before proceeding.
- Commit each discrete fix separately with a clear message. Do NOT push. Do NOT publish.

## Roadmap line
"FIX: revert legacy feature where tracker asks confirmation for extension imports. Ensure imports go where they are supposed to."

## CRITICAL CONTEXT - this is verification-first, NOT a blind code change

Opus already investigated. The legacy confirmation prompt does NOT exist in the current code anywhere. Do not add or remove code on the assumption that a confirmation is still present. Confirmed findings (re-read these files to verify before doing anything):

1. Tracker renderer - `index.html` ~L4056-4068, the one-time `extensionBridge.onImport` effect:
   - Flow is `onImport(incoming) -> upsertOrders(incoming) -> toast(...) -> extensionBridge.acknowledge()`.
   - There is NO `window.confirm`, no modal, no review/approve step. Import is immediate.
2. `upsertOrders` - `index.html` ~L1091-1190:
   - New WOs are created with `tab: 'active'`, `status: inc.status || 'Open'`, `history: [{ action: 'imported' }]` (~L1156-1178).
   - Existing WOs (matched by portal `woId`, explicit `id`, or `findDuplicate` on propertyId/address/phone) are updated in place and KEEP their current tab (~L1133-1151), logging `action: 'updated from import'`.
   - Dedup (`findDuplicate` ~L1100-1111) silently skips re-captures by propertyId, normalized address, or 10+ digit phone.
3. main.js bridge - the only import path is the localhost HTTP bridge:
   - `startBridgeServer` POST `/import` parses the array and does `win.webContents.send('extension-import', orders); win.show(); win.focus();` (~L81-92). No confirmation.
   - `import-acknowledged` IPC (~L482) is a no-op `{ ok: true }`.
   - There is no file-watcher / native-messaging-host import path.
4. preload.js - `extensionBridge` exposes `onImport` and `acknowledge` (~L24-27). Matches above.
5. Installed frozen app (`%LOCALAPPDATA%\Programs\Work Order Tracker\resources\app.asar`, version 3.0.1) has the byte-identical `onImport` flow - also no confirmation. So the user is NOT seeing a confirmation from an older installed build either.
6. Chrome extension - `C:\Users\pvega\OneDrive\Desktop\AI_Daily_Report\tracker chrome extension\wo-extension`:
   - `background.js` POSTs to `http://127.0.0.1:27843/import` (BRIDGE_URL L2, fetch L47, `sendToTracker` handler ~L104). No confirmation.
   - `popup.js` `doSendToTracker` (~L230-241) just sends; the only `confirm()` is "Remove all saved work orders?" at popup.js:131 (clear-all, unrelated to import).

Conclusion going in: the "revert the confirmation" half is already done. The open half is "ensure imports go where they are supposed to" - that is the part to actually verify, and the only place a code change might still be warranted.

## Your tasks

### Task A - confirm the static findings (read, do not assume)
Re-read the six items above in the live files. If ANY of them is wrong (a confirmation prompt or extra import gate still exists), STOP and report exactly where, with file:line, before changing code. If a real confirmation gate is found, removing it is the fix - revert it to the immediate `upsert -> toast -> acknowledge` flow shown above, commit, and live-test.

### Task B - live-test the import path end to end
The user must do the Chrome half; give explicit step-by-step instructions. Goal: prove an import (a) requires no confirmation, (b) lands in the Active tab with status Open, (c) toasts the count, (d) re-importing the same WO does not duplicate it.

Suggested live test (no extension needed - exercise the bridge directly so you can verify without Chrome):
1. Have the user start the dev build: quit the installed tray app, then `npm start` from the worktree.
2. POST a synthetic WO to the bridge and confirm it appears in Active. From the worktree run:
   ```
   curl -s -X POST http://127.0.0.1:27843/import -H "Content-Type: application/json" -d "[{\"woId\":\"TEST-9001\",\"pm\":\"AMH\",\"address\":\"1 Test St, Raleigh, NC\",\"status\":\"Open\",\"type\":\"HVAC\"}]"
   ```
   Expect HTTP `{ ok: true, count: 1 }`, the tracker window to focus, a toast "Imported 1 WO", and a new row TEST-9001 in the Active tab with status Open.
3. POST the SAME payload again. Expect it to update in place (toast "Imported 1 ..." with no second row) - re-import does not duplicate.
4. Verify persistence: confirm the row is written to `%APPDATA%\work-order-tracker\wo-data.json` (top key `wo_data` is a JSON string; parse twice; look in `orders` for `id: "TEST-9001"`, `tab: "active"`).
5. Have the user delete the TEST-9001 row afterward so test data does not pollute the workbook sync.

Note: `curl` on this Windows shell may be PowerShell's `Invoke-WebRequest` alias - if the literal `curl` misbehaves, use `curl.exe` explicitly, or have the user trigger a real import from the extension popup ("Send to tracker").

### Task C - "ensure imports go where they are supposed to"
Decide, with the user if ambiguous, whether the current routing is correct:
- New WO -> Active / Open. (Believed correct.)
- Re-import that matches an existing WO already in sent/invoiced/paid -> updated in place, stays in its tab. Confirm this is desired (it usually is - you do not want a re-scrape to yank an invoiced job back to Active).
If the user reports imports landing somewhere wrong, capture the exact repro (which portal, which fields) before touching `upsertOrders` - the id-resolution and dedup logic at L1119-1183 is subtle and easy to break.

## Required approach
1. Read the cited files fully before editing.
2. Do Task A. If no confirmation gate exists (expected), make NO renderer/main/extension code change for the "revert" half - instead document the finding in your final report.
3. Do Task B live test; report results.
4. Do Task C; change `upsertOrders` only if a concrete misrouting repro exists.
5. Commit only if you changed code. If the only outcome is "verified, already correct", do NOT create an empty commit - just report.

## Notes / gotchas
- The installed app at `%LOCALAPPDATA%\Programs\Work Order Tracker\resources\` is a SEPARATE frozen copy; your edits do not affect it. Test only via `npm start`.
- JSX is compiled at runtime by Babel standalone (CDN, index.html:28); no local build step. Verify syntax by careful reading; the user reloads (Ctrl+R) to test.
- The bridge listens on `127.0.0.1:27843` only while the app is running.
- Prior fixes on this branch (do not disturb): load_overrides port, note-card menu, manage-list focus, reorder controls, phase-order row sort, chromedriver popup fix, FIX #5 workbook sync (load_orders now reads sent+invoiced; sync error toasts surface real cause).
