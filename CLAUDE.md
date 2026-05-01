# Work Order Tracker — Claude Memory

## Project
Electron desktop app for Gamble Plumbing Heating and Air.
Source: `C:\Users\pvega\OneDrive\Desktop\AI_Daily_Report\WO_Tracker-Source`
GitHub: https://github.com/willemkaraffa/Work-Order-Tracker

## Build & Publish Instructions (always include these verbatim when helping with releases)

Run each command separately in PowerShell — `&&` does not work in Windows PowerShell 5:

```
cd "C:\Users\pvega\OneDrive\Desktop\AI_Daily_Report\WO_Tracker-Source"
git add .
git commit -m "describe changes"
git push
```

**Token required for the publish step only:**
```
$env:GH_TOKEN="your_github_token_here"
npm run publish-win
```

- `git push` — no token needed; uses cached git credentials
- `npm run publish-win` — requires GH_TOKEN; builds installer and uploads to GitHub Releases for auto-update

> **Rule:** Always clarify which steps need the token and which don't when showing these instructions. This is critical context for the user.

## Key Paths
| Item | Path |
|------|------|
| Live data | `%APPDATA%\work-order-tracker\wo-data.json` |
| Workbook | `%LOCALAPPDATA%\Programs\Work Order Tracker\RazorSync_Invoice_Tracker.xlsx` |
| Sync script (source) | `WO_Tracker-Source\sync_to_lookup.py` |

## Git workflow note
`git add .` produces no output on success — this is normal. Run `git status` to confirm staged files.
