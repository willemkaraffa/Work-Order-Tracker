# MSR tax accuracy - abstract of the proposed fix

Status: PROPOSAL, revision 9. Slice 1 plan approved; this document is step 1 of it.
All decisions ruled, nothing open.
Revision 8 added section 7a: the labor/material split is MSR-only and must never be
applied to AMH Premier pricing.
Revision 9 **retracts a false claim inside 7a** that was drawn from a test fixture rather
than from captured data, and records **D7: AMH stays untaxed for now**, by ruling.
Date: 2026-08-27

**HOLD, procedural.** A second session is active and `.plan.json` holds one plan at a
time. Opening a plan for this work would overwrite the in-flight Admin S3 plan. This
document waits until that session finishes; nothing here touches the repo meanwhile.
Intended home: `roadmap-handoffs/msr-tax-accuracy.md`, once this work has its own plan.
Standing: this is tax information. Every rule below is written to be defensible on its
own, not to make a total come out right.

**Revision 4 retracts one of my own proposals.** Fix 3 as written in revisions 1 to 3
("accept an item's identity even when the price differs") is now measured against 68 real
remittance lines from your own history and is **unsafe under the labor-only tax model**.
Detail in section 5. The reported symptom is still fixed, by a different and safer route.

---

## 1. The question: does "tax-inclusive" mean "post-tax"?

Yes. Two phrases, same thing from opposite ends.

MSR saying their prices are tax-inclusive means the number on the bid sheet is the
**final, after-tax number**. Tax is already inside it. Nothing is added on top. What MSR
pays equals what the sheet says.

1. Price is a **post-tax (gross) figure**, not a base price.
2. Reporting tax means **splitting the existing price**, never increasing it.
3. Splitting never changes the sum, so **reconciled totals cannot move**.

The app treats "price includes tax" as reason to report **no tax**, when it is reason to
report **tax pulled out of the price**. Backwards for most MSR items.

Rate: 7.25%, North Carolina, constant (D5).

---

## 2. The tax model, as ruled

**D1 ruling: tax applies to the LABOR portion only.** Material already bore sales tax at
purchase. Taxing the whole price would tax material twice.

```
face price     =  material portion  +  labor portion
labor portion  =  pre-tax labor  +  embedded tax        (labor portion / 1.0725)
reported tax   =  labor portion  -  pre-tax labor
line total     =  material + labor portion  =  face     (unchanged, always)
```

### Proven feasible on your live library

MSR catalog as stored on this machine, 173 items (120 HVAC + 53 Plumbing):

- **150** carry numeric material AND labor.
- **19** are labor-only (material reads "Included"): diagnostics, cleanings.
- **4** are material-only (labor reads "Included"): refrigerants.
- **173 of 173** check out. Where both sides are numeric, material + labor equals price to
  the cent, zero exceptions. Where one side reads "Included", the numeric side equals
  price exactly. **No row is missing the data this model needs.**
- Labor is **31.5%** of catalog value.

Today's stored flags by contrast: **14 items marked as carrying tax, 159 marked as
carrying none.**

### What the ruling is worth, on real items

| Item | Face | Material | Labor | Tax, labor-only | Tax if whole price | Tax today |
|---|---|---|---|---|---|---|
| Diagnostic Fee | 85.00 | Included | 85.00 | 5.75 | 5.75 | 5.75 |
| Clean Condenser | 150.00 | Included | 150.00 | 10.14 | 10.14 | 10.14 |
| Sump Pump | 400.00 | 0.00 | 400.00 | 27.04 | 27.04 | 27.04 |
| 3 Ton AC Condenser | 2272.30 | 1772.30 | 500.00 | **33.80** | 153.61 | **0.00** |
| 3 Ton Heat Pump Full Replacement | 5321.76 | 3871.76 | 1450.00 | **98.02** | 359.75 | **0.00** |

Service work is unaffected by the choice. Equipment work differs 4x to 5x, and today
reports zero.

