"""Parse an MSR (Main Street Renewal) 'Vendor ACH Payment Detail' remittance PDF
into per-WO rows for the in-app invoice reconciler.

Mechanism (proven against real remittances, see roadmap-handoffs/invoice-generation.md):
each property block carries three fields that align 1:1 in block order --
  Total For <propCode>  <amount>   -> the PAID amount for the WO
  Invoice Notes : <digits>         -> the app WO id (the reliable join key)
  PI<digits>                       -> the RazorSync-side invoice #
Address is present in the transaction-description line but wraps messily; it is
returned best-effort only (the app prefers the folder's own address, matched by
WO id). Statement Total is returned for a whole-file cross-check.

I/O contract mirrors amh-runner/scrape_amh: the PDF path arrives as a JSON string
on stdin (or argv[1] for CLI testing); a JSON object is written to stdout:
  { "ok": true, "rows": [ {woId, amount, invoiceNum, propCode, addressRaw} ],
    "statementTotal": <float|null> }
On failure: { "ok": false, "error": "<message>" } and a non-zero exit code.
"""
import sys
import re
import json


def parse_text(text):
    # `Total For <propCode> <amount>` terminates each WO block unambiguously. Slice
    # the text at those boundaries so every field is extracted from its OWN block
    # (a whole-text DOTALL search balloons the address across blocks). One Total For,
    # one Invoice Notes, one PI# per block -> naturally 1:1.
    rows = []
    prev_end = 0
    for m in re.finditer(r'Total For\s+(\S+)\s+([\d,]+\.\d{2})', text):
        block = text[prev_end:m.start()]
        prev_end = m.end()
        prop_code, amount = m.group(1), m.group(2)
        note = re.search(r'Invoice Notes\s*:\s*(\d+)', block)
        pi = re.search(r'(PI\d+)', block)
        rows.append({
            'woId': note.group(1) if note else '',
            'amount': float(amount.replace(',', '')),
            'invoiceNum': pi.group(1) if pi else '',
            'propCode': prop_code,
            'addressRaw': _address_in_block(block),
        })

    stmt = re.search(r'Statement Total\s+([\d,]+\.\d{2})', text)
    statement_total = float(stmt.group(1).replace(',', '')) if stmt else None
    return rows, statement_total


def _address_in_block(block):
    # Best-effort street address. The transaction line wraps and INTERLEAVES the
    # street with code/amount/date/PI/(MM/YY) noise (e.g. "4102 Lady p5036818 85.00
    # 05/04/2026 PI000221373 (05/26) Slipper Ln"). Take everything after the vendor
    # date tail up to "Invoice Notes", strip the injected noise, and collapse. This
    # is ADVISORY only -- the app matches by WO id and prefers the folder's address;
    # an address-only match is flagged "verify". '' when the shape is not found.
    m = re.search(r'-\s*\d{2}/\d{2}/\d{2}\b(.*?)Invoice Notes', block, re.S)
    if not m:
        return ''
    seg = m.group(1)
    seg = re.sub(r'\bp\d{6,}\b', ' ', seg)            # repeated property code
    seg = re.sub(r'\d{1,3}(?:,\d{3})*\.\d{2}', ' ', seg)  # amounts
    seg = re.sub(r'\d{2}/\d{2}/\d{4}', ' ', seg)      # full dates
    seg = re.sub(r'\bPI\d+\b', ' ', seg)              # invoice #
    seg = re.sub(r'\(\d{2}/\d{2}\)', ' ', seg)        # (MM/YY) period marker
    return re.sub(r'\s+', ' ', seg).strip()


def main():
    raw = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read().strip()
    # Accept either a bare path or a JSON-encoded string (runner sends JSON).
    path = raw
    try:
        decoded = json.loads(raw)
        if isinstance(decoded, str):
            path = decoded
    except (ValueError, TypeError):
        pass

    try:
        import pdfplumber
    except ImportError as e:
        print(json.dumps({'ok': False, 'error': 'pdfplumber not installed: ' + str(e)}))
        return 1

    try:
        text_parts = []
        with pdfplumber.open(path) as pdf:
            for page in pdf.pages:
                text_parts.append(page.extract_text() or '')
        text = '\n'.join(text_parts)
    except Exception as e:  # noqa: BLE001 - report any read failure to the caller
        print(json.dumps({'ok': False, 'error': 'PDF read failed: ' + str(e)}))
        return 1

    rows, statement_total = parse_text(text)
    print(json.dumps({'ok': True, 'rows': rows, 'statementTotal': statement_total}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
