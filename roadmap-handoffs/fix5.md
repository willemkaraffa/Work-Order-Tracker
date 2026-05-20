# FIX #5 - Sync to Workbook

You are continuing a roadmap of fixes on the Work Order Tracker (an Electron + React-via-Babel desktop app, Python sync backend). Work ONLY in this worktree:

```
C:\Users\pvega\OneDrive\Desktop\AI_Daily_Report\WO_Tracker-Source\.claude\worktrees\roadmap-v3.1
```

Branch: `claude/roadmap-v3.1`. The app version is 3.0.1. The user runs the dev build with `npm start` from this worktree (must quit any installed-app tray instance first - single-instance lock).

## Rules (from CLAUDE.md - obey exactly)
- Read existing files before writing. Don't re-read unless changed.
- No emojis or em-dashes.
- Do not guess APIs, versions, flags, SHAs, or package names. Verify by reading code/docs.
- Work silently; chat only after the task is complete; minimal wording.
- Before implementing, search for existing working code and prefer wrapping it.
- When you flag a risk in static review, either mitigate it or design a live test for it before proceeding.
- Commit each discrete fix separately with a clear message. Do NOT push. Do NOT publish.

## Tab vocabulary (verified)
Order `tab` values: `active`, `sent` (= "Sent-to-Invoice"), `invoiced`, `paid`, `trash`. See index.html ~4139-4143.

## The three sub-problems

### 5a. Sync reads the wrong tab (root cause of "no rows appear")
- `sync_to_lookup.py` `load_orders()` (lines 172-183) filters to `o.get("tab") == "invoiced"` only.
- But the Settings UI hint at `index.html:3311` reads: "Re-sync every Sent-to-Invoice WO" - i.e. it claims to sync the `sent` tab.
- The user moves completed jobs to Sent-To-Invoice (`sent`) and nothing appears in the workbook. Jobs in the `invoiced` tab also are not appearing per the user, so verify the whole write path actually runs and saves.
- **OPEN DECISION - ask the user before coding** (use AskUserQuestion): should the workbook sync draw from `sent`, `invoiced`, or both? The hint text and the code disagree; the user must pick the intended source of truth. Once decided, align BOTH `load_orders()` and the UI hint text.

### 5b. No success/failure feedback on tab-move sync
- Moving a WO to Sent-to-Invoice silently triggers a sync (the periodic `setInterval` at `index.html:4094` runs `globalSyncWorkbook({ silent: true })` every `syncInterval`, default 2m; and there may be an on-move trigger - verify).
- The user sees no toast on success or failure. Decide whether the tab-move path should surface a toast. Check `globalSyncWorkbook` (index.html ~4327) and the `sync-workbook` IPC in main.js (~390-460, two spawn calls at 411 and 448).

### 5c. Workbook path field UX
- `WorkbookSection` (index.html:3288-3316) currently shows the path in a `<code>` element (maxWidth 360, ellipsis) plus a "Change..." button wired to `onPickWorkbook`.
- The user reports the path is uneditable, overflows off-screen, and wants a proper Browse button instead of a text field.
- The file picker already exists: main.js has `dialog.showOpenDialog` at line 472 (find the IPC channel name and the `onPickWorkbook` wiring in index.html, ~4630). 
- Fix: make the path display wrap/truncate cleanly within the panel (no horizontal overflow), and ensure the Browse/Change button reliably opens the native picker and persists the chosen path. Confirm `onPickWorkbook` is actually wired end-to-end; the user's report suggests it may not be.

## Key file map
- `sync_to_lookup.py`: `load_orders()` L172, `write_invoice_import()` L547, atomic save L677-684.
- `index.html`: `WorkbookSection` L3288, periodic sync effect L4089-4098, `globalSyncWorkbook` ~L4327, props wiring ~L4630-4655.
- `main.js`: `sync-workbook` IPC ~L390-460, workbook path resolution `resolveWorkbookPath` ~L216, file dialog L472.
- Workbook file: `C:\Users\pvega\OneDrive\Desktop\WORK ORDERS\RazorSync_Invoice_Tracker.xlsx`, sheet "Invoice Import" (7 columns: Invoice#, Customer, Address, Date, Item/Service, Unit Price, Memo).
- WO data store: `%APPDATA%\work-order-tracker\wo-data.json` (top key `wo_data` is a JSON string; parse twice).

## Required approach
1. Read the cited files fully before editing.
2. Use AskUserQuestion to resolve 5a's open decision (which tab[s]).
3. Implement 5a, 5b, 5c.
4. For Python changes: live-test by running `python sync_to_lookup.py "<workbook path>"` from the worktree and confirm rows for the chosen tab appear in the workbook. Inspect with a short openpyxl read-back script.
5. For UI changes: the user live-tests via `npm start` + Ctrl+R. Give explicit step-by-step test instructions.
6. Commit each fix (5a, 5b, 5c) separately. Report commit SHAs and the test steps in your final message.

## Notes / gotchas
- The user's installed app at `C:\Users\pvega\AppData\Local\Programs\Work Order Tracker\resources\` is a SEPARATE frozen copy. Your edits do not affect it. Test only via `npm start` from the worktree.
- JSX is compiled at runtime by Babel standalone (CDN, index.html:28); there is no local build step and no @babel/core installed - you cannot statically compile. Verify syntax by careful reading; the user reloads to test.
- Sync history so far (this branch): load_overrides port, note-card menu, manage-list focus fixes, reorder controls, phase-order row sort, chromedriver popup fix. Don't disturb those.
