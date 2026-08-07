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
- S1: W1 + W5 (DONE, d7aeebc).
- S2: W2 (master pointer + fallback rewire) — DONE, 0cd680b. Unblocks safe General teardown.
- S3: W4 + W6 (modal edit + page edit) — BUILT 2026-08-06, gate green, NOT live-verified.
- S4: W3 (drag-drop merge) — BUILT 2026-08-06, gate green, NOT live-verified.

## Gate
`npm run verify` per slice. New pure logic (mergeCatalogAsPage, renamePage, master-pointer
fallback) gets logic tests via test/_load.js. Modal + drag = live-verify in app, not
static read.

## Progress 2026-08-06 (S3 + S4) — gate green, NOT committed, NOT live-verified

One builder spawn built W4 + W6 + W3. `npm run verify` GREEN: 33 pass / 0 fail / 1 skip
(skip = msr-extract, fixtures absent, pre-existing). Build ok. ESLint 0 err.

- orders-logic.js: `renamePage` (:1114), `deletePage` (:1122, non-destructive — nulls
  item.page, items survive), `mergeCatalogAsPage` (:1157). All React-free, immutable,
  order-preserving. Logic-tested: test/rename-page.test.js, test/merge-catalog.test.js.
- invoices.jsx: `AddServiceItemModal` -> `ServiceItemModal({mode,initial})` (adds
  material/labor/taxable, prefill on edit). Item rows now READ-ONLY; edit (✎) button in
  the width col opens the modal; `saveFromModal` patches same-catalog / MOVEs on
  catalog-change. `mergeCatalogs` (drag catalog onto catalog, confirm-gated).
  `renamePageAt`/`deletePageAt` on sidebar page sub-entries.
- DEVIATION (dispositioned APPROVED): `mergeCatalogAsPage(lib,src,dest,opts)` took a 4th
  `opts={builtins,master}` param instead of importing LIBRARY_TABS/masterCatalog.
  orders-logic.js must stay React-free (constants.js only); importing app.jsx would pull
  the renderer into every logic-test bundle and break test/_load.js isolation. UI passes
  `{builtins:LIBRARY_TABS, master:masterCatalog}`; tests pass them explicitly.
- STATIC-REVIEWED (main thread): MOVE branch idx-space consistent with updateItem; merge
  guards mirror the pure fn + confirm-gated; no A5 inline component (renderCatBtn stays a
  fn). Pure logic is the tested floor.
- NOT LIVE-VERIFIED (cannot headlessly): modal open + save/move round-trip, HTML5
  drag-drop merge, sidebar page rename/delete prompts. Needs Electron live drop (USER).
- NOT COMMITTED: commit = architect/overseer + human authority. Dirty AMH tree
  (amh-runner.js, amh-pw-login.js, package*) left untouched — do NOT stage it with this.
- S3 LIVE-VERIFIED in app by USER 2026-08-06. PASS.

## Progress 2026-08-06 (S5) — right-click menus + persistent empty containers

User request post-S3/S4: right-click context menu on catalogs (Rename/Delete/Set master/
New page) and pages (Rename/Delete/New section). Decision LOCKED via AskUserQuestion:
"empty container" (persistent zero-item pages/sections), NOT seed-on-first-item. 2nd
builder spawn human-granted through the spawn-limiter gate. `npm run verify` GREEN: 34
pass / 0 fail / 1 skip (msr-extract, pre-existing).

- TWO NEW STORES (settings, mirror librarySubCats): `libraryPages` = `{[catalog]:string[]}`
  (declared empty pages); `librarySections` = `{[catalog]:{[pageKey]:string[]}}` (pageKey
  '' = the no-page/L1 view). app.jsx getters+setters ~3977, passed to ServiceLibrary ~6318.
- orders-logic.js: six pure immutable helpers ~1127-1176 — addPage/removePage/
  renamePageInStore + addSection/removeSection/renameSectionInStore. Return input ref
  unchanged on blank/no-op. Logic-tested: test/library-containers.test.js (24 assertions).
- invoices.jsx: `pages` memo unions libraryPages[tab]; `seedSections` + `grouped` seed
  empty section buckets so a zero-item section renders its header; empty-state guard
  (filtered==0 && seedSections==0) so a sections-only page still shows the table. In-file
  context menu (MenuItem/MenuDivider + viewport-clamp ported from WOContextMenu, capture-
  phase outside-close ported from detail.jsx). renamePageAt/deletePageAt/deleteTab sync
  the new stores. mergeCatalogs leaves src store entries orphaned (commented, no cascade).
- STATIC-REVIEWED (main): union dedup/sort, grouped early-return guard, empty-state guard
  all correct. Pure helpers are the tested floor.
- NOT LIVE-VERIFIED: menu open/positioning/outside-close, the prompts, empty page in
  sidebar + zero-item section header. Needs Electron live drop (USER).
- NOT COMMITTED.

### BUG (2026-08-06, live-reproduced) — menu items functionless. FIXED + LIVE-VERIFIED 2026-08-07.
FIX APPLIED (builder spawn, invoices.jsx:167 + :678). npm run verify GREEN: 34 pass /
0 fail / 1 skip (msr-extract, pre-existing). LIVE-VERIFIED by USER 2026-08-07: menus work,
service library aesthetically improved. S5 COMPLETE.

Reproduced in the http-server build (Browser pane, Service Items module): right-click a
catalog opens the menu correctly, but clicking ANY item (Rename / New page / Set as
master) does nothing. Disambiguated live: "Set as master" (pure state, no modal) also
no-ops, so the item onClick never fires (not a modal-dismiss race).
ROOT CAUSE: the outside-close listener in invoices.jsx (~166) is registered CAPTURE-phase
on document for 'click'. React 18 delegates onClick at the #root container (below
document). On a menu-item click the capture listener runs FIRST, setCtx(null) unmounts the
menu, and the item's delegated onClick never dispatches. The item's stopPropagation cannot
help — capture already ran. (The ✎/× inline affordances work because no menu is open when
they are clicked, so no close listener is active.)
FIX (two edits, invoices.jsx, NOT yet applied — coder-role gate + spawn ceiling this
session):
  1. close listener: ignore clicks inside the menu so the item handler can run —
     `const close = (e) => { if (e && e.type === 'click' && menuRef.current &&
      menuRef.current.contains(e.target)) return; setCtx(null); };`
  2. menu container div (~678): add `onClick={() => setCtx(null)}` so choosing an item
     closes the menu AFTER its action runs.
Verify: rebuild renderer, reopen Service Items, right-click General -> New page here ->
prompt appears; Set as master -> star moves. Then npm run verify.
