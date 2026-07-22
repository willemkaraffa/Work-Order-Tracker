# Scraper sweep: what the scrapers actually record

Opened 2026-07-22, after the MSR capture was found reading fields out of flattened
innerText and silently returning blanks. The question this file answers is not "does
capture run" but "does it record the right things, completely, and do the numbers agree".

**Nothing here is fixed.** Log-only by instruction. Fix list needs sign-off first.

## Method

Read-only probes against the real store (`%APPDATA%/work-order-tracker/wo-data.json`,
490 orders) and against real captured DOM dumps. No portal access, no credits spent.
Source is classified by `pm === 'MSR'` and by id shape (AMH = 7 digits, MSR = 8 digits
zero-led, `WO-###` = manual).

Fill rate = the share of orders where the field is non-empty. Read it as a floor: a
field can be legitimately empty (a WO with no tech assigned yet), so a low rate is a
QUESTION, not automatically a defect. Both the full history and the last 30 days are
reported, because a field that broke recently is hidden by years of good history.

## Fill rates, last 30 days (AMH 101, MSR 104)

| field | AMH | MSR |
|---|---|---|
| address | 100% | 100% |
| city | 100% | 99% |
| phone | 98% | 98% |
| **contactName** | **100%** | **4%** |
| **contacts** | **100%** | **42%** |
| **propertyId** | **100%** | **1%** |
| priority | 99% | 99% |
| notes | 100% | 92% |
| portalLink | 100% | 98% |
| bidAmount | 84% | 70% |
| **bidItems** | **80%** | **0%** |
| tech | 37% | 38% |
| **dateOfService** | **0%** | **0%** |
| woId | 0% | 0% |

## Findings

### F1. MSR contact name is missing on 96% of recent WOs. HIGH.
AMH captures it 100% of the time; MSR 4%. Root cause found and FIXED in fcf23d6: the
extractor required the literal string `Open <name> Preview` in flattened innerText, and
the page renders `<name>Preview` with no `Open`. It matched nothing and wrote a blank
without erroring.

Fixed going forward. NOT fixed for history: roughly 240 MSR work orders carry no contact
name and no contacts row. Open question is whether to backfill (each needs a portal page
read) or accept the gap.

### F2. MSR `contacts[]` populated 42% vs AMH 100%. HIGH, same root cause as F1.
`contacts` is only built when a contact name was found, so F1 suppresses it. The phone
was usually captured (98%) but had nowhere to attach. That is why phone looked healthy
while the contact record was empty.

### F3. MSR `propertyId` is never captured. MEDIUM, needs a decision not a fix.
`extractPropertyId()` is AMH-only (content.js, inside the AMH path); it reads a
`propertyId=` URL parameter that MSR does not use. MSR's page does carry a Property
lookup (`sfdc:RecordField.WorkOrder.PropertyId__c`, rendering "613 McCarthy Dr"), and its
anchor href holds the Salesforce record id.

Decide first whether the app NEEDS an MSR property id. It is used for import dedup
(`findDuplicate` matches on it), so populating it would make MSR dedup stronger. It is
not obviously needed anywhere else.

### F4. MSR `bidItems` is never captured. MEDIUM, probably intentional, must be confirmed.
`data.bidItems = extractAMHBidItems()` exists for AMH only. Zero MSR orders in the entire
history have bid items. This is consistent with MSR service items coming from the bid
sheet workbook rather than the portal (`parseMsr` reads the live MSR bid sheet, 120
items). If that is the design, this is correct and should be written down. If not, MSR
invoicing is running without portal-side item data.

### F5. `dateOfService` is dead. LOW.
Written exactly once, as `''`, at data.js:431. No code anywhere populates it, and nothing
renders it. Either wire it or delete it from the schema; a permanently empty field
invites someone to trust it.

### F6. AMH: 51 orders carry a bidAmount but no bidItems. MEDIUM, unexplained.
AMH bidItems sits at 80% recent / 63% all-time. Some of that is WOs bid before the
extractor existed. Whether the remaining gap is age or a live extraction failure is NOT
yet established. Needs a fresh AMH dump of a bid WO to settle.