### Two rules the model needs

**2a. Bid price differs from list price.** The split scales **proportionally**, never as
absolute dollars. An item listed 1772.30 material / 500.00 labor is 22.0% labor, so a
line billed at another figure keeps that 22.0% labor share. Absolute dollars would break
the "total never moves" guarantee.

**2b. Lines with no library counterpart.** Covered in section 6 (D6).

---

## 3. What the app does today

Three rules decide a line, and they disagree.

**Rule 1 - agreement rule.** The app knows MSR is tax-inclusive and knows how to divide
tax out. It divides the **whole** price, which your ruling now overrides.

**Rule 2 - per-item flag.** On import the flag was set by reading scope wording: *if
wording mentions tax, mark item as carrying no tax*. Inverted. "Price includes applicable
taxes" is precisely the signal that the item IS tax-bearing.

**Rule 3 - fallback rule.** For an unmatched line the app guesses labor vs material from
wording. Under the old model that guess wrongly decided **whether tax exists**. Under the
labor-only ruling it gets an honest job: deciding the **labor share** of a line with no
library counterpart. Section 6.

Live proof of the inconsistency, from your own stored remittances:

| Line | Price | Recorded tax |
|---|---|---|
| `Unclog Main Sewer Line with Power Auger` (matched) | 300.00 | **0.00** |
| `Replace toilet` (unmatched) | 311.27 | **21.04** |
| `Tub/Shower Trim Kit with Valve` (matched) | 328.70 | **0.00** |
| `Service Call` (unmatched) | 85.00 | **5.75** |

Two plumbing lines of near-identical size, opposite tax treatment, decided by whether the
matcher happened to succeed.

---

## 4. Measured match rate, real data

68 MSR remittance lines recovered from your stored history, re-resolved against the
current library:

- **38 match** a library item (56%).
- **30 fall to a generic sentinel** (44%).

Breaking down the 30:

- **1** is a quantity line, `(2x) Clean Condenser` at $300. Fix 6 recovers it (section 5).
- **~4** are vocabulary misses where the library price already agrees **exactly**:
  `Replace toilet` $311.27 against `Toilet with Wax Ring and Bolts` $311.27;
  `Emergency Call` $135 against `Emergency or After Hours Diagnostic Fee` $135;
  `to instal new wax ring while resetting toilet` $99.07 against `Wax Ring and Bolts`;
  `Clean Condenser Coil` $150 against `Clean Condenser` $150. Fix 4 recovers these, and
  price still confirms them, so recovery is safe.
- **13** are genuinely custom scope with no library counterpart at any price
  (`Labor to seal and repair ductwork` $265, `Material - 3-way diverter` $18, and so on).
- The remainder are custom scope whose price coincidentally collides with an unrelated
  item.

---

## 5. Retraction: why old Fix 3 is unsafe

Revisions 1 to 3 proposed accepting a matched name even when the price differed, so that
a price-off line would still record as an MSR item. Measured against the real lines, the
suspect lists that proposal would have adopted are **mostly the wrong item**:

| Real bid line | Price | What it would have been named |
|---|---|---|
| `Labor to dig holes to locate broken pipe in yard...` | 400.00 | `Cut Sheetrock` @ 40 |
| `Labor to remove water from air handler cabinet` | 50.00 | `1.5 Ton Air Handler` @ 1961.96 |
| `Labor to cut sheetrock, remove corroded gas pipes...` | 325.00 | `Showerhead: 3 Spray` @ 35.47 |
| `to repair condensate line by replacing tubing...` | 145.00 | `Seal Shower with Silicone` @ 15 |
| `Labor to clear sewer drain` | 250.00 | `Clear Sink Drain` @ 50 |

Under the old model a wrong name was a cosmetic problem. **Under the labor-only model the
identity carries the tax basis**, so adopting `Cut Sheetrock` onto a $400 pipe dig imports
that item's material/labor ratio and produces a wrong tax figure on a tax record. That is
the opposite of the goal.

