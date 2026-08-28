# The bid-sheet parser misses 71 of 336 MSR work orders

Filed 2026-08-28. Reported as "5015 Gailardia Dr's bid sheet is no longer found by the
parser". NO CODE YET, deliberately: the obvious fix can attach the WRONG work order's
scope to an invoice, which moves money.

## Confirmed mechanism

`read-bid-lineitems` (main.js ~988) resolves a folder, then scans it:

```
resolveWoFolder(rec)  ->  WORK ORDERS\aMain Street Renewal\<Street Name Number>\WO <num>
allBidCoSheets(folder) ->  recursive walk from THAT path for *.xlsx matching /bid/i or \bCO\b
```

`allBidCoSheets` swallows a readdir failure and returns `[]`, so a missing `WO <num>`
folder is indistinguishable from a folder holding no bid sheet. The user sees "no bid
sheet", never "wrong place".

Gailardia, verified on disk:

```
Gailardia Dr 5015\05-28\5015 Gailardia Dr Bid Gamble Plumbing - MSR HVAC Bid Sheet.xlsx   <- the file
Gailardia Dr 5015\WO 03984200\                                                             <- does not exist
```

## Not a regression from any recent change

The `WO <num>` level entered at `7942c27`, release 4.3.0, "in-app WO folder + bid sheet
creation". Folders made BEFORE that release keep the sheet at the property root or under a
dated subfolder. Nothing in the 2026-08-28 tax work touches this path. "No longer found"
is the convention having moved under the older folders, not a break.

## Size of the class, measured

Walked every MSR order against the real tree:

| | count |
| --- | --- |
| MSR orders | 336 |
| sheet found under `WO <num>` (works today) | 179 |
| sheet exists under the PROPERTY folder but not under `WO <num>` (fails today) | **71** |
| no bid/CO sheet anywhere | 86 |

So 71 work orders silently return zero line items. Examples: `21 ASH ST`,
`315 W Barnes St`, `3919 Alder Grove Ln`, `418 September Ln`, `3061 BUTTONWOOD LN`,
`110 Brookfield Dr`.

## Why the obvious fix is unsafe

"Fall back to scanning the property folder" is wrong as stated. A property holds MANY work
orders over time. 5015 Gailardia Dr alone has FOUR MSR orders (02714191, 02877908,
03984200, and 04047981 under the variant address `5015 Gailardia 3 Dr`). The property
folder holds ONE HVAC bid sheet, and nothing in its path says which of the four it
belongs to. A blind widen would hand one work order another's scope and invoice it.

## What a real fix has to establish

1. **Attribution.** Given a sheet found outside a `WO <num>` folder, decide WHICH work
   order it belongs to, or refuse. Candidate signals, in order of strength: the WO number
   inside the workbook itself; the sheet's own `Date of Bid` cell against the order's
   date; the dated folder name (`05-28`) against the order's date; file mtime.
   `readSheetOtherItems` already opens the workbook, so reading a WO/date cell is cheap.
2. **Refuse rather than guess.** When a property folder holds one sheet and exactly ONE
   order plausibly claims it, attach it. When two or more orders could claim it, attach
   NOTHING and say so. This is the same shape as the Fix 4 ambiguity rule: two candidates
   at the same evidence means confirm neither.
3. **Fail loud.** Split today's single silent `[]`: "no bid sheet for this WO" versus
   "found N sheets at the property, none attributable to this WO". The current swallow is
   why this went unnoticed across 71 orders.
4. **Do not move files.** Reorganising the tree to match the new convention is a separate,
   reversible chore and must not be smuggled into a read path.

## Acceptance

- Gailardia WO 03984200 either gets its sheet with stated evidence, or reports an explicit
  ambiguity naming the other three orders. Silence is a failure.
- The 179 that work today must be unchanged. Measure before and after with the same walk.
- No work order gains line items whose total contradicts a paid remittance amount.
