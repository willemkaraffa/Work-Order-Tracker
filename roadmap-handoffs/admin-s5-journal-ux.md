# Admin S5 -- Journal / Scratchpad UX rework

Blueprint. Accepted by the user 2026-09-01, in the session that closed S4's last
test failure and shipped ruling 4 (`6cde4ce`). S1, S2, S3, J1 and J1b are BUILT;
J2 is BUILT as of 2026-09-03; J3 and J4 are what the live pass on it asked for.

This is a UX rework of the **Scheduling & Admin** module (`src/schedule.jsx`).
S1 through J2 needed no new note field: every value those views show already
exists on the records. J3 breaks that for exactly one reason, stated in its own
section, and the reuse table below still governs everything else.

---

## Where this came from

The user live-tested the whole S4 flag surface and found **no faults**. Ruling 4
(WO history for note add / edit / delete) was verified on a real linked WO. The
changes below are UX, raised after that pass, in the user's own framing:

- Flags are "out of sight". Notes are usually flagged **right after writing**,
  and today that means writing the note, losing it in the list, then finding it
  again to flag it.
- The Journal is "an assault on the eyes upon opening". Too much at once.
- The Calendar is used "very infrequently"; Week shows too much at once and too
  small.

---

## Field reuse (decided, do not re-litigate)

| View concept | Existing field | Where |
|---|---|---|
| Client | `o.pm` | already labelled "Client" in the Invoices table header |
| Property address | `o.address` + `o.city` | as rendered everywhere else |
| WO number | `o.id` | |
| Note -> WO link | `note.woId` | written by the S4 WO picker |
| Pinned | `note.pinned` | existing field; `detail.jsx` already floats pinned first |
| Task flag | `note.flags.task` | S4 |

**No new field, no new list, no parallel state.** If a slice below seems to want
one, that is the signal to re-read this table first.

---

## The slices, in build order (smallest first)

### S1 -- Calendar defaults to Month

Week is the current default. Month becomes the default, so non-WO events set for
later are visible on open. Week stays available.

- Touches: the calendar view state in `src/schedule.jsx` (tab body at `:1083`).
- Verification: one live look. This is a default-value change, not mechanism.

### S2 -- Journal search bar

The Journal has no search. Add one, scoped to **journal notes only**: note body,
WO number, address. Not a cross-tab search.

- Reuse first: `useTypeToSearch` (`src/search-hook.js`) and the existing match
  helpers (`orderMatchesQuery`, `phoneMatches` in `src/orders-logic.js`) already
  do this work elsewhere. Wrap them; do not write a third matcher.
- Touches: the Journal header row at `src/schedule.jsx:997`.

### S3 -- Flags become a composer toolbar

The flag row moves from **below** the note to the **top edge of the writing
field**, like a normal text editor toolbar, in the Scratchpad.

- **Icons, not words**, each carrying a `title` tooltip with the flag name. The
  tooltip is what the app already treats as a tooltip; no new mechanism.
- `flagBar` (`src/schedule.jsx:869`) is already ONE function shared by the pad
  and the Journal editor. Keep it one. This slice changes where it renders and
  how each button is labelled, not how many of them exist.