**Revised Fix 3: the price gate stays.** A price-off match remains a **suspect requiring
human confirmation**, through the flag dialog that already exists. Identity is never
auto-adopted on wording alone.

The reported symptom is still fixed, by two safer routes:

- `Condenser cleaning` already matches at the agreed price. Verified.
- `(2x) Clean Condenser` at $300 is a **quantity** problem, not a matcher problem.
  Normalizing to 2 x $150 makes it confirm cleanly against `Clean Condenser`, **with no
  flag and no loosening of the price gate**. Verified by running it.

That is the better trade: raise match quality so price can still confirm, rather than
lower the bar for what counts as a match.

---

## 6. D6 explained, and answered by your own data

**Clarifying what D6 is, since it read as something else.** It is not a proposal to skip
matching free-text lines. Free-text lines that correspond to a price-agreement item
**must** match, and raising that rate is exactly what Fixes 4 and 6 do.

D6 concerns only the residue: lines with **no counterpart in the agreement at all**.
Measured, that is **13 of 68 lines**. Examples straight from your history:

```
Labor to seal and repair ductwork                 265.00
Labor to cut sheetrock, remove the corroded gas pipes, seal ...   325.00
Material - new waterline section                   60.00
Material - 3-way diverter                          18.00
materials for silicon, paint, sealant              45.00
```

None of these exist in the MSR agreement, at any price. They are one-off scope the
technician wrote by hand. The labor-only tax model needs a labor share for them, and
there is no library row to take it from.

**The answer is already in your own writing convention.** Of those 13 lines, **8 lead
with "Labor" or "to", 5 lead with "Material"/"materials", and zero are ambiguous.** You
already separate labor and material by hand in the free-text box.

**So D6 resolves to: read the convention you already use.** A line leading with "Labor"
or a verb is 100% labor and fully taxed. A line leading with "Material"/"materials" is
100% material and untaxed. The app already contains this exact heuristic; it is currently
being used for the wrong purpose (deciding whether tax exists) and gets the right one.
Anything that fits neither pattern is flagged rather than guessed.

That is 13 of 13 correct on real data, not a guess.

**RULED 2026-08-27: confirmed. Materials are not taxed, because sales tax was already
paid at purchase.** Same principle as D1, applied to lines with no library counterpart.
D6 closed.

---

## 7. D2 answered: RazorSync is the record, and what that forces

**Your ruling: RazorSync is the official invoice record. This app is a single pane of
glass for you, never a source of truth, and prices come from the PM agreements.**

That settles ownership and creates one hard requirement: **the tax figure has to be right
inside RazorSync**, not merely right in this app. The app's job is to hand you numbers
that enter correctly.

The conflict is mechanical. RazorSync applies tax **per line**, from the catalog item.
Under labor-only, an equipment line is a **mix**: taxed labor plus untaxed material. One
RazorSync line cannot represent both.

- **A single line with "MSR!" taxable** applies 7.25% to the whole price, which taxes
  material. Your D1 ruling forbids that.
- **A single line with "MSR!" untaxed** (today) records zero tax on work that carries
  tax.

So a mixed line must enter RazorSync as **two lines**:

```
material portion   ->  non-taxable catalog item, at the material amount
pre-tax labor      ->  taxable catalog item, at labor / 1.0725
                       RazorSync adds 7.25% and the two lines total to the face price
```

Entry burden is smaller than it sounds. The **19 labor-only items** (diagnostics, all
cleanings) and the **4 refrigerants** stay single-line. Only equipment lines split, and
those are the minority of what a WO carries.

**No new mechanism needed.** The app already tags each line with a RazorSync catalog name
and already walks the fields in entry order for one-click copying. It would emit two rows
for a mixed line instead of one.

**RULED 2026-08-27.** A non-taxable material catalog item exists in RazorSync, named
**`Materials!`**. `MSR!` is to be switched to taxable, and that switch happens **when the
two-line copy ships, not before**: a taxable `MSR!` against today's face-price copy would
tax material immediately, the exact error D1 exists to prevent.

