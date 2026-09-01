# Handoff: AMH capture stored a REJECTED bid option (WO 9831067)

Written 2026-09-01. Repo `C:\dev\Work-Order-Tracker`, branch
`feat/schedule-retention`, HEAD `c947ef3`. Fix is SHIPPED IN THE WORKING TREE and
NOT COMMITTED. Working tree also carries unrelated admin-S4 dirt
(`roadmap-handoffs/admin-s4-handoff.md`).

This file was first written with a WRONG theory. See RETRACTED at the bottom
before trusting anything a prior session said about this defect.

Run `git log --oneline -3` and `git status --short` before trusting this file.

---

## ABSTRACT

An AMH bid holds several priced OPTIONS. Only one is approved; the others are
rejected quotes. Capture picked the wrong option, so the work order stored the
price of work AMH never bought.

Cause: `choose_options_for_bid` selected approved options by an `isApproved`
key. The live API never sends that key. Its approved list was therefore always
empty, so it fell through to its `isPreferred` fallback, and on this WO the
preferred option was the REJECTED one.

WO 9831067 stored $269.50 (rejected Option 2) while AMH paid $1,714.50 (approved
Option 1) on the same bid. The remittance reconcile then reported a dollar
mismatch, which read as a money bug and was not one.

Fix: 12 lines in that one function. Rejected options are removed from the source
list so no branch can return one; `isApproved` stays first for payloads that do
send it; a `statusName` of Approved comes next; `isPreferred` and all-options
remain the last fallbacks.

---

## LIVE EVIDENCE

Real AMH API payload for WO 9831067, pulled 2026-09-01 through the shipped
`scrape_amh` login + API helpers. Parked OUTSIDE the repo at
`<session scratchpad>/wo-dump-9831067.json`. It holds customer PII. Never commit
it, never copy customer data into a test.

```
WO 9831067  statusName Posted  2 bids

BID 0092948  statusName Approved  invoices: [W9831067B0092948, statusName Paid]
  OPT "Option 1"  price 1714.50  statusName Approved  isPreferred False
  OPT "Option 2"  price  269.50  statusName Rejected  isPreferred True
BID 0092946  statusName Approved  invoices: []          (0.00 stub)

option keys, verbatim: isPreferred, canPerformNow, earliestWorkDate, created,
                       updated, price, statusId, statusName, name, id
                       -> NO isApproved key exists
```

Two facts follow, and both contradict the original theory:

1. Only ONE bid carries an invoice, and `select_billed_bid` (`scrape_amh.py:456`)
   already returns it. Bid selection was never the defect.
2. Approval lives in the OPTION's `statusName`. `isPreferred` marks a different
   thing entirely, and here it marked the rejected option.

The paid invoice also carries `lineItems` (notes + tax-inclusive amount: 915.00
water heater, 215.00 faucet, 134.06 emergency, 80.44 diagnostic, and so on).
That is an authoritative record of what AMH paid, currently unused. See OPEN.

---

## MECHANISM

`choose_options_for_bid` (`scrape_amh.py:417`), before the fix:

```python
options = bid.get("options", []) or []
approved = [o for o in options if o.get("isApproved")]   # key never sent -> []
if approved: return approved
preferred = [o for o in options if o.get("isPreferred")] # -> the REJECTED option
return preferred if preferred else options
```

`extract_bids` (`scrape_amh.py:484`) then sums that option's services into
`bidItems` + `bidAmount`, and `build_wo` (`scrape_amh.py:582`) emits them. The
stored record for WO 9831067 held exactly the rejected option's three lines
(Diagnostic 75 + tax 5.44, Emergency 125 + tax 9.06, shut off valve 55 = 269.50).

`reconcileAmhRow` (`src/orders-logic.js:1518`) compared that against the paid
1714.50 and reported "Computed 269.50 vs paid 1714.50 (off ...)". The reconcile
was right about the numbers it was given; the numbers were wrong upstream.

Class, not instance: ANY AMH WO whose paid bid carries a rejected option marked
preferred captured the wrong price.

