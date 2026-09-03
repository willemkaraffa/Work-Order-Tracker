# Admin S5 -- Journal / Scratchpad UX rework

Blueprint. Accepted by the user 2026-09-01, in the session that closed S4's last
test failure and shipped ruling 4 (`6cde4ce`). S1, S2, S3 and J1 are BUILT and
live-tested; J2 is the one slice still to write.

This is a UX rework of the **Scheduling & Admin** module (`src/schedule.jsx`),
not a data change. Nothing here needs a new note field: every value the new views
show already exists on the records.

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

### J2 -- The Clients tree (NOT BUILT)

The user's rail set is **Clients, Tasks, Pinned, All**. J1 shipped the last
three. Clients is this slice, and J1 deliberately does NOT render a dead button
for it.

- Clients is a tree in the rail: `Client -> Property Address -> WO#`. The field
  reuse table above already fixes every field it needs; do not add one.
- Selecting a WO# fills the main pane with that WO's notes.
- **The collapse rule below governs this slice.** It is the mitigation for the
  risk J1 exists to answer: a tree re-clutters the very surface this rework
  quietened, unless collapse-by-default actually holds.

**Record this before it is rediscovered as a bug:** a note with no `note.woId`
has no client, so it CANNOT appear anywhere under the Clients tree. Those notes
stay reachable under **All**, which is where the retired Jottings population
lives now. An empty Clients tree for a pad-written note is correct behaviour,
not a missing link.

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