Catalog names verified against RazorSync: `Materials!`, `Labor!`, `MSR!`, all spelled
exactly as the app emits them. No rename needed. Nothing open here.

---

## 7a. AMH: RULED, leave untaxed for now

**D7, RULED 2026-08-27: AMH lines stay untaxed. Deliberate deferral, not an oversight.**

Reasoning, the user's: AMH Premier prices are post-tax, same as MSR. An accurate tax
record would therefore need the same labor/material split. **AMH publishes no
labor/material breakdown of Premier pricing**, and the columns that look like one are
internal cost basis (below). With no defensible split available, reporting a made-up one
on a tax record is worse than reporting none.

Revisit only if AMH ever supplies a real Premier breakdown. Until then AMH tax reporting
is knowingly incomplete rather than knowingly wrong.

This makes AMH out of scope for every slice of this work, by ruling rather than by
omission.

### Supporting detail

**Your constraint is correct and the code already says so.** `library_io.js` records that
AMH columns B and C are **internal cost basis**, that they deliberately do NOT sum to
column D (Premier Pricing, the sell number, roughly (B + C) x 1.6), and it warns in
writing against "fixing" them to add up. Feeding that split into a tax calculation would
compute tax from our own cost, not from what AMH pays. It must never be used as a tax
basis.

**How to break down AMH premier prices for tax: you do not. The per-line tax already
exists as data.** Each AMH bid line carries its own `vendorTax`, and the app reconciles an
AMH line as `qty x unitPrice + vendorTax`. There is nothing to derive.

Measured on the 765 AMH bid rows in the live store:

- **742 carry a `vendorTax` value**; 23 predate the field and fall back to an aggregate.
- **391 are taxed, 351 are at zero.**
- Where tax is present the rate is **7.25%** (254 rows land exactly there, the rest are
  rounding noise between 7.24 and 7.30).
- Service call, diagnostic and emergency wording is **effectively always taxed**: 232
  taxed against 5 untaxed.
- Everything else is **mixed**: 159 taxed against 346 untaxed, with no rule derivable from
  the wording.

**CORRECTION, recorded rather than quietly dropped.** An earlier revision of this section
claimed AMH "taxes labor and leaves material untaxed" and cited a contactor line at 300.00
with 21.75 of tax. That came from `test/reconcile-amh.test.js`, a **hand-authored test
fixture**, not from captured data. The real rows read `Replace contactor` at **125.00 with
vendorTax 0.00**. The claim was wrong and the corroboration it offered for D1 is
**withdrawn**. D1 stands on its own reasoning: material already bore sales tax at
purchase.

The practical conclusion is unchanged and now rests on real rows: AMH per-line tax is
**supplied data, not a computation**, so the app must keep carrying it verbatim and must
never derive it. A WO captured before per-line `vendorTax` existed falls back to an
aggregate, and the app already refuses to bill that until it is refetched.

Method note worth keeping: a test fixture is written by the same person as the code, so it
agrees with the code by construction and proves nothing about the world. Live rows only.

Consequence for this work: **AMH needs no split, no model change, and no fix.** It is out
of scope for a reason, not by omission.

Separate matter, noted and not acted on: you consider the AMH cost-basis rows unfit for
the library at all. Removing them is a library cleanup, not a tax fix, and it does not
ride along.

---

## 8. What the fix must not break

- **Paid total does not move.** material + labor portion equals face by construction.
- **No price is ever rewritten.** Quantity parsing obeys this (section 9).
- **AMH untouched.** Not tax-inclusive, carries real per-line tax from the portal.

Penny rounding: dividing tax out drifts a cent, enough to flip a reconciled line from
"matches" to "discrepancy". Tax is derived as face minus pre-tax so the total is the face
by construction.

---

## 9. Quantity: combined bid lines

