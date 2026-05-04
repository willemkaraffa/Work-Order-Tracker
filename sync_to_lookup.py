"""
sync_to_lookup.py
Reads work orders from wo-data.json and writes them into the
'Invoice Import' sheet of RazorSync_Invoice_Tracker.xlsx.

Layout (RazorSync-import-ready):
    A: Invoice #     - blank (filled from RazorSync after invoice creation)
    B: Customer Name - 'American Homes 4 Rent' (AMH), 'Main Street Renewal' (MSR), or pm verbatim
    C: Service Address
    D: Date          - blank
    E: Item/Service  - blank (manual selection from Service Items library dropdown)
    F: Unit Price    - bidAmount when present, else blank
    G: Tax           - formula auto-fills from library by Item/Service
    H: Memo          - 'WO #' for non-AMH; 'WO # | PropID: NC#######' for AMH

Existing data rows are cleared before write. The 'Service Items' library tab is untouched.

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

CELL_FONT   = Font(name="Arial", size=10)
ALIGN_LEFT  = Alignment(horizontal="left", vertical="center")
ALIGN_RIGHT = Alignment(horizontal="right", vertical="center")
THIN        = Side(border_style="thin", color="BFBFBF")
CELL_BORDER = Border(left=THIN, right=THIN, bottom=THIN)

def load_orders():
    if not WO_JSON.exists():
        sys.exit("Cannot find wo-data.json at:\n  " + str(WO_JSON))
    raw    = json.loads(WO_JSON.read_text(encoding="utf-8"))
    data   = json.loads(raw["wo_data"])
    orders = [o for o in data.get("orders", []) if not o.get("deleted", False)]
    print("Loaded " + str(len(orders)) + " active work orders from wo-data.json")
    return orders

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
            return (base + " | PropID: " + pid) if base else "PropID: " + pid
    return base

def parse_bid(v):
    if v in (None, ""):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace("$", "").replace(",", "")
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None

def write_invoice_import(orders, workbook_path):
    wb = load_workbook(workbook_path)
    if SHEET_NAME not in wb.sheetnames:
        sys.exit("Sheet '" + SHEET_NAME + "' not found in " + workbook_path.name)
    ws = wb[SHEET_NAME]

    # Clear existing values in cols A-H from row 2 down (preserve formatting and DV).
    last_row = max(ws.max_row, 2)
    for r in range(2, last_row + 1):
        for c in range(1, 9):
            ws.cell(r, c).value = None

    for ri, o in enumerate(orders, start=2):
        ws.cell(ri, 1).value = ""                                  # A Invoice #
        ws.cell(ri, 2).value = customer_name(o.get("pm", ""))      # B Customer Name
        ws.cell(ri, 3).value = o.get("address", "")                # C Service Address
        ws.cell(ri, 4).value = ""                                  # D Date (blank)
        ws.cell(ri, 5).value = ""                                  # E Item/Service (manual)
        bid = parse_bid(o.get("bidAmount"))
        ws.cell(ri, 6).value = bid if bid is not None else None    # F Unit Price (override)
        ws.cell(ri, 7).value = (
            "=IFERROR(IF(E" + str(ri) + "=\"\",\"\",VLOOKUP(E" + str(ri) +
            ",'Service Items'!A:D,4,FALSE)),\"\")"
        )                                                          # G Tax formula
        ws.cell(ri, 8).value = memo_for(o)                         # H Memo

        for c in range(1, 9):
            cell = ws.cell(ri, c)
            cell.font   = CELL_FONT
            cell.border = CELL_BORDER
            cell.alignment = ALIGN_RIGHT if c == 6 else ALIGN_LEFT
        ws.cell(ri, 4).number_format = "MM/DD/YYYY"
        ws.cell(ri, 6).number_format = "$#,##0.00;($#,##0.00);-"

    wb.save(workbook_path)
    print("Done - " + str(len(orders)) + " rows written to '" + SHEET_NAME + "' in " + workbook_path.name)
    print("Reminder: pick Item/Service per row, then fill column A (Invoice #) after RazorSync assigns numbers.")

if __name__ == "__main__":
    argv_path = sys.argv[1] if len(sys.argv) > 1 else None
    workbook_path = resolve_workbook(argv_path)
    orders = load_orders()
    write_invoice_import(orders, workbook_path)