- **Mint-then-flag (user's decision).** Pad text has no note id until
  `useAutosave` mints one (`src/schedule.jsx:180`). A flag click on unsaved text
  must mint the note FIRST, through the existing hook, then apply the flag. Not
  a second save path, not a second debounce, and not "greyed until saved".
- Load-bearing invariant, unchanged from S4: a write on a note an editor owns
  FLUSHES that editor first (`writeNote`, `src/schedule.jsx:654`). The toolbar
  sits on the pad itself, so this path gets more traffic, not less.

### J1 -- Invert the Journal (BUILT)

The Journal did not read as a journal: the note was relegated to a side panel
and the pane the eye lands on was a list. J1 swaps the two jobs.

- **Main pane = the note.** The editor moved out of the aside INTACT: flagBar
  toolbar, textarea, jump row, plus an empty state when nothing is selected.
  It was MOVED, not rewired -- same `useAutosave` instance built with a null
  `onAdd` (this editor only ever edits an existing note), same `flagBar(jNote)`
  with no mint callback, same Escape handling, same jump row.
- **Aside = the navigator**, still on the RIGHT so the Journal and the Scratchpad
  MATCH rather than mirror. Top to bottom: filter buttons, search box, list.
- **One filter, not two.** `jFilter` (the body's All / Jottings `Seg`) RETIRED.
  The rail's `navFilter` is the only filter over these notes now.
- **One derived list** feeds the rail, and all three filters honour the search
  box (the old split, where only the body list searched, is gone):
  - All: the `journal` memo, newest first.
  - Pinned: notes carrying `note.pinned`, newest first.
  - Tasks: `backlogNotes(notes)` in ITS OWN order (open before done, then oldest
    first). Deliberately NOT the journal sort: it is a worklist, not a feed.
- The old `quickNav` `{ note, pinned, task }` wrapper retired with it. `padRow`
  derives its own flag dots from the note, so nothing downstream needs those
  booleans carried alongside.
- **Rail buttons** use the existing `Seg` with `equal` so they fill the 260px
  rail. Labels are a glyph plus its word, deliberately more prominent than the
  24px flag pills, and the glyphs are the flag work's own: Tasks U+2713 (the task
  flag's glyph), Pinned U+2691 (the pinned dot's glyph), All U+2630.

### J1b -- Split the rails (BUILT)

J1's live pass passed on look. The tooltip, the flag colours and the inset
notepad all landed. J1b is what the same pass asked for next.

- **The inset notepad treatment is LOCKED by user decision.** Detached from the
  edges is settled; SIZE is the only part still open. Do not restyle it.
- **Rail width 260 -> 340.** `asideStyle` in `src/schedule.jsx` is the single
  source, so one number moves both rails. The reason is J2: the Clients tree
  nests Client > Property Address > WO#, three deep, and 260 truncates an
  address hard.
- **Tasks moved OFF the Journal rail and ONTO the Scratchpad rail, as its
  DEFAULT.** The pad is where work gets written down, so the open worklist is
  what that rail should land on. Same `Seg` + `equal` treatment as J1, two
  options: `✓ Tasks` then `☰ Jottings`. Tasks is `backlogNotes` in ITS own
  order; Jottings is `scratchpadNotes`, unchanged.
- **The Scratchpad rail gained a search box**, scoped to its own list, clearing
  on tab change like the Journal's. A filtered list with no search is what J1
  had just finished fixing on the other tab.
- **MEASURED against the live 846-note store, and the user was told before
  choosing:** Tasks 0, Jottings 4, Pinned 59. This rail therefore OPENS EMPTY
  until task flags get used. That is a data state, not a defect (the task flag
  shipped days ago), and the user reaffirmed Tasks-first knowing it. The empty
  state says nothing is open, never anything that reads as broken.
- **Pinned retired as a button and became a SEARCH KEYWORD.** It keeps its name
  and keeps reading `note.pinned`; no new field. In `noteMatchesQuery`
  (`src/orders-logic.js`), a needle of exactly `pinned` matches a pinned note as
  a **UNION** with the existing body and WO matching, never a replacement, so a
  note whose TEXT says pinned is still found and the keyword can hide nothing.
  Measured on the same store: **zero of 846 bodies contain pinned, pin, pending,
  task or star**, so collision risk is nil today and the union is what keeps it
  harmless if that changes. Both search boxes teach the keyword in their
  placeholder and title, because an undiscoverable filter is not a filter.
- **The Journal rail lost its buttons entirely**: search box, count, list. With
  Tasks and Pinned gone only All was left, and a one-option `Seg` is noise.
  `navFilter` retired with them.

### J2 -- The Clients tree (BUILT)

The user's original rail set was **Clients, Tasks, Pinned, All**. J1b resettled
three of those elsewhere: Tasks lives on the Scratchpad rail, Pinned is a search
keyword, and All is simply what the unfiltered Journal rail shows. So J2 adds a
**two-option `Seg`, Clients versus All**, NOT the original four buttons, and
brings back its own filter state (J1b retired `navFilter`).

- Clients is a tree in the rail: `Client -> Property Address -> WO#`. The field
  reuse table above already fixes every field it needs; do not add one.
- Selecting a WO# fills the main pane with that WO's notes.
- The rail is 340 wide as of J1b, sized for exactly this nesting.
- **The collapse rule below governs this slice.** It is the mitigation for the
  risk J1 exists to answer: a tree re-clutters the very surface this rework
  quietened, unless collapse-by-default actually holds.

**Record this before it is rediscovered as a bug:** a note with no `note.woId`
has no client, so it CANNOT appear anywhere under the Clients tree. Those notes
stay reachable under **All**, which is where the retired Jottings population
lives now. An empty Clients tree for a pad-written note is correct behaviour,
not a missing link.

**As built** -- the decisions the blueprint left open, and what settled them:

- **The grouping is pure and lives in `orders-logic.js`**: `clientTree(notes,
  orders)` plus `noteTreeKeys(order)`, the ONE place the keys are composed, so
  the tree's grouping and the router that reveals a branch cannot drift apart.
  Deliberately NOT `splitAddress`: it lives in the React module (a cycle for the
  pure one), and on this store's rows -- where the city sits INSIDE `address`
  and `o.city` is blank -- it parses `"51 Scotch Bonnet Ridge, Clayton, NC
  27520"` into a city of `"NC 27520"`. The tree composes the address the way
  `woAddress` already does in `schedule.jsx`.
- **The tree is built from `navShown`, the search-filtered pool**, so the
  counts it prints always match the list the user is looking at, and the WO
  pane reads `notesForOrder(navShown, jWo)` -- the existing helper, which
  already owns the pinned-first order.
- **All is the DEFAULT**, not Clients. All is the shipped view and the quiet
  one this rework exists to protect; the tree is a lens the user reaches for.
- **The collapse rule is an ACCORDION**: `openClient` and `openProp` hold one
  branch each, which is literally "the branch that was open last". Both start
  null, so every level is collapsed on open, and a child level exists in the
  DOM only while its parent is the open one.
- **Exception 2 is set in the ROUTE, not in an effect.** `openNoteInJournal`
  (the calendar-chip route) resolves the note's WO, switches the rail to
  Clients and expands that branch. An effect watching the selection would
  re-expand on every rail click and fight the user (rules A1/A4).
- **Collapsing a level drops the WO selection but never the open note.** The
  pane would otherwise sit on a list the rail no longer offers; the note, by
  contrast, is the pane's own content, and losing it to a stray disclosure
  click would be a text-loser.
- **Glyph**: Clients takes U+2302, the house -- the property is what the middle
  level is. Free this slice, and All keeps J1's U+2630.

**Measured on the live store before building** (848 notes / 724 orders): 842 of
848 notes carry a resolvable `woId`, so only 6 land under All alone. The tree is
**4 clients** (AMH 252 properties, MSR 222, Other 4, PC 4), **482 properties**,
**544 WOs**. Median 1 note per WO, max 9, and **160 WOs carry more than one** --
which is what makes "selecting a WO# fills the main pane with that WO's notes" a
list and not a shortcut to a single note. `propertyId` was measured as a grouping
key and REJECTED: only 274 of the 544 rows carry one.

**Verified**: `npm run verify` green (lint 0 errors, renderer build, 53 pass / 0
fail / 1 skip). `test/journal-client-tree.test.js` covers the pure grouping;
The mount probe that covered this slice was later extended to J3, began to hang,
and is now PARKED as `test/_probe-s5-clients-tree.js` -- see the OPEN note under
J3. J2's own live Electron pass is what closed it.

---

### The user-note rule (governs J3 and J4)

**Only USER-CREATED notes count.** Portal-imported WO information belongs in the
WO module's own detail pane and NOWHERE in Admin: not in the Clients tree, not
in the Journal, not in search, not in a WO's note list here. Accepted by the
user 2026-09-03.

- **The discriminator is the BODY, not the id.** `orders-logic.js:204` mints
  these as `'Imported priority: ' + prio`, so that prefix is the exact test. The
  id prefix `n_mig_prio_` is NOT: measured on the live store, TWO of those 167
  ids now carry real user text (`02691394` "Need to Return to Finish Job",
  `9732818` "Replacement Unit 3.5 Ton...") because the user edited the note and
  the id stayed. An id-prefix filter would silently delete both.
- **The filter goes in Admin's pool, never in `notesForOrder`.** That helper is
  SHARED with the WO module's detail pane (`app.jsx:553`), which is the one
  place these notes must still appear. One filter on the `journal` memo in
  `schedule.jsx` covers every Admin surface: the tree, both search boxes and the
  WO note pane all derive from it. The Scratchpad rail needs nothing, because
  `scratchpadNotes` and `backlogNotes` already exclude a WO-linked, unflagged
  note.
- **Measured cost on the live store** (848 notes / 724 orders): linked notes
  842 -> **677**, WOs in the tree 544 -> **435**, properties 482 -> **384**. The
  165 excluded notes are 97 High, 55 Medium, 11 Low, 2 Warranty. The other
  migration kinds in the code (`n_mig_card_`, `n_mig_entry_`) produced ZERO
  surviving notes in this store, so the one body test is the whole job.

---

### J3 -- The Journal tab, folders, and rail weight (BUILT)

**All is retired as a rail option.** It carried notes stripped of context, and
the Clients tree already searches the whole client note index. In its place, a
**Journal** tab holding every NON-WO note, sitting to the LEFT of Clients and
taking the default.

- **The user's reason, recorded because the numbers argue against it:** today
  842 of 848 notes carry a `woId`, so a non-WO Journal opens with 6. The user is
  writing non-WO notes deliberately from here on, which is what the link-to-WO
  flag exists to distinguish. This is a forward-looking default, not a reading
  of the current store.
- **Jottings is a collapsible accordion**, and the user can create their own
  alongside it.
- **This is the FIRST genuine new field in S5.** Nothing on the note record
  holds "which bucket". Reuse was checked and there is none: `pinned` is a
  boolean, `flags` are typed records, `type` is the note kind. One string,
  `note.folder`, null meaning Jottings. Stated exception to the reuse rule.
- **Rail weight (UX pass raised on J2's live look).** The disclosure arrows and
  the address text carry too little weight to read at a glance; add weight, and
  add subtle dividing lines between list items.

**As built** -- the decisions the blueprint left open, and what settled them:

- **The user-note rule is ONE line**, on the `journal` memo in `schedule.jsx`.
  Every Admin surface derives from it, so the tree, both search boxes and the WO
  note pane are all covered by that single filter, and `notesForOrder` is
  untouched so the WO module's detail pane still shows imported cards.
  `IMPORTED_NOTE_PREFIX` in `orders-logic.js` is now ONE constant, read by the
  migrator that writes these notes and by `isImportedNote` that hides them.
- **`folder` had to join the `normalizeNote` whitelist.** That function returns
  a fixed shape and EVERY write passes through it (`data.js:356`), so an
  unlisted field is silently dropped on the next save. This is the one schema
  line J3 adds. `null` means Jottings; the string "Jottings" is never stored, so
  no existing note needs migrating.
- **Folders are DERIVED, not stored as a list.** `journalFolders(notes)` reads
  the distinct `folder` values off the notes that cite them. Creating a folder
  is typing a name on a note; a folder empties out of existence when its last
  note leaves. No parallel list to keep in step.
- **The folder picker reuses the `flagOpen` router**, as `flag: 'folder'`. That
  is the existing "which note, which modal" state, and reusing it inherits the
  Escape guard for free. The BUTTON is in the jump row next to the WO and Map
  links, deliberately NOT in `flagBar`: a folder is a plain record field like
  `woId`, and that toolbar is locked to the seven flags. The button is labelled
  with the note's current bucket, so the rail is not the only place it shows.
- **Same collapse rule as the tree.** `openFolder` starts null and holds one
  accordion, so the tab opens as a short list of headers. Jottings renders even
  when empty: it is the bucket the pad writes into, and a missing header would
  read as a missing feature.
- **Rail weight**: `treeRow` now pads 7px, drops its radius, draws a 1px bottom
  divider and gives every level `--text-1`; depth is carried by indent and
  weight (700 / 500) alone. The list sets `gap: 0` so the dividers read as one
  ruled column instead of dashes. This is ONE function, so the change lands on
  the Clients tree and the Journal accordions together.
- **All retired all the way down**: the Seg option, `selectFromAll` renamed to
  `selectFromJournal` (it still drops the WO selection, which is the job that
  outlived the name), and the Clients empty state that still pointed at it.

**Verified** -- and what is NOT:

- `npm run lint` 0 errors, `npm run build:renderer` clean,
  `test/journal-client-tree.test.js` 16/16. That file adds the body-not-id test
  using the live store's two real proof cases, the `normalizeNote` whitelist
  test, and the `journalFolders` shape.
- **LIVE PASS GREEN.** The user checked J3 in Electron and it looks good. That
  is what closes this slice, and it is the only thing that could: jsdom has no
  CSS, so the rail-weight half was never provable by the suite.

**OPEN: the mount probe is PARKED, and the gate is smaller for it.** The J2
mount probe was extended to cover J3 and then began to **HANG**: three runs,
each killed past seven minutes, where the J2 version of the same file had
completed on this machine earlier the same session. One of those runs was inside
a `git commit`, whose pre-commit hook ran `npm run verify` and took the machine's
RAM with it.

It is parked as **`test/_probe-s5-clients-tree.js`** -- the `_probe-` prefix used
by `_probe-s4.js`, which is OUTSIDE `test/run.js`'s `*.test.js` glob, so the
suite runs clean while the file is kept for diagnosis. Renaming it, not deleting
it, is the point: unstaging alone would NOT have helped, because the runner globs
the DISK, not the index.

Low RAM is a candidate (a 1.9mb bundle plus a jsdom mount on a swapping box) but
is NOT established -- the J2 run on the same box is the evidence against it.
**So J2 and J3 rest on lint + build + the logic suite + the user's live pass, and
that is a smaller claim than this project's usual gate.** Diagnose before J4: run
the parked file with its J3 assertions reverted, and find whether the stall is in
the test edits or in the module.

### J4 -- WO listing and sort in the tree (NOT BUILT)

Split OUT of J3 because it needs a derived completion date and touches the
parked module-interactions rework.

- A property lists **every** WO on it, not only the note-carriers. WOs with no
  user note render **greyed**.
- **Order: ACTIVE first**, by status position (`DEFAULT_STATUSES` in
  `constants.js`). No per-phase collapsible sections; that idiom belongs to the
  WO module. **COMPLETE next**, by completion date. **SENT last**, by invoice
  date, and the invoice date is PRINTED on the row that has one.
- **Sent WOs with no `o.invoice.date` sink to the bottom.** Measured: `invoice`
  exists on 215 of 724 orders while 614 sit in the `sent` tab, so roughly 400
  sent WOs have no date to sort on. This is the common case, not an edge.
- **Completion date is NOT a field.** It has to be derived from `o.history`,
  the way `deriveMilestones` already reads it.
- **TRASH WOs never appear.** Cancelled, of no concern. 68 of 724.
- Tab counts at spec time: sent 614, trash 68, active 39, complete 3. "Active on
  top" surfaces 39 rows across 384 properties.

### Contacts (S7) -- one thing fixed here

The Contacts sub-module lists **every client address, notes or not**. It is
sourced from `orders`, not from notes, so the user-note rule above does not
reach it. Recorded here so J3/J4's exclusions are not later copied into S7 by
analogy.

---
## The collapse rule (governs J2)

**Every level is collapsed on open.** Two exceptions, both explicit:

1. the branch that was open last, and
2. the branch routed to from a WO# entry (that one opens expanded).

The user named this rule directly. It is also the mitigation for the one risk
flagged against the tree: three levels re-clutter the very surface this rework
exists to quieten, unless collapse-by-default actually holds. If a slice ships
with levels expanded by default, that slice has failed its own purpose.

---

## Open / parked

- **Calendar cross-module linking** is OUT OF SCOPE here. The user wants the
  Calendar better connected to the other modules, and parked it for the
  **module interactions rework** coming after this.
- The user expects **more changes as we proceed**. Treat this list as the
  accepted starting set, not a closed one.

---

## Done-gate for every slice

Unchanged from the rest of the project: `npm run verify` green, plus a **live
Electron look** for anything observable, because every slice here is observable
by definition. A green suite alone does not close a UX slice.
