# Service Library Rework — Scope

Status: SCOPED 2026-08-06. Slice 1 (W1+W5) in build under plan
plan-2026-08-06-service-library-rework-slice-1-p. Decisions locked via AskUserQuestion.
Builds on the live 3-level model (catalog > `page` > `subCategory`) already shipped
(see service-library-categories.md for that history).

## Data model (as-built, verified in code)

- **Catalog (L1)** = top-level key in the `service_library` object.
  `LIBRARY_TABS` (app.jsx) pins built-ins; any other key = custom catalog.
- **Page (L2)** = `item.page`. Sidebar sub-entries (invoices.jsx:331), filterable
  (invoices.jsx:166). The nesting field.
- **Sub-category / Section (L3)** = `item.subCategory`. Section header rows.
- Item fields: `name, desc, price, material, labor, subCategory, page, taxable, manual`.
- UI mislabels catalogs as "category" ("+ New category" at invoices.jsx:398 creates a catalog).

## General is load-bearing (why C1 is not a one-liner)

`General` is the generic cross-catalog fallback: any WO can pick General items when its
own PM catalog misses. Hardcoded `library.General` reads at invoices.jsx:611
(`generalCatalog`), remittances.jsx:118 (`genLib`), app.jsx:5123 (invoice build path).
Plus the `agreement:'General'` sentinel = the non-contract tax bucket (resolveBidLine:
AMH/MSR -> RED flag, everything else -> YELLOW). That sentinel is NAME-AGNOSTIC (flag keys
off "is it AMH/MSR", tax keys off catalogTax() which returns DEFAULT for any non-AMH/MSR
name). So the agreement string stays literal `'General'`; only the item-SOURCE reads rewire.

## Locked decisions

1. General: UNPIN (drops from PM group to Custom; rename/deletable). User disassembles it
   into SML manually. SML already exists as a custom catalog.
2. Master pointer: the generic-fallback role must move off General onto SML, else deleting
   General breaks WO item fallback. Add a settable `masterCatalog` pointer (default 'General').
3. AMH/MSR: stay pinned (rename breaks CATALOG_TAX lookup, resolveBidLine string compares,
   scraper import target). Not touched.
4. Merge: drag a catalog onto another = nest its items as a `page`, remove the source
   top-level catalog. HVAC, Plumbing -> pages under SML.
5. Item editing: kill inline cell editing; edits happen in a MODAL that can also move an
   item's catalog and/or page. Material/Labor columns hidden when empty.
6. Every hierarchy level editable like items: sections already are (SimpleListEditor,
   renameSubCategory); catalogs (custom) already are (rename/delete); PAGES have NO edit
   UI -> add one (W6).

## Work items

### W1 — Unpin General (C1/C2)  [small]  SLICE 1
- `LIBRARY_TABS = ['AMH','MSR']` (app.jsx). General auto-falls to the Custom group
  (allTabs = [...LIBRARY_TABS, ...extras]); its rename/delete unlock for free (guards key
  off LIBRARY_TABS.includes).
- Collateral (verified safe): `emptyLibrary()` still seeds a General key (shows under
  Custom); `setTab(LIBRARY_TABS[0])` delete-fallback becomes 'AMH'; AddServiceItemModal
  default becomes 'AMH' but defaultCatalog=current tab overrides. orders-logic references
  LIBRARY_TABS in a COMMENT only (no code). Cross-fallback `library.General` unchanged
  (General still exists) so no fallback break in this slice.

### W5 — Hide Material/Labor when empty (C4)  [small]  SLICE 1
- `showBreakdown = items.some(it => (it.material != null && it.material !== '') ||
  (it.labor != null && it.labor !== ''))`. Uses `items` like showDescCol/showSubCol.
- Gate the two `<th>` (invoices.jsx:420-421) and two `<td>` (442-443) on showBreakdown.
- colCount (invoices.jsx:182): replace fixed `2` for Material+Labor with `(showBreakdown?2:0)`.
- Mirrors existing showDescCol/showSubCol pattern. Low risk.

### W2 — Master-catalog pointer (C1)  [medium]
- New setting `masterCatalog` (string, default 'General'), stored like `librarySubCats`.
- Rewire the 3 item-SOURCE reads to `library[masterCatalog]`: invoices.jsx:611,
  remittances.jsx:118, app.jsx:5123.
- ALSO: the hardcoded else-bucket tabName mapping (invoices.jsx ~607, app.jsx tabOf ~5121)
  MUST follow masterCatalog too — else a torn-down/emptied General becomes the OWN catalog
  of every non-AMH/MSR WO. The agreement label (invoices.jsx:623) follows it as well.
  Safe because name-agnostic: tax = catalogTax DEFAULT for any non-AMH/MSR name, red/yellow
  flag keys off is-AMH/MSR — so the pointer changes WHICH catalog is generic, not tax/flag.
- UI: "Set as master library" action + star marker on the designated catalog button
  (renderCatBtn). Setting it to SML lets General be deleted safely.
- CATALOG_TAX: no change. catalogTax('SML') returns DEFAULT = identical to General entry.

### W3 — Catalog merge-as-page, drag-drop (C3)  [medium]
- Pure `mergeCatalogAsPage(lib, src, dest)` in orders-logic.js: move each `lib[src]` item
  into `lib[dest]` with `item.page = src` (if item already has a page, prefix
  `src + ' / ' + page`); delete `lib[src]`. Guards: src not in LIBRARY_TABS; dest exists;
  src !== masterCatalog.
- UI: draggable catalog buttons (HTML5 draggable + onDrop) in renderCatBtn (invoices.jsx:299
  — a plain fn, not a component, so no remount). Drop src->dest -> confirmDialog -> merge.
- Test: new merge case (patterns from rename-catalog.test.js / migrate-library.test.js).

### W4 — Item edit modal, no inline (C5)  [large]
- Generalize AddServiceItemModal -> ServiceItemModal({mode:'add'|'edit', initial, ...}).
  Add fields it lacks: desc, price, material, labor, taxable (it already has catalog,
  subCategory, page). Prefill from item on edit.
- Table rows become read-only display cells. Row click / edit button (reuse the width-34
  col, invoices.jsx:460) -> open modal in edit mode. Keep delete.
- Save-edit: same catalog -> updateItem(i, patch). Catalog changed -> remove from old key,
  prepend to new key (move). Page/subCategory change = patch.
- Removes inline handlers at invoices.jsx:437-459.

### W6 — Page edit (level-parity)  [medium]
- Pure `renamePage(lib, catalog, oldPage, newPage)` (re-key `item.page` for matching items,
  mirror renameSubCategory) + `deletePage` (null the page or drop items, confirm).
- UI: rename/delete affordance on page sub-entries in the sidebar (invoices.jsx:331-339).

## Slice order
- S1: W1 + W5 (IN BUILD).
- S2: W2 (master pointer + fallback rewire) — unblocks safe General teardown.
- S3: W4 + W6 (modal edit + page edit — the "edit everything" slice).
- S4: W3 (drag-drop merge) — folds HVAC/Plumbing into SML last.

## Gate
`npm run verify` per slice. New pure logic (mergeCatalogAsPage, renamePage, master-pointer
fallback) gets logic tests via test/_load.js. Modal + drag = live-verify in app, not
static read.