### F7. `tech` is ~38% on both portals. UNTRIAGED.
Same rate on both stacks suggests it reflects reality (tech assigned later, in-app) rather
than an extraction failure. Confirm against a portal page before treating it as a bug.

### F4 CLOSED, by owner decision 2026-07-22.
MSR has no portal-side bid items BY DESIGN. The service items quoted and billed are the
contents of the "Other" cell of the bid sheet, and MSR item recording is deliberately
100% offline. Not a gap, and the scraper should not grow one.

Consequence to carry: a bid sheet ALREADY PARSED can change if MSR demands a revision.
So a parse result is not final, and anything caching parsed items needs a re-parse path
rather than a one-time import. Not yet audited.

### F8. A remittance parser reports SUCCESS on a document it did not understand. HIGH.
`parse_msr_remittance.py` on a real remittance PDF returns:

    { "ok": true, "rows": [], "statementTotal": null }

The file is genuine and carries real money: $320.00 across 4 POs. It is a Payout Report
from **Superior Contracting & Maintenance**, a third payer whose format is neither MSR
nor AMH (PO#-keyed, with QTY and Price columns).

The parser was right to find no MSR structure. It was wrong to call that `ok`. Downstream,
`remittances.jsx:53` branches only on `!res.ok`, so the app builds an EMPTY report with a
null total and shows no warning. A user who loaded that file would see a remittance
screen that looks like it worked and reconciles nothing.

This is the same failure shape as the two capture bugs found today: the wrong answer and
the right answer are indistinguishable. It matters more here because this path is money.

Fix direction, not yet applied: parsers must distinguish "recognized this format, found
zero rows" from "did not recognize this format", and the app must refuse the second.

### F9. The money path has never been tested against a real document. HIGH.
`test/reconcile-msr.test.js` and `test/reconcile-amh.test.js` are both fixture-free by
design, asserting against row shapes hand-written to "mirror" the real remittance. They
test that the matcher agrees with rows their own author invented. That is the exact
pattern that produces a green suite over a real defect.

The parsers themselves (`parse_msr_remittance.py`, `parse_amh_remittance.py`) have NO
test at all in the suite.

Verified by hand this session, against real files rather than mirrors:

| file | rows | sum | stated total | agree |
|---|---|---|---|---|
| Vendor_ACH_Payment_Detail_-SSRS1 (1).pdf | 3 | 1235.00 | 1235.00 | yes |
| ACHVendor_v0037747_0.pdf | 13 | 7661.21 | 7661.21 | yes |
| ACHVendor_v0037747_0_1.pdf | 8 | 2910.61 | 2910.61 | yes |
| ACHVendor_v0037747_0 (1).pdf | 6 | 2078.85 | 2078.85 | yes |
| Gamble Plumbing - PO Remittance - 03.24.2025.pdf | 0 | - | null | see F8 |

So AMH remittance parsing reconciles to the penny on three real statements, and MSR on
one. That is genuine evidence, and it is evidence a human produced by hand today, not
something the gate would catch tomorrow if it regressed.

Wanted: fixture-backed tests over these real files, with the files kept OUT of the repo
(they carry payment detail) and the test SKIPping when absent, exactly like
`test/msr-extract.test.js` already does for the DOM dump.

### F11. A remittance PDF can hold MORE THAN ONE payment; only the first is reported. HIGH.
Full-corpus run: 37 real statements, 310 rows, both shipped parsers.

- MSR: 6 of 6 reconcile exactly.
- AMH: 28 of 31 reconcile exactly.
- 3 AMH files disagree, and all 3 are the same thing: TWO remittances concatenated into
  one PDF, each with its own `Total:` and `EFT No:` header.

| file | headers | EFTs | header sum | parser row sum |
|---|---|---|---|---|
| ACHVendor_v0037747_0_2.pdf | 75.00 + 2,657.97 | 723357, 723603 | 2732.97 | 2732.97 |
| ACHVendor_v0037747_0_5 (1).pdf | 268.13 + 4,198.39 | 7125, 719187 | 4466.52 | 4466.52 |
| ACHVendor_v0037747_0_6 (1).pdf | 175.88 + 4,872.35 | 7786, 726778 | 5048.23 | 5048.23 |

Controls with a single header parse exactly, so the split is fully explained.

**The rows are right.** Every line item in all 37 statements parsed correctly; this is not
lost money. What is wrong is the whole-file cross-check and the EFT attribution:
`parse_amh_remittance.py` takes the FIRST `Total:` and the FIRST `EFT No:` it sees, so a
$2,732.97 payment is reported as $75.00, and rows belonging to two different EFT payments
are labelled with one EFT number.

Consequences: the built-in reconcile check (rows vs stated total) fires a false alarm on
these files, and any per-EFT reporting is wrong for them. A user reading the total sees a
number off by a factor of 36.

Fix direction, not applied: parse per-statement blocks rather than per-file. Return a
statement list, or at minimum sum every header and carry all EFT numbers. Note this makes
the current `paymentTotal`/`eftNo` shape insufficient, so the app side changes too.

### F10. A third payer exists and nothing handles it. NEEDS A DECISION.
Superior Contracting & Maintenance pays by a PO#-keyed Payout Report. Unknown whether
this is current business or a 2025 one-off. If current, it needs its own parser; if not,
F8's refusal is enough so the file cannot be mistaken for a parsed one.

## Checked and CLEAR, do not re-raise

### C1. bidAmount vs sum(bidItems) disagree on 136 orders. NOT A DEFECT.
Every single ratio falls in [1.0044, 1.0726]. None exceeds `TAX_RATE` (1.0725), none is
below 1. bidAmount is the tax-inclusive portal total; bidItems are pre-tax lines, only
some of them taxable. The spread is exactly what a partial-taxable basket produces. This
looks alarming in a diff and is correct.

### C2. `woId` is empty on ~100% of orders. NOT A DEFECT.
Import moves the portal number into `id` and leaves `woId` blank. Every consumer checked
reads both: `matchMsrRow` (orders-logic.js:794) tests `normWoNum(o.woId) === rn ||
normWoNum(o.id) === rn`, and the import dedup builds its index the same way. Invoice
matching is unaffected.

## Not yet audited

- AMH scraper correctness against the 4 captured AMH dumps (F6 depends on this).
- Service items vs the MSR bid sheet catalog: are captured items real catalog entries,
  are quantities and taxable flags right, is the service-call rule applied.
- Invoice totals vs remittance PDFs.
- Coverage: does a scan find EVERY WO the portal lists. Needs a portal-side count to
  compare against, so it is not an offline question.
- Efficiency: no timing has been measured. "Do they do it efficiently" is currently
  unanswered, and nothing here should be read as answering it.

## Requirements added by the owner 2026-07-22, not yet built

### R1. Harden the scrapers against portal version changes.
Version changes have broken capture more than once. Today's two defects were both of that
family: a selector shape that changed (`Open <name> Preview` disappearing) and a page the
scanner was never pointed at. The structural field query added in fcf23d6 is a step, since
it keys on Salesforce API field names rather than on text layout, but nothing yet DETECTS
a change. A scraper that reports blanks when the portal moves is the problem; one that
says "the page shape changed" is not.

### R2. Progress UX for scraping.
The Maps geocoding progress bar is the reference. Capture, bulk capture, MSR scan and
remittance parsing currently show nothing while they work. Port the mechanism from the
geocoding bar rather than inventing a second progress system.

This is also a correctness aid, not only cosmetics: two of today's failures were invisible
partly because nothing showed what the process was doing or what it had touched.

## Standing caution

Two of today's four capture defects were invisible: the scan read the wrong browser tab,
and the extractor wrote blanks. Both reported success. Any fix from this list should ship
with a way to tell that it is still working, not just a way to make it work once.
