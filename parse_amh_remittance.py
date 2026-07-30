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

# RECOGNIZE THE FORMAT BEFORE PARSING IT.
#
# "I understood this document and it contained no rows" and "I have never seen this
# document before" are different answers, and this returned the first for both. A real
# Payout Report from a third payer (PO#-keyed, $320.00 across 4 POs) parsed to
# ok:true / rows:[] / paymentTotal:null, and the app, which branches only on !ok, drew
# an empty remittance screen with no warning. On a money path that is the worst
# available failure: indistinguishable from success.
#
# These markers are structural headers, not row content, so a statement that genuinely
# has zero rows still passes and still reports ok:true with an empty list.
AMH_MARKERS = ('EFT No:', 'Invoice Date Invoice Number Amount', 'ACHVendor')
UNRECOGNIZED = ('unrecognized remittance format: no AMH markers found (expected one of: '
                + '; '.join(AMH_MARKERS) + '). This file was NOT parsed. If it is a real '
                'remittance, it is from a different payer or AMH changed the layout.')


def looks_like_amh(text):
    return any(mark in text for mark in AMH_MARKERS)


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

    # ONE FILE CAN HOLD SEVERAL REMITTANCES. AMH concatenates separate EFT payments
    # into a single PDF, each with its own `Total:` and `EFT No:` header. This used to
    # re.search (first match only), so a file holding $75.00 + $2,657.97 reported
    # paymentTotal 75.00 against 2,732.97 of rows: the built-in cross-check fired a
    # false alarm and any reader of the total was off by a factor of 36. Observed on 3
    # of 31 real statements (0_2, 0_5 (1), 0_6 (1)).
    #
    # The ROWS were always right; only the whole-file figures were truncated. So:
    # every header is summed, and every EFT number is carried.
    totals = [float(t.replace(',', '')) for t in re.findall(r'Total:\s*\$([\d,]+\.\d{2})', text)]
    efts = re.findall(r'EFT No:\s*(\d+)', text)
    payment_total = sum(totals) if totals else None
    # `eftNo` keeps its name and its single-statement meaning; with several it lists
    # them all rather than silently naming one, which would misattribute the other's rows.
    return rows, payment_total, ', '.join(efts), totals, efts


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

    if not looks_like_amh(text):
        print(json.dumps({'ok': False, 'error': UNRECOGNIZED}))
        return 1

    rows, payment_total, eft_no, totals, efts = parse_text(text)
    print(json.dumps({
        'ok': True, 'rows': rows, 'paymentTotal': payment_total, 'eftNo': eft_no,
        # Per-statement detail, so a caller can reconcile each EFT separately instead
        # of only in aggregate. `statementCount` > 1 means this file held several.
        'statements': [{'total': t, 'eftNo': e} for t, e in zip(totals, efts)],
        'statementCount': len(totals),
    }))
    return 0


if __name__ == '__main__':
    sys.exit(main())