Bid sheets compress repeat work into one line. **The app never produces a count above 1.**
Both read paths hardcode 1. The main table reads a Quantity column and folds it into
money; the free-text section parses no count at all.

Live example from your history: `(2x) Clean Condenser` at $300 recorded as one line,
matched nothing, and landed as generic labor.

| Bid text | Parsed today | Matched today | After normalization |
|---|---|---|---|
| `(2x) Clean Condenser` $300 | $300, count 1 | NO, red flag | 2 x $150 -> `Clean Condenser`, clean |
| `2x Condenser Cleaning` $300 | $300, count 1 | NO, red flag | 2 x $150 -> `Clean Condenser`, clean |
| `(2) Condenser Cleaning` $150 | $150, count 1 | yes | count 2, needs the rule below |
| `Condenser Cleaning (2 units)` $300 | $300, count 1 | NO, red flag | 2 x $150, clean |

### The safe reading rule

Total-preserving by default. Money reconciles against the remittance and now drives tax,
so a parser guess must never silently move a total.

1. **Library-confirmed.** Item matches at price P, line reads count N, amount A. If A is
   about N x P, the amount is **extended**: unit P, count N. If A is about P, the amount
   is **per-unit**, which would raise the line total, so it is **never applied silently**
   and raises the existing price warning instead.
2. **No library match.** Treat the amount as **extended**: count N, unit A / N. Total
   unchanged, count correct and visible.
3. **Arbiter of last resort.** The paid remittance amount. A reading that reconciles to
   the paid figure is the correct reading. Used to confirm, never to fabricate.

### Constraints

- **No new field.** Lines already carry a count, the money core multiplies by it, and the
  remittance screen already prints "x2". Only the parse is missing.
- **Order matters.** Strip the count **before** matching and **before** de-duplication.
- **De-duplication hazard.** Duplicate collapsing merges two lines when prices are
  cent-equal and one description's words are a subset of the other's, ignoring count. Two
  genuine "$150 Clean Condenser" rows already collapse and lose $150 today, which is
  plausibly why "(2x)" gets written instead. Collapsing must keep the **larger** count.
- **Existing guard reused.** The sheet states its own BID TOTAL and the app already warns
  when captured lines fall short. Correct counts make that a real check.

### IMPLEMENTED (Fix 6, 2026-08-28)

Shipped in `bid-select.js` + `main.js` (`readSheetOtherItems`), covered by
`test/bid-select.test.js`. No new field: the tag below never leaves the module.

- **`extractCount(desc) -> {desc, count}`** (new export in `bid-select.js`). Recognizes
  exactly the four real shapes: leading `(2x)`, leading `2x `, leading `(2)`, trailing
  `(2 units)` and its wordings (`unit`, `units`, `ea`, `each`, `pc`, `pcs`, `x`). The
  marker MUST carry parens or an `x`. A bare leading number is a SIZE in this catalog, so
  `2 Ton Condenser`, `3 - 3.5 Ton Package Unit`, `50 Gallon Water Heater - Gas`, `R-410A`
  and `R22` come back untouched at count 1. Count is capped 1..99, so a year or model
  number cannot become a count. A bare trailing `(2)` is deliberately NOT accepted: it is
  ambiguous with a model note.
- **DIVISIBILITY GUARD (both read paths).** Rule 2 above is applied only when the amount
  in whole cents divides evenly by the count. Otherwise the row is emitted at qty 1 with
  the whole amount. A rounded unit price times the count would not sum back, and one cent
  of drift flips `reconcileMsrRow` from `match` to `off`. In BOTH branches the STRIPPED
  desc still goes out, so the matcher gets a clean library name and the existing price-off
  warning fires downstream where the library actually exists.
- **`parseOtherCell`** now returns `{desc, unitPrice, qty}`. Struck-negative drop,
  warranty drop, packed `$amt desc` segments and the leading no-`$` segment are unchanged.
