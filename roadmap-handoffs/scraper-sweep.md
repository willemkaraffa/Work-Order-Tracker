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

## Standing caution

Two of today's four capture defects were invisible: the scan read the wrong browser tab,
and the extractor wrote blanks. Both reported success. Any fix from this list should ship
with a way to tell that it is still working, not just a way to make it work once.
