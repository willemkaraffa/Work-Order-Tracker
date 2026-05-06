"""
sync_to_lookup.py
Reads work orders from wo-data.json and writes Invoiced-tab orders into the
'Invoice Import' sheet of RazorSync_Invoice_Tracker.xlsx.

Layout (RazorSync-import-ready, 7 columns):
    A: Invoice #     - blank (filled from RazorSync after invoice creation)
    B: Customer Name - 'American Homes 4 Rent' (AMH), 'Main Street Renewal' (MSR), or pm verbatim
    C: Service Address
    D: Date          - blank (manual)
    E: Item/Service  - blank dropdown (Service Items library)
    F: Unit Price    - VLOOKUP formula returning Price from Service Items (column C); blank when E blank
    G: Memo          - 'WO #######' for non-AMH; 'WO ####### | NCXXXX' for AMH

Per-WO grouping:
    - Anchor row: A-D + G populated; E and F left blank for the user to pick first item.
    - One blank separator row inserted after each WO group.
    - User adds additional service-item rows above the separator as needed; data
      validation and the F-column VLOOKUP already extend across the sheet.

Only WOs whose tab == 'invoiced' (and not deleted) are written. The
'Service Items' library tab and existing data validation/formulas in the
target row range are preserved on rewrite.

Usage:
    python sync_to_lookup.py [path/to/RazorSync_Invoice_Tracker.xlsx]

If no path given, looks in:
    %USERPROFILE%\\OneDrive\\Desktop\\WORK ORDERS\\
    %LOCALAPPDATA%\\Programs\\Work Order Tracker\\
    script directory.

Requirements: pip install openpyxl
"""

import json, os, sys
from pathlib import Path
from openpyxl import load_workbook
from openpyxl.styles import Font, Alignment, Border, Side

HERE    = Path(__file__).parent
WO_JSON = Path(os.environ.get("APPDATA", "")) / "work-order-tracker" / "wo-data.json"

SHEET_NAME = "Invoice Import"

CUSTOMER_MAP = {
    "AMH": "American Homes 4 Rent",
    "MSR": "Main Street Renewal",
}

# Maximum row the managed range will ever reach. Both this script and
# rebuild_invoice_import_sheet.py use the same value; keep them in sync.
WRITE_ROW_MAX = 2000

CELL_FONT   = Font(name="Arial", size=10)
ALIGN_LEFT  = Alignment(horizontal="left", vertical="center")
ALIGN_RIGHT = Alignment(horizontal="right", vertical="center")
THIN        = Side(border_style="thin", color="BFBFBF")
CELL_BORDER = Border(left=THIN, right=THIN, bottom=THIN)


def resolve_workbook(argv_path):
    if argv_path:
        p = Path(argv_path)
        if p.exists():
            return p
        sys.exit("Workbook not found at provided path:\n  " + str(p))

    candidates = [
        Path(os.environ.get("USERPROFILE", "")) / "OneDrive" / "Desktop" / "WORK ORDERS" / "RazorSync_Invoice_Tracker.xlsx",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Work Order Tracker" / "RazorSync_Invoice_Tracker.xlsx",
        HERE / "RazorSync_Invoice_Tracker.xlsx",
    ]
    for c in candidates:
        if c.exists():
            return c
    sys.exit(
        "Cannot find RazorSync_Invoice_Tracker.xlsx.\n"
        "Run: python sync_to_lookup.py \"C:\\path\\to\\RazorSync_Invoice_Tracker.xlsx\""
    )


def load_orders():
    if not WO_JSON.exists():
        sys.exit("Cannot find wo-data.json at:\n  " + str(WO_JSON))
    raw    = json.loads(WO_JSON.read_text(encoding="utf-8"))
    data   = json.loads(raw["wo_data"])
    all_orders = data.get("orders", [])
    invoiced = [
        o for o in all_orders
        if not o.get("deleted", False) and o.get("tab") == "invoiced"
    ]
    print("Loaded " + str(len(all_orders)) + " orders total; " + str(len(invoiced)) + " in Invoiced tab")
    return invoiced