- **Main catalog table branch** (`main.js`) now pushes `qty: q` at `price / q` instead of
  qty 1 at the extended price, so the unit price is what the library matcher compares
  against. `price` there is already extended (`Line Item Price` = Qty x Total Price, or
  `q * Total Price` on the fallback). Split requires an integer `q > 1` plus the cent
  guard. Service Call canonicalization untouched.
- **Count-aware dedupe.** When two rows collapse, `dedupeLineItems` keeps the LARGER qty.
  It used to keep the first row's qty, so a restated line silently lost its count.
- **SAME-SECTION rows no longer collapse.** `main.js` tags each row it builds with an
  internal `src` (`'table'` or `'other'`); `dedupeLineItems` refuses to merge when both
  rows carry a tag and the tags are equal, and a merged row remembers EVERY section it
  absorbed. Two hand-written `$150 Clean Condenser` lines inside OTHER are genuine repeat
  work worth $300; the duplicate the fuzzy dedup exists for is a main-table row restated
  in OTHER, i.e. across sections. Untagged rows (every other caller, and the pre-existing
  tests) collapse exactly as before, and `src` is never emitted on the returned items.

**Live evidence for the integer guard**, measured across all 424 real bid workbooks under
the WORK ORDERS tree: only 2 main-table rows carry Quantity > 1 at all, and 1 of those is
`R410a q=1.25 $62.50`. Quantity in that column is sometimes a MEASURE (pounds of
refrigerant), not a count, which is exactly why the split requires `Number.isInteger(q)`.
Without it that row would have reported a count of 1.25. The other row is an integer
quantity whose extended cents divide evenly, so the branch does fire on real data.

---

## 10. Proposed fix

**Fix 1 - agreement decides, split sizes it.** Tax is embedded in the labor portion of
every MSR line and divided out of that portion. The per-item yes/no flag stops being the
deciding vote.

**Fix 2 - stop stored flags contradicting the model.** Repair the inverted import rule,
and for MSR derive the flag from the split so stored data cannot disagree with what is
reported. Reversible: a re-seed, prices untouched.

**Fix 3 (REVISED) - identity stays price-gated.** A price-off match remains a suspect for
human confirmation. What changes: a confirmed match now also carries its material/labor
split onto the line, since that is the tax basis. See section 5 for why the original
version was withdrawn.

**Fix 4 - close the vocabulary gap.** Bridge verb and noun forms ("replace" /
"replacement", "install" / "installation") so a line named either way reaches its library
item. Recovers about 4 of the 30 unmatched real lines, all at prices that already agree,
so price still confirms them. Also ends the silent no-flag disappearance where a line
matches nothing and raises nothing.

**Fix 5 - anchor the total to the paid amount.** Total is the face value, not the sum of
rounded parts.

**Fix 6 - parse quantity.** Section 9. Recovers the `(2x)` case cleanly and is the safe
route to the reported symptom.

**Fix 7 - two-line RazorSync entry for mixed lines.** Section 7. Material portion under
the non-taxable `Materials!` item, pre-tax labor under a taxable `MSR!`.

---

## 11. Considerations solidified

**11.1 The money core cannot express this model yet.** A line carries a yes/no flag and
the whole price is divided. Labor-only needs a **taxable base per line**. Cleanest reuse:
carry `material` and `labor` onto the line under the same names the library already uses,
rather than inventing a new "taxable base" concept.

**11.2 Tax gets written in six places.** Library import, the resolver's fallback path, its
confirmed-match path, the manual item form, the blank-line default, and the flag-resolve
dialog each set the flag independently. That is how this drifted. The fix belongs in
**one derived rule consumed by the money core**. Consequence: for a tax-inclusive client
the per-line tax checkbox stops controlling anything, so it must be shown as inert.

**11.3 PM dominance, your rule.** Already half implemented: a remittance run stamps every
line with the PM and searches that PM's catalog first. The leak: when the PM catalog
misses, a general item can confirm identity and hand over its own tax basis while the line
still reads MSR. Rule: **in a PM remittance, only that PM's catalog may confirm identity
or supply a tax basis. General may only offer suspects for review.**