---

## WHAT SHIPPED

`scrape_amh.py:417`, the only code change:

```python
options = [o for o in (bid.get("options", []) or [])
           if normalize_text(o.get("statusName")).lower() != "rejected"]
approved = [o for o in options if o.get("isApproved")]
if approved:
    return approved
approved = [o for o in options
            if normalize_text(o.get("statusName")).lower() == "approved"]
if approved:
    return approved
preferred = [o for o in options if o.get("isPreferred")]
return preferred if preferred else options
```

Rejected is filtered ONCE at the source list, so every later branch inherits the
exclusion, including the return-everything fallback.

`test/amh-bid-option.test.js` (new): 7 checks, mechanism copied from
`test/amh-hydrate-customers.test.js` (shipped `scrape_amh` imported in a Python
subprocess, fixture-free, no network, exit 0 pass / 1 fail / 2 skip). Its fixture
reproduces the real payload SHAPE with invented service names and no customer
data, and one check guards the fixture itself (options must carry no `isApproved`
key, else the test proves nothing).

---

## HOW IT WAS PROVEN

1. `npm run verify`: 49 pass, 0 fail, 1 skip (`msr-extract`, fixtures absent,
   pre-existing).
2. New test run alone, to prove it PASSES rather than silently skipping inside
   the aggregate count: 7 ok, exit 0.
3. REAL DATA, the one that matters: `build_wo` over the live dump returns
   `bidAmount 1714.50` with 9 items, where the same call returned `269.50` with 3
   items before the fix.

Still open: a live re-capture of WO 9831067 in the app, to confirm the stored bid
updates to 1714.50 and its remittance block reconciles. That is a human step.

---

## OPEN RISKS

1. `select_billed_bid`'s third fallback (`scrape_amh.py:475`) probes only
   `choose_options_for_bid(b)[0]`. With rejected options stripped, that first
   element can now be a different object. Reachable only when NO bid carries an
   invoice, so WO 9831067 never hits it. Untested. Left alone deliberately:
   touching it means restructuring `select_billed_bid`.
2. The same options appear again under the sibling bid's `relatedBids`.
   `_bid_universe` (`scrape_amh.py:440`) dedups by id/name, so this is consistent
   today. Any future per-bid option logic will see each option under two parents.
3. Only `Rejected` is excluded. Another terminal AMH status (Declined, Void,
   Expired) would still fall through to `isPreferred` and reproduce this defect
   class. NOT widened on purpose: no dump attests such a status, and guessing at
   status vocabulary is what produced the original wrong theory.
4. Unused authority: the paid invoice's `lineItems` say what AMH paid, per line.
   Reconcile still reconstructs from option services instead. Worth a look if a
   future WO's option math disagrees with its payment.

---

## RETRACTED

The first version of this handoff diagnosed a WRONG-BID defect and specified a
five-part fix (F1-F5) that threaded a new `bidInvoice` field and the remittance
`W<wo>B<bid>` token through `scrape_amh.py`, `main.js`, `src/app.jsx`,
`src/remittances.jsx`, `src/data.js` and `src/orders-logic.js`. A plan was drafted
and approved on it.

The live dump disproved its premise: only one bid is invoiced, and the picker
already chose it. None of that wire work is needed for this defect. Do not
rebuild it.

What the wrong theory got right, and what it cost: the app does store one bid per
WO with no record of which one, and the remittance's bid number is parsed and
never used. Neither fact caused this bug. The theory was built from reading code
plus one stored record; the real cause was visible in the first live payload
anyone looked at. Pull the real data before specifying a fix, not after.

A builder also flagged seven design gaps in the retracted F1-F5 spec (change
detection in `src/data.js:492`, the `applyCapture` field whitelist, a field-name
collision on `bidInvoice`, two untargeted batch re-capture paths, a missing
`STATUS_STYLE` entry, the explicit `match.order` field list, and unscoped flag
wording). All were verified real. They are moot with F1-F5 dropped, and are
recorded here only so nobody re-derives them.
