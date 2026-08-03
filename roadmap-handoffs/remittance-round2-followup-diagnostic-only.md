# Follow-up: diagnostic-only bid reads 0 items (deferred from round 2)

Found 2026-07-31 during live test of remittance round 2. SEPARATE, PRE-EXISTING bug (not caused by the
round-2 fuzzy dedup). Deferred to its own scoped fix by user decision. Today's workaround: hand-enter the
Service Call line in RazorSync.

## Symptom
MSR WO 03753381 "2202 Buffalo Way" (in Vendor_ACH_Payment_Detail_-SSRS1 (10).pdf) reads as "no bid sheet"
though the folder + `2202 Buffalo Way Bid 07-07.xlsx` exist and the HVAC sheet resolves fine.

## Root cause (proven by exceljs dump of the real sheet)
The visit is DIAGNOSTIC-ONLY. In `Vendor HVAC Bid Sheet`:
- main table has exactly one qty>0 row: Diagnostic Fee 85 (r17).
- `readSheetOtherItems` (main.js ~882) SKIPS any main-table row matching `/diagnostic fee|service call/i`,
  because it normally expects that charge re-typed in the OTHER free-text as "$85 Service Call" (avoids the
  double when OTHER restates it).
- Here the OTHER desc cell (C154) is BLANK (the user did not hand-write the "$85 Service Call" detail), so
  parseOtherCell yields nothing.
Net: main-table Diagnostic skipped + OTHER empty -> 0 items -> the sheet is dropped (round-2 drop-zero-row) ->
WO reads "no bid sheet". Pre-existing: even before round 2 this WO returned items:[] (the skip + empty OTHER);
round 2 did not regress it.

## Why fuzzy dedup alone does not fix it
Diagnostic Fee tokens {diagnostic} vs Service Call tokens {service,call} share nothing, so dedupeLineItems
cannot collapse a main-table Diagnostic with an OTHER "$85 Service Call". That token mismatch is exactly why
the current code hard-SKIPS the main-table Diagnostic instead of relying on dedup.

## Fix (minimal, testable)
In `readSheetOtherItems` (main.js), replace the unconditional skip of the main-table Diagnostic/Service-Call
row with a CANONICAL emit: push it as `{ desc: 'Service Call', unitPrice: <row price>, qty: 1 }` (canonical
name) instead of `continue`. Then:
- Airedale-style (OTHER restates "$85 Service Call"): dedupeLineItems collapses the two {service,call}@85 lines
  to one -> total UNCHANGED.
- Buffalo-Way-style (OTHER blank): the canonical Service Call 85 survives -> WO reads correctly.
Reuse the existing dedupeLineItems (bid-select.js) for the collapse; do NOT add a parallel skip/merge path.

## Verify
- Pure: extend test/bid-select.test.js -> two {service,call}@85 collapse to one; a lone canonical Service Call
  survives.
- Live: drop SSRS (10).pdf; Buffalo Way WO 03753381 shows Service Call $85 and its total equals paid; confirm
  Airedale WO 03429915 total is still 572.08 (no new double).
