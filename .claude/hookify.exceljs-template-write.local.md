---
name: block-exceljs-template-write
enabled: true
event: file
pattern: \.xlsx\.writeFile\(|workbook\.xlsx\.write\(
action: block
---

**BLOCKED: exceljs writeFile against a workbook.**

Hard-won lesson (see memory: xlsx surgical patch). Writing a complex xlsx template
back out through exceljs SILENTLY DESTROYS it: named ranges, styles, merged cells,
data validation, and macros are dropped or mangled. The file opens in a viewer but
breaks in real Excel.

**Do this instead:**
- Load the `xlsx-surgical-patch` skill. It has the mechanism.
- Reuse `patchBidSheet` in `main.js` (~line 545). It already does this correctly.
  Do not write a second implementation.
- Never round-trip a template through exceljs.
- Open the result in REAL Excel before claiming it is fixed.

If you are creating a brand-new simple sheet from scratch (no template), this rule is
a false positive: say so explicitly and set `enabled: false` for this one call.