**11.4 Service call handling unchanged.** Service call, diagnostic and emergency wording
is forced taxable everywhere. Under labor-only that is consistent: those library items are
labor-only, so they were already 100% taxable.

**11.5 Recompute is the default (D3, D4), so historical figures WILL change once.** Take
a snapshot of current numbers before shipping so the change is auditable rather than
merely trusted.

**11.6 No shippable test fixture.** Real bid sheets carry resident data and stay out of
the repo. Rules get proven on the pure functions plus a replay against your sheets on your
machine. The 68 stored remittance lines used throughout this document are the same idea
and stay local.

---

## 12. Decisions

- **D1 - Tax base. RULED: labor portion only.** Material already bore tax at purchase.
- **D2 - RazorSync. RULED: RazorSync is the official record; this app is a viewing
  console.** Forces two-line entry for mixed lines. Three confirmations still needed,
  section 7. Do not flip the taxable setting yet.
- **D3 - Sent invoices. RULED: recompute.**
- **D4 - Stored remittance reports. RULED: recompute.**
- **D5 - Rate. RULED: 7.25% constant.** Revisit only if work starts in another county.
- **D7 - AMH. RULED: leave untaxed for now.** Premier prices are post-tax like MSR, but
  AMH publishes no labor/material breakdown to split them by, so no defensible tax figure
  exists. Knowingly incomplete beats knowingly wrong. Section 7a.
- **D6 - Lines with no agreement counterpart. RULED: materials untaxed, sales tax already
  paid at purchase.** Read the convention already in use: "Labor"/verb lead = 100% labor
  and taxed, "Material" lead = 100% material and untaxed, anything else flagged. 13 of 13
  correct on real lines.

- **D2 follow-ups. RULED.** RazorSync's non-taxable material item is `Materials!`;
  `MSR!` becomes taxable when the two-line copy ships. Catalog names match the app
  exactly, no rename needed.

**Every decision is ruled and nothing is open. Fixes 1 through 7 are ready for the
architect**, held only on the plan slot.

---

## 13. How it gets proven

1. Existing invoice and remittance suites pass, since totals must not move.
2. For a tax-inclusive client: reported total equals paid amount, and reported tax equals
   the labor portion's embedded tax, across matched, unmatched and material lines.
3. Split scaling: a line billed off list keeps the library's labor **share**, total still
   equals the bid.
4. Identity: a price-off match stays a suspect and is never auto-adopted (the retraction
   in section 5 gets a test, so it cannot creep back in).
5. Quantity: each wording in section 9. Count correct, total unchanged in the default
   reading, any total-changing reading warns instead of applying.
6. De-duplication: two genuine same-price lines do not collapse; one line restated across
   both sheet sections still does.
7. Replay the 68 stored remittance lines before and after: per-line totals identical, only
   the tax column moves, and the match count goes up rather than down.
8. Full project verification gate.

---

## 14. Out of scope

- AMH tax handling. Section 7a: AMH supplies per-line tax itself, and its library
  material/labor columns are internal cost basis that must never be read as a tax basis.
- Removing the AMH cost-basis rows from the library. A cleanup, not a tax fix.
- Any change to bid prices, invoice amounts, or what is billed.
- Service library category restructuring.
- Teaching the matcher from confirmed pairings. A feature, not a correctness fix.
- Per-county tax rates (D5).

---

## Appendix A - implementation notes

- Tax policy: `src/constants.js` `CATALOG_TAX`, MSR already `taxableInclusive: true`.
  `computeInvoiceTotals` (`src/orders-logic.js` ~915) does `unit / TAX_RATE` on the whole
  taxable unit price. Labor-only replaces that with a per-line taxable base.
- Six writer sites: `library_io.js msrTaxable` / `plumbingSeedItems`, `resolveBidLine`
  sentinel path, `resolveBidLine` confirm path, `src/invoices.jsx:33` item modal,
  `src/invoices.jsx:811` `blankLine`, `src/invoices.jsx:739` `applySuspect`.
