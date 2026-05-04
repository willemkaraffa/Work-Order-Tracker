"""
sync_to_lookup.py
Reads work orders from wo-data.json and writes them into the
Lookup sheet of RazorSync_Invoice_Tracker.xlsx.

Usage (manual):
    python sync_to_lookup.py [path/to/RazorSync_Invoice_Tracker.xlsx]

If no workbook path is given, looks in %LOCALAPPDATA%\\Programs\\Work Order Tracker\\
then falls back to the script's own directory.

Requirements: pip install openpyxl
"""

import json, os, sys
from pathlib import Path
from openpyxl import load_workbook
from openpyxl.styles import Font, Alignment, Border, Side

# ── Paths ─────────────────────────────────────────────────────────────────────
HERE    = Path(__file__).parent
WO_JSON = Path(os.environ.get("APPDATA", "")) / "work-order-tracker" / "wo-data.json"

def resolve_workbook(argv_path: str | None) -> Path:
    """Return the workbook Path, trying several locations."""
    if argv_path:
        p = Path(argv_path)
        if p.exists():
            return p
        sys.exit(f"Workbook not found at provided path:\n  {p}")

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

# ── Styles ────────────────────────────────────────────────────────────────────
CELL_FONT   = Font(name="Arial", size=10)
CELL_ALIGN  = Alignment(horizontal="left", vertical="center")
THIN        = Side(border_style="thin", color="BFBFBF")
CELL_BORDER = Border(left=THIN, right=THIN, bottom=THIN)

def load_orders():
    if not WO_JSON.exists():
        sys.exit(f"Cannot find wo-data.json at:\n  {WO_JSON}")
    raw    = json.loads(WO_JSON.read_text(encoding="utf-8"))
    data   = json.loads(raw["wo_data"])
    orders = [o for o in data.get("orders", []) if not o.get("deleted", False)]
    print(f"Loaded {len(orders)} active work orders from wo-data.json")
    return orders

def build_notes(o: dict) -> str:
    """
    Combine notes fields into a single Notes string.
    Property ID is included only for AMH orders (per manager workflow).
    Phone is always included when present.
    """
    parts = []
    if o.get("pm", "") == "AMH" and o.get("propertyId", "").strip():
        parts.append(f"PropID: {o['propertyId'].strip()}")
    if o.get("phone", "").strip():
        parts.append(f"Ph: {o['phone'].strip()}")
    if o.get("notes", "").strip():
        parts.append(o["notes"].strip())
    return " | ".join(parts)

def write_lookup(orders, workbook_path: Path):
    wb = load_workbook(workbook_path)
    if "Lookup" not in wb.sheetnames:
        sys.exit(f"Sheet 'Lookup' not found in {workbook_path.name}")
    ws = wb["Lookup"]

    # Clear existing data rows (keep header row 1)
    for row in ws.iter_rows(min_row=2, max_row=ws.max_row):
        for cell in row:
            cell.value = None

    # Lookup sheet columns:
    # A: Invoice #  B: Work Order #  C: Property   D: Portal Link
    # E: Portal Status  F: Bid Amount  G: Technician
    # H: Date of Service  I: Job Type  J: Notes
    for ri, o in enumerate(orders, start=2):
        row_data = [
            o.get("id", ""),            # A – Invoice # (fill from RazorSync later)
            o.get("id", ""),            # B – Work Order #
            o.get("address", ""),       # C – Property
            o.get("portalLink", ""),    # D – Portal Link
            o.get("status", ""),        # E – Portal Status
            o.get("bidAmount", ""),     # F – Bid Amount
            o.get("tech", ""),          # G – Technician
            o.get("dateOfService") or o.get("dateCreated", ""),   # H – Date of Service
            o.get("type", ""),          # I – Job Type
            build_notes(o),             # J – Notes (propId only for AMH)
        ]
        for ci, val in enumerate(row_data, 1):
            cell            = ws.cell(ri, ci, value=val)
            cell.font       = CELL_FONT
            cell.alignment  = CELL_ALIGN
            cell.border     = CELL_BORDER
        ws.cell(ri, 8).number_format = "MM/DD/YYYY"

    wb.save(workbook_path)
    print(f"Done — {len(orders)} rows written to Lookup in {workbook_path.name}")
    print("Reminder: update column A (Invoice #) once RazorSync invoice numbers are assigned.")

if __name__ == "__main__":
    argv_path = sys.argv[1] if len(sys.argv) > 1 else None
    workbook_path = resolve_workbook(argv_path)
    orders = load_orders()
    write_lookup(orders, workbook_path)
