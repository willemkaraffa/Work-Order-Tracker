# Work Order Tracker v2.2.0
Gamble Plumbing Heating and Air — Auto-updating desktop app

---

## First-time setup (one time only)

```
npm install
```

---

## Building and publishing an update

### Step 1 — Set your GitHub token in PowerShell (every session)
Open PowerShell in the source folder and run:
```
$env:GH_TOKEN="your_github_token_here"
```

### Step 2 — Commit your changes
```
git add .
git commit -m "describe your changes here"
git push
```

### Step 3 — Publish to GitHub
```
npm run publish-win
```

This builds the .exe, creates a GitHub Release on willemkaraffa/Work-Order-Tracker,
and uploads the installer + update metadata automatically.

### Auto-updates (end users)
Any installed copy checks GitHub on launch and every 4 hours.
When an update is found it downloads silently in the background.
A purple "Restart & Install" banner appears — one click installs and restarts.

---

## For testing locally (no publish)
```
npm start
```

---

## RazorSync Workbook Sync

The app includes a **Sync Workbook** button (green, top-right of the work order list).
Clicking it runs `sync_to_lookup.py`, which reads all active work orders from
`wo-data.json` and writes them into the Lookup sheet of `RazorSync_Invoice_Tracker.xlsx`.

**Workbook location (installer):** `%LOCALAPPDATA%\Programs\Work Order Tracker\RazorSync_Invoice_Tracker.xlsx`

**To run manually from the command line:**
```
python sync_to_lookup.py
# or with an explicit path:
python sync_to_lookup.py "C:\path\to\RazorSync_Invoice_Tracker.xlsx"
```

**Requirements:** Python must be installed and on PATH.
```
pip install openpyxl
```

**Sync column mapping (Lookup sheet):**

| Column | Field |
|--------|-------|
| A | Work Order ID (update to invoice # after RazorSync assigns one) |
| B | Work Order # |
| C | Property / Address |
| D | Portal Link (fill from portal) |
| E | Status |
| F | Bid Amount |
| G | Technician |
| H | Date Created |
| I | Job Type |
| J | Notes — includes PropID only for AMH orders; phone always included |

---

## Feature summary (v2.2.0)

- WO # is editable in the table (inline) and in the add/edit form
- Property ID and Bid Amount fields added to all work orders
- Phone numbers auto-formatted to `(XXX)-XXX-XXXX`
- Notes tooltip is JS-positioned at the top layer (z-index 99999), no clipping
- Multi-column sort via Shift+click on column headers
- Status list and status cards ordered to match manager workflow
- Sync Workbook button built directly into the app
- Sync Notes logic: Property ID included only for AMH orders

---

## File locations

| File | Path |
|------|------|
| Live data | `%APPDATA%\work-order-tracker\wo-data.json` |
| Workbook | `%LOCALAPPDATA%\Programs\Work Order Tracker\RazorSync_Invoice_Tracker.xlsx` |
| Sync script | `%LOCALAPPDATA%\Programs\Work Order Tracker\resources\sync_to_lookup.py` |

---

## GitHub repository
https://github.com/willemkaraffa/Work-Order-Tracker