def customer_name(pm):
    pm = (pm or "").strip()
    return CUSTOMER_MAP.get(pm, pm)


def memo_for(o):
    wo = (o.get("id") or "").strip()
    if wo:
        base = wo if wo.upper().startswith("WO") else "WO " + wo
    else:
        base = ""
    if o.get("pm") == "AMH":
        pid = (o.get("propertyId") or "").strip()
        if pid:
            return (base + " | " + pid) if base else pid
    return base


def style_row(ws, row):
    for c in range(1, 8):
        cell = ws.cell(row, c)
        cell.font   = CELL_FONT
        cell.border = CELL_BORDER
        cell.alignment = ALIGN_RIGHT if c == 6 else ALIGN_LEFT
    ws.cell(row, 4).number_format = "MM/DD/YYYY"
    ws.cell(row, 6).number_format = "$#,##0.00;($#,##0.00);-"


def write_invoice_import(orders, workbook_path):
    wb = load_workbook(workbook_path)
    if SHEET_NAME not in wb.sheetnames:
        sys.exit("Sheet '" + SHEET_NAME + "' not found in " + workbook_path.name)
    ws = wb[SHEET_NAME]

    # Only touch rows up to the greater of: what we'll write, or what's already
    # used (so we don't leave stale data below our new content).
    rows_needed = max(len(orders) * 2 + 1, 2)  # anchor + separator per WO
    clear_up_to = max(ws.max_row, rows_needed, 2)
    # Never exceed the managed cap.
    clear_up_to = min(clear_up_to, WRITE_ROW_MAX)

    # Clear values (cols A-G) for only the rows we need to touch.
    for r in range(2, clear_up_to + 1):
        for c in range(1, 8):
            ws.cell(r, c).value = None

    row = 2

    def fill_unit_price_formula(r):
        ws.cell(r, 6).value = (
            "=IFERROR(IF(E" + str(r) + "=\"\",\"\","
            "VLOOKUP(E" + str(r) + ",'Service Items'!A:C,3,FALSE)),\"\")"
        )

    for o in orders:
        # Anchor row: header fields + memo. E and F left blank for first item pick.
        ws.cell(row, 1).value = ""                                  # A Invoice #
        ws.cell(row, 2).value = customer_name(o.get("pm", ""))      # B Customer Name
        ws.cell(row, 3).value = o.get("address", "")                # C Service Address
        ws.cell(row, 4).value = ""                                  # D Date
        ws.cell(row, 5).value = ""                                  # E Item/Service
        fill_unit_price_formula(row)                                # F Unit Price (VLOOKUP)
        ws.cell(row, 7).value = memo_for(o)                         # G Memo
        style_row(ws, row)
        row += 1

        # Blank separator row.
        fill_unit_price_formula(row)
        style_row(ws, row)
        row += 1

    # Restore VLOOKUP across remaining rows up to clear_up_to so any row the
    # user inserts auto-fills Unit Price from the Service Items library.
    for r in range(row, clear_up_to + 1):
        fill_unit_price_formula(r)
        style_row(ws, r)

    # Atomic save: write to a temp file beside the workbook, then replace.
    tmp_path = workbook_path.with_suffix(".tmp.xlsx")
    try:
        wb.save(str(tmp_path))
        os.replace(str(tmp_path), str(workbook_path))
    except Exception as e:
        try:
            tmp_path.unlink()
        except Exception:
            pass
        sys.exit("Failed to save workbook: " + str(e))

    print("Done - " + str(len(orders)) + " WO group(s) written to '" + SHEET_NAME + "' in " + workbook_path.name)
    print("Reminder: pick Item/Service per row, then fill column A (Invoice #) after RazorSync assigns numbers.")
    print("Insert additional rows above the blank separator to add more service items per WO.")


if __name__ == "__main__":
    argv_path = sys.argv[1] if len(sys.argv) > 1 else None
    workbook_path = resolve_workbook(argv_path)
    orders = load_orders()
    write_invoice_import(orders, workbook_path)
