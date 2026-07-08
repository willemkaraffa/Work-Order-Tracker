"""Parse an AMH (American Homes 4 Rent) 'ACHVendor' remittance PDF into per-WO rows
for the in-app invoice reconciler. Mirrors parse_msr_remittance.py.

The remittance is a settlement (NO line items -- items come from the AMH portal API).
Each detail row: Invoice Date | Invoice Number | Amount. The CURRENT format encodes the
WO in the invoice number as W<woNumber>B<bidNumber> (e.g. W9759794B0065953 -> WO 9759794,
bid 0065953); a -N suffix (W9746663-1B...) is a revisit / 2nd invoice on the same WO.
Header carries the payment Total + EFT No for a whole-file cross-check.

OLD (pre-2026) remittances used a bare integer invoice number with no embedded WO -- those
rows parse with woId='' (they cannot be joined to a WO by number and reconcile as unmatched).

I/O contract mirrors remittance-runner: the PDF path arrives as a JSON string on stdin
(or argv[1] for CLI testing); a JSON object is written to stdout:
  { "ok": true, "rows": [ {woId, invoiceNum, bidNum, revisit, amount, date} ],
    "paymentTotal": <float|null>, "eftNo": "<str>" }
On failure: { "ok": false, "error": "..." } and a non-zero exit code.
"""
import sys
import re
import json

ROW_RE = re.compile(r'(\d{2}/\d{2}/\d{4})\s+(\S+)\s+\$?([\d,]+\.\d{2})')
WOTOKEN_RE = re.compile(r'^W(\d+)(?:-(\d+))?B(\d+)$')


def parse_text(text):
    rows = []
    for date, invnum, amount in ROW_RE.findall(text):
        m = WOTOKEN_RE.match(invnum)
        wo_id = m.group(1) if m else ''            # digits between W and B (current format)
        revisit = m.group(2) if (m and m.group(2)) else ''
        bid_num = m.group(3) if m else ''
        rows.append({
            'woId': wo_id,
            'invoiceNum': invnum,
            'bidNum': bid_num,
            'revisit': revisit,
            'amount': float(amount.replace(',', '')),
            'date': date,
        })

    tot = re.search(r'Total:\s*\$([\d,]+\.\d{2})', text)
    eft = re.search(r'EFT No:\s*(\d+)', text)
    return rows, (float(tot.group(1).replace(',', '')) if tot else None), (eft.group(1) if eft else '')


def main():
    raw = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read().strip()
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
        parts = []
        with pdfplumber.open(path) as pdf:
            for page in pdf.pages:
                parts.append(page.extract_text() or '')
        text = '\n'.join(parts)
    except Exception as e:  # noqa: BLE001
        print(json.dumps({'ok': False, 'error': 'PDF read failed: ' + str(e)}))
        return 1

    rows, payment_total, eft_no = parse_text(text)
    print(json.dumps({'ok': True, 'rows': rows, 'paymentTotal': payment_total, 'eftNo': eft_no}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
