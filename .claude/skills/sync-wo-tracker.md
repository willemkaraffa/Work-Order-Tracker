# sync-wo-tracker

Scrape bid line items for all Invoiced work orders and write them to
`scraped_bid_items.json` so that `sync_to_lookup.py` can populate the
Invoice Import sheet of `RazorSync_Invoice_Tracker.xlsx`.

Run this skill before clicking **Sync Workbook** in the tracker app any time
AMH WOs are present or MSR items need a manual review pass.

---

## Output file

Write results to:

```
%APPDATA%\work-order-tracker\scraped_bid_items.json
```

Expanded on Windows: `C:\Users\pvega\AppData\Roaming\work-order-tracker\scraped_bid_items.json`

Schema:

```json
{
  "scraped_at": "<ISO-8601 timestamp>",
  "items": {
    "<wo_id>": [
      { "name": "<description text>", "price": 0.0, "qty": 1 }
    ]
  }
}
```

- Key is the WO `id` field exactly as it appears in `wo-data.json` (e.g. `"WO-12345"`).
- `price` is a float (dollars). Use `0.0` if not shown on the bid.
- `qty` defaults to `1` unless explicitly listed.
- Only include items for WOs you successfully scraped. Leave out WOs with
  no retrievable data; `sync_to_lookup.py` will fall back for those.

---

## Step 1 — Load invoiced work orders

Read `wo-data.json`:

```
%APPDATA%\work-order-tracker\wo-data.json
```

Parse: `JSON.parse(file["wo_data"])["orders"]`

Filter to orders where `tab == "invoiced"` and `deleted != true`.

Group by `pm` field:
- `"AMH"` orders — scrape via browser (Step 2)
- `"MSR"` orders — scrape local xlsx files (Step 3)

---

## Step 2 — AMH: scrape approved bid line items

For each AMH WO:

1. Navigate to the WO page on the AMH vendor portal using the WO id.
2. Click the **Bid** tab on the WO page.
3. Locate all bids listed. Identify bids with status **Approved** only;
   skip Pending, Rejected, or any other status.
4. For each approved bid, click the **bid number** link to open the bid
   detail page.
5. On the bid detail page, find the table of line items. Read the
   **Description** column for each row (ignore the Remedy/code column).
   Capture price if shown.
6. Collect all items from all approved bids for this WO. If the same
   description appears across multiple approved bids for the same WO,
   include only the first occurrence (dedup by case-insensitive description
   match).
7. Store under `items["<wo_id>"]`.

If the portal requires login and you are not already authenticated, stop
and ask the user to log in, then continue.

---

## Step 3 — MSR: extract items from local bid spreadsheets

For each MSR WO:

Variables needed from the WO record:
- `address` — service address string
- `dateCreated` — date string in `YYYY-MM-DD` format (use as the WO date)

### 3a — Locate the address folder

Base directory: `%USERPROFILE%\OneDrive\Desktop\WORK ORDERS\aMain Street Renewal\`

Match the address to a folder using house number + street token similarity:
- Extract house number and street tokens from the WO address.
- Find the folder whose name shares the same house number and the highest
  token overlap with the street name.

If no folder is found, skip this WO (it will get a blank anchor row).

### 3b — Select relevant xlsx files

Inside the matched folder, list all `.xlsx` files (skip temp files starting
with `~$`).

Classify each file:
- **CO file** if the filename (stem) matches the pattern
  `\bco\b` (whole word) or contains `change request` or `change order`
  (case-insensitive).
- **Original file** otherwise.

Date filter (30-day window):
- Use the file's last-modified date as a proxy for when the bid was prepared.
- Keep only files whose modified date is within 30 days of the WO's
  `dateCreated`.
- If the filter eliminates all files, fall back to using all files in the folder.

Read order:
1. Original file(s) first.
2. CO files in ascending modification-date order (oldest CO first).

### 3c — Extract line items from each xlsx

Each bid sheet is a "Vendor HVAC Bid Sheet" workbook. The active sheet contains:

**Predefined rows (rows 11-76):**
- Column B: item name
- Column H: quantity
- Column I: line item price (total for that row)

Include a row if:
- Column I is a positive number
- Column B is not blank, "TOTAL", "BID TOTAL", or "ITEM"

Compute unit price: `round(col_I / col_H, 2)` (default qty = 1 if col H is
blank or zero).

**"Other" free-text block (rows 77-81):**
- Column B contains text like "Please provide description..."
- Column C contains free-text with one or more items in the form `$NNN description`
- Column I must be positive for the row to count

Parse each `$NNN description` segment from Column C as a separate item.

### 3d — Deduplicate across files for the same WO

Maintain a running list of item names already collected for this WO.
Before adding a new item from a CO file, check if a similar item already
exists using token Jaccard similarity (threshold 0.5, ignoring stop words:
to, the, a, an, of, in, and, or, with, for, is, are, at, by, on, it, its,
this, that, per, new, existing, old, current).

If a similar item is already in the list, skip the duplicate.

Store the final deduplicated list under `items["<wo_id>"]`.

---

## Step 4 — Write output file

Serialize the results to `scraped_bid_items.json` (see schema above).

If the file already exists, overwrite it.

---

## Step 5 — Confirm and hand off

After writing the file, report:
- How many WOs were scraped
- How many items total
- Any WOs skipped (no folder match, no approved bids, login required, etc.)

Then instruct the user:
> Click **Sync Workbook** in the Work Order Tracker app to write the
> scraped items into the Invoice Import sheet.
