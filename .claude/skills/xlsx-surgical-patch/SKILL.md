---
name: xlsx-surgical-patch
description: How to safely edit an existing .xlsx file (bid sheet, Excel template, any workbook the user supplied) without destroying it. Use this whenever writing to, patching, or modifying an existing spreadsheet, whenever exceljs or jszip comes up, and whenever touching bid sheet generation. Prevents a known template-corruption bug that has already bitten this project.
version: 0.1.0
---

# xlsx surgical patch

## The trap

Never round-trip a complex xlsx through exceljs. `workbook.xlsx.writeFile()` re-serializes
the ENTIRE workbook, and in doing so silently drops or mangles named ranges, styles, merged
cells, data validation, dropdowns, and macros.

The failure is nasty because it is delayed and quiet: the output opens fine in a viewer and
parses fine in code. Then the user opens it in real Excel and gets "found a problem with
some content", and their template is dead. This already destroyed the Plumbing template.
That is why `patchBidSheet` exists.

## The mechanism

Edit only the target worksheet's XML inside the zip. Every other entry stays byte-identical,
so there is nothing for Excel to object to.

**Working reference: `patchBidSheet` in `main.js` (around line 545). Read it and reuse it.**
It is already correct. A second implementation is a second thing to get wrong.

The shape it follows, and why each step matters:

1. `JSZip.loadAsync(fs.readFileSync(dest))`.
2. **Resolve the sheet by name, not position.** `xl/workbook.xml` maps the sheet name to an
   `r:id`; `xl/_rels/workbook.xml.rels` maps that id to the real `xl/worksheets/sheetN.xml`.
   Hardcoding `sheet1.xml` breaks the moment a workbook has its sheets in a different order,
   which is invisible until it happens.
3. Pull that one entry as a string and regex-patch the cells. `setSheetCell` and
   `setSheetZoom` already exist.
4. `zip.file(target, patchedXml)` writes back only that entry.
5. **Drop inferred folder entries before generating:**
   ```js
   for (const k of Object.keys(zip.files)) if (zip.files[k].dir) delete zip.files[k];
   ```
   JSZip invents folder entries on load, but the original skeleton has none. Skip this and
   the output entry-set no longer matches the original, and Excel notices.
6. `zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })`.

## Verification

A patched xlsx is not verified until it opens in **real Excel**. Not a viewer, not a parser,
not "the bytes look right". Those are exactly the checks that passed while the template was
already corrupt. If you cannot open it, say "static analysis only, not run".

## When exceljs is fine

Building a brand-new simple sheet from scratch: no template, no styles, no named ranges.
That is the only case.
