# Remittance mis-match: 110 Margaret Dr billed as 315 W Barnes St (2026-08-25)

Source file: `Vendor_ACH_Payment_Detail_-SSRS1.pdf` (MSR, 3 rows, statement total 1595.34).

## What happened (traced, not guessed)

The remittance row for 110 Margaret Dr carries a RazorSync GUID in Invoice Notes,
not the usual 8-digit WO number:

```
110 Margaret p5036758  696.27 08/13/2026 PI000376562
Invoice Notes : 3da7f30a-314e-41be-9203-d084ae85744b
```

Chain of failure:

1. `parse_msr_remittance._parse_text` reads the note with `Invoice Notes\s*:\s*(\d+)`.
   That regex accepts the GUID's LEADING DIGIT RUN. Parsed `woId: "3"`.
   Verified by running the shipped parser on the real PDF.
2. `matchMsrRow` normalizes "3" and compares it against BOTH `order.woId` and
   `order.id`. The minted sequential id `WO-003` normalizes to "3".
3. `WO-003` is 315 W Barnes St. Match returned `matchBy:'woId'` (highest confidence,
   no "verify" flag), so the block rendered that address and that WO's bid items
   against a payment for 110 Margaret Dr.

The correct order (`04017255`, "110 Margaret Dr") exists and would have been found by
the address fallback if the bogus WO-number match had not pre-empted it.

Live data confirms 8 orders whose normalized id is under 4 digits (`WO-002`..`WO-006`,
`0629`, `07-09`, `82`) - every one of them is a landmine for a short parsed token.

## Same class, same file

- `_address_in_block` strips a `p######` property code but NOT a bare-numeric one, so
  row 1 parsed `addressRaw` as "129 Awesome 10003006 Ridge". Harmless while the WO id
  matches; it silently breaks the address fallback when the note is a GUID. The junk
  order `82 | 19 Labradoodle 10002980 Court` in live data is that leak already realized.

## Fix

1. Parser: take the WHOLE notes token (`\S+`) and keep it only if all-digits; a
   non-numeric note holds its positional slot as `''` so the row falls through to the
   address match instead of inventing a WO number.
2. Parser: strip the block's own property code from `addressRaw`, numeric or `p`-prefixed.
3. `matchMsrRow`: a normalized WO token shorter than 4 digits cannot be a portal WO
   number - skip the WO-number key for it (defense in depth; the address fallback and
   the "no match" path still run). Applies to AMH too (`matchAmhRow` is the same fn).

Not changed: address-match ambiguity (two orders share "3105 Cinnamon Circle"); an
address match is already flagged "verify".

## Live proof (2026-08-25, real PDF + real wo_data)

Shipped parser re-run on `Vendor_ACH_Payment_Detail_-SSRS1.pdf`, rows fed to the
shipped `matchMsrRow` against the live 675-order store:

```
PI000375096 $449.07 | note:04063139 | -> woId    04063139 / 129 Awesome Ridge
PI000376562 $696.27 | note:(none)   | -> address 04017255 / 110 Margaret Dr
PI000376437 $450.00 | note:(none)   | -> address 04101672 / 3105 Cinnamon Circle
```

The GUID note now parses to '' instead of "3", the row falls to the address match, and
315 W Barnes St is gone. Row 1's addressRaw lost its bare property code
("129 Awesome 10003006 Ridge" -> "129 Awesome Ridge").

`npm run verify`: 41 pass, 0 fail, 1 skip (pre-existing fixture-absent skip).

Open, NOT fixed (out of this plan's scope): two live orders share the address
"3105 Cinnamon Circle" (04101672, 04318759). The address match takes the first and
flags "verify". Also still in live data: junk order `82 | 19 Labradoodle 10002980 Court`
created by the old address leak.
