# Bid sheets outside a WO's own folder are invisible, and that is CORRECT

**RULED 2026-08-28 by the user, and this doc is corrected accordingly. An earlier draft
proposed attributing a stray sheet to a work order. That is withdrawn.** The rule is: a
bid sheet counts only when it sits inside the WO's own `WO <num>` folder. If the WO number
on the containing folder does not match the WO being read, the sheet is not acknowledged.
The app already creates that structure, so there is nothing to infer.

That rule was ALREADY the code: `allBidCoSheets` walks only from `<property>\WO <num>`,
so no work order can ever pick up another's sheet. Verified, not assumed. Nothing about
attribution needed building.

# Original report, kept for the measurement

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

## Why the obvious fix is unsafe (this is why the rule above is right)

"Fall back to scanning the property folder" is wrong as stated. A property holds MANY work
orders over time. 5015 Gailardia Dr alone has FOUR MSR orders (02714191, 02877908,
03984200, and 04047981 under the variant address `5015 Gailardia 3 Dr`). The property
folder holds ONE HVAC bid sheet, and nothing in its path says which of the four it
belongs to. A blind widen would hand one work order another's scope and invoice it.

## SHIPPED 2026-08-28: fail loud, attribute nothing

The read path is unchanged: still only `<property>\WO <num>`, still nothing inferred. The
one defect worth fixing was the SILENCE. `read-bid-lineitems` returned a bare empty list
whether the WO had no folder, had a folder with no sheet, or had a sheet that read zero
rows, so a user could not tell "nothing to read" from "you have not made the folder yet".

- `main.js` `read-bid-lineitems` now returns `reason` (`no-wo-folder` / `no-bid-sheet` /
  `sheets-had-no-rows`) and `folder` alongside the items.
- `src/invoices.jsx` surfaces it through the EXISTING `captureMsg` banner instead of
  autofilling nothing quietly. `no-wo-folder` tells the user to use "Go to folder" and put
  the sheet inside, and says plainly that a sheet filed elsewhere is not read because one
  property holds many WOs.

## SHIPPED 2026-08-31: the BULK remittance path says why too

The 08-28 pass wired the reason into the invoice editor only. `src/remittances.jsx` read
the same IPC and dropped `reason` on the floor, inside a `catch` that swallowed a failed
read entirely, so bulk itemization still showed an unexplained empty WO. Both readers now
share ONE wording.

- `bidReadReasonText(reason)` in `src/orders-logic.js` owns the text for every reason, so
  the two paths cannot drift. Adds `no-desktop` (web build, no `woFolder` bridge) and
  `read-failed:<msg>` (a thrown or `ok:false` read, previously silent on BOTH paths).
- `src/remittances.jsx` captures `reason` per row and passes it to `reconcileMsrRow`,
  which appends the why as a second flag on a `no-items` block. Status/total/selection
  are untouched; it only explains.
- `src/invoices.jsx` now calls the shared helper and also reports a failed read, which it
  previously returned on with no banner at all.

## What is left, and it is DATA, not code

71 work orders have a legacy sheet parked outside their WO folder. Gailardia's sits in a
hand-made `05-28` folder under the property root, with a hand-made filename: the app names
its own copies `<address> Bid DD-MM.xlsx` and writes them straight into `WO <num>`, so
that folder was never app-created. Those 71 stay invisible until someone opens the WO,
uses "Go to folder", and moves the sheet in. That is a filing chore with a human deciding
which WO each sheet belongs to, which is exactly the judgement the code refuses to fake.

Do NOT write a migration that guesses. Same reason as above.

## Acceptance

- Gailardia WO 03984200 reports `no-wo-folder` and tells the user what to do. Silence is
  the failure; a guess would be worse.
- The 179 that work today must be unchanged. Measure before and after with the same walk.
- No work order gains line items whose total contradicts a paid remittance amount.
  MEASURED 2026-08-31 in `test/reconcile-msr.test.js` ("acceptance 3" cases): a block whose
  lines sum under, over, or one cent off the paid amount reports `off`, and the bill gate
  (`orderId && status === 'match' && lines.length`) withholds it. An unmatched paid row is
  never billable even when it carries lines. `selectBidItems` picking the sheet set closest
  to paid was already covered in `test/bid-select.test.js`; this covers what happens after.
