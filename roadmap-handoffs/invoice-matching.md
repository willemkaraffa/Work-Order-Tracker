# Invoice Line Matching + Price Flags — Handoff

Date: 2026-07-06
Goal: turn scraped/entered bid lines into invoice lines with the RIGHT price always,
the right identity when confirmable, and loud warnings when something needs a human.
Money rule: **invoice unitPrice = the BID line price, ALWAYS** (that is what we are paid;
General prices drift up over time, material costs rise). The library supplies IDENTITY
(name) + taxable only, never the charged price.

## Core mechanism (slice 1 — pure logic, DONE/here)

Per bid line { wording, price }:
1. `unitPrice = bid price` (always).
2. **Fallback chain by catalog:** the WO's CLIENT library first (AMH WO -> AMH, MSR -> MSR),
   THEN General, THEN sentinel.
3. Keyword match (price is NOT a gate anymore — it is a CONFIRMER):
   - **Strong keyword in CLIENT lib:**
     - price == library price -> CONFIRMED. name = library name, taxable = library taxable.
     - price != library price -> **RED flag** "price off contract" (AMH/MSR prices are fixed;
       a mismatch is likely an error). Keep sentinel name, `suspects=[item]`, `priceFlag:'red'`.
   - else **strong keyword in GENERAL:**
     - price == library price -> CONFIRMED (general).
     - price != library price -> **YELLOW flag** "price raised/off" (General drift is expected,
       just surface it). Sentinel name, `suspects=[item]`, `priceFlag:'yellow'`.
   - else -> plain **sentinel** Labor!/Materials! (by action verb), no flag.
4. Sentinel Labor vs Material: action verb (replace/install/clear/...) -> Labor!; explicit
   "Material -/:" or NO action verb -> Materials!.
5. Taxable on any sentinel/flagged line = verb rule (Material -> non-tax, Labor -> catalog
   policy). The suspect is surfaced; the user confirms identity/tax via the modal (slice 2).

"Strong keyword" threshold (I own it, tuned vs real bids): shared significant tokens >= 2,
or (>=1 shared AND the candidate name is <=2 significant tokens, i.e. short + distinctive).
Erring toward FEWER false suspects. Validate with the real-data match run each change.

New line fields (no existing field holds these -> justified):
- `suspects: [{ name, price }]` — library item(s) this line resembles but could not confirm.
- `priceFlag: 'red' | 'yellow' | undefined` — off-contract (PM) vs price-drift (General).

## Slice 2 — UI (NOT built; needs the running Electron app to verify)

1. **Line badge:** render a triangle on a flagged invoice line — red (`priceFlag:'red'`) or
   yellow (`'yellow'`). Click opens a **modal** prefilled with the line (name, price, taxable,
   desc) + the `suspects` list; user edits price/name/taxable and Applies, or **Dismiss**
   (clears the flag, keeps the line as-is). Reuse the existing `Modal` component
   (AddServiceItemModal pattern) so it is cheap; if the inline-table -> modal edit proves
   expensive, fall back to one-click-apply-suspect + a dismiss X.
2. **Service-call / diagnostic-fee alert:** if a WO's invoice has NO service-call / diagnostic
   fee line, show a **RED alert** on the invoice (don't lose the service call — has happened
   before). Pure helper `invoiceHasServiceCall(lines)` detects a line whose name/desc matches
   /diagnostic|service (call|fee)/i OR a confirmed catalog service-call item; InvoiceEditor
   renders the alert when false.

## Callers to update (slice 1 wiring)
- `bidItemsToInvoiceLines` gains the general catalog + client agreement so it can run the
  fallback chain (client -> general -> sentinel). InvoiceEditor autofill passes both the
  WO-tab catalog (client) and the General catalog.
- Manual `pickName` (user picks from the dropdown) stays a direct catalog pick (no flag).

## Tests
- `test/catalog-match.test.js` — extend: fallback chain (client hit, client-miss->general hit,
  both miss->sentinel), red flag (PM keyword hit + price off), yellow flag (General hit + price
  off), confirmed uses library name but bid price, tonnage disambiguation by price, tie->sentinel.
- Real-data run (`scratchpad/matchrate.js`) after each change to watch match rate + false-suspect
  rate against the 133 live AMH bid lines.

## Status
- Slice 1 (matcher framework `resolveBidLine` + `invoiceHasServiceCall` + tests): DONE.
  Framework = confirm/suspect/flag, price=bid always, client->general->sentinel. WIRING FIXED:
  InvoiceEditor autofill now passes the General catalog as the 4th arg (fallback chain was
  dead in-app before).
- **Slice 1b — SCORING TUNING: DONE.** IDF-weighted scorer replaced the equal-weight token
  count. Real-data run (scratchpad/matchrate.js, 133 live AMH bid lines):
  red flags 43% (mostly FALSE) -> **9% (mostly real/plausible)**; false CONFIRMS mostly gone.
  Mechanism (src/orders-logic.js `resolveInCatalog`):
  1. IDF over item-NAME tokens only (AMH desc = scope-tab label = noise, dropped). Token in
     ~every item (hvac/replace) ~0; rare token (contactor/txv/schrader) high.
  2. `matchTokens` drops bare numbers (9 lbs !-> 9-GPM) and service BOILERPLATE
     (fee/labor/no/additional/include/... = MATCH_BOILER) so a repeated "- no additional labor
     fee" tail can't read as distinctive.
  3. STRONG = summed shared IDF >= MATCH_MIN_IDF (2.0) AND shared distinctive IDF covers
     >= MATCH_MIN_COVER (0.45) of the candidate's distinctive mass (peripheral-word matches
     like "Diagnostic fee" -> "Main water line..." fail coverage).
  4. CONFIRM only within the TOP-scored group (price disambiguates equal-scored tonnage
     variants); a lower-scored coincidental price-collision does NOT confirm (killed
     "shower valve" $260 -> "Replace Shower Pan" $260).
  Known residual (acceptable, human-in-loop): a few soft single-token reds (furnace/check),
  and rare coverage-gate false confirm when the correct item is a long descriptive name whose
  distinctive mass the terse bid only partly covers. Tunables are named consts at the top of
  `resolveInCatalog`; re-run scratchpad/matchrate.js (`--reds`/`--confs`) after any change.
  Tests: test/catalog-match.test.js + test/invoice-lines.test.js rewritten for IDF (fixtures
  need realistic SIZE + filler; matching is NAME-only now). `npm run verify` green (7 suites).
- Slice 2 (UI badges/modal + service-call alert): BUILT (src/invoices.jsx). Line badge = red/
  yellow triangle on a flagged line -> `FlagResolveModal` (reuses shared Modal): suspect chips
  (pick = name+taxable, keep bid price), editable name/desc/price/category/taxable, Apply
  (writes + clears flag) or Dismiss (clears flag only). `noServiceCall` red alert above the
  table when `invoiceHasServiceCall(lines)` is false. Build + renderer-smoke green; LIVE-VERIFIED
  in Electron (user click-test, 2026-07-07).
- Top data lever (OPEN): AMH is missing the $75 Diagnostic / $90 HVAC Diagnostic service-call
  items (feeds match rate + the service-call alert) — seed them (taxable, pre-tax).