- Inverted import rule: `msrTaxable()` in `library_io.js` (~201),
  `if (/\btax/i.test(prose)) return false;`. `plumbingSeedItems()` (~305) hardcodes
  `taxable: false` for all 53 rows.
- Split data: `parseMsr` reads cols E (material) and F (labor) against G (total);
  `splitFields` stores the string `'Included'` for a blank side, so a consumer must treat
  `'Included'` as "this side is zero, the other side is the whole price", never as a
  number. Verified live: 150 both-numeric, 19 labor-only, 4 material-only, 173/173 summing
  exactly.
- Identity: `resolveInCatalog()` (`src/orders-logic.js` ~968) returns `{ suspects }` on a
  top-group match with no price hit. **That behavior is now KEPT** (section 5). The change
  is that `confirm()` must also carry `material`/`labor` onto the line.
- Vocabulary bridge: `matchTokens()` in `text-normalize.js`, shared by renderer and CJS
  bid path. Stem strips only `(ing|ed|es|s)$`. Measured: `capacitor` idf 3.90 against
  `MATCH_SOLO_IDF` 4.00, a near-miss.
- Quantity parse sites: `readSheetOtherItems` in `main.js` (~899 main table, ~928 OTHER)
  both hardcode `qty: 1`; the main table folds `q * total` into price. `parseOtherCell` in
  `bid-select.js` (~139) emits no qty. Strip markers in both, before `dedupeLineItems`.
- `dedupeLineItems` (`bid-select.js` ~101) gates on cent-equal `unitPrice` plus token
  containment and carries the first row's count only. Make it count-aware.
- Capture-short guard exists: `readSheetOtherItems` returns `statedTotal`;
  `src/invoices.jsx` (~885) compares `unitPrice * qty` against it.
- RazorSync copy walk: `src/remittances.jsx` (~551) emits [catalog name, description,
  pre-tax price] per line via `sentinelTag`. Fix 7 emits two rows for a mixed line.
- Remittance UI already renders `'×' + l.qty` when qty > 1 (`src/remittances.jsx:512`).
- Stale comment: `src/orders-logic.js` ~1073 says "AMH/MSR default FALSE", but
  `CATALOG_TAX.MSR.defaultLaborTaxable` is `true`.
- Suites to lean on: `invoice-totals`, `reconcile-msr`, `catalog-match`, `bid-select`,
  `parse-msr`, `recompute-invoice`.

---

## Appendix B - evidence run this session

Produced by running the shipped code against the live data store.

- Live MSR catalog: 173 items, 14 taxable, 159 non-taxable. Split coverage 150
  both-numeric / 19 labor-only / 4 material-only; material + labor equals price on all
  173. Labor is 31.5% of catalog value.
- 68 real MSR remittance lines re-resolved: 38 matched, 30 sentinel. Of the 30: 1
  quantity, ~4 vocabulary misses at an exactly-agreeing price, 13 genuinely custom, rest
  custom with coincidental price collisions.
- Of the 13 custom lines: 8 lead with "Labor"/"to", 5 lead with "Material"/"materials",
  0 ambiguous.
- `resolveBidLine("Condenser cleaning", 150)` -> `Clean Condenser`. Matches at the agreed
  price.
- `resolveBidLine("Clean Condenser", 175)` -> `Labor!`, red flag, suspect `Clean
  Condenser`. Identity withheld on a price difference, and per section 5 that is correct.
- `(2x) Clean Condenser` $300 -> `Labor!` + red flag today; normalized to 2 x $150 ->
  `Clean Condenser`, no flag.
- `Replace toilet` $311.27 and `Emergency Call` $135 -> `Labor!`, no flag, no suspect,
  despite exact library prices. Fix 4 targets these.
- Worked labor-only vs whole-price tax figures: table in section 2.
