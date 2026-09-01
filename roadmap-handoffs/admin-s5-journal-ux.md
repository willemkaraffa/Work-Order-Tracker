# Admin S5 -- Journal / Scratchpad UX rework

Blueprint. No code written yet. Accepted by the user 2026-09-01, in the session
that closed S4's last test failure and shipped ruling 4 (`6cde4ce`).

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

### S4 -- "WO Notes" filter

The Journal filter strip is `All | Jottings` (`src/schedule.jsx:1002`). It gains
a third: **WO Notes**.

- WO Notes lists notes **folded under each work order**, header `WO# Address`.
- Collapsed by default (see the collapse rule below).
- This is where notes on invoiced / closed WOs stay reachable once S5 restricts
  the pinned list.

### S5 -- Journal main pane becomes a tree, pinned restricted to active WOs

Two parts, one slice because they only make sense together.

**a. The tree.** The Journal main pane becomes
`Client -> Property Address -> WO#`. Clicking a WO# box jumps to that WO's entry
in **WO Notes**, expanded.

**b. Pinned means active.** The quick-nav pinned list is restricted to **ACTIVE
work orders only**. Tasks and Pinned both stay in quick-nav
(`src/schedule.jsx:1065`) -- they are not moving. Notes on invoiced or closed WOs
are not lost; they live under WO Notes.

---

## The collapse rule (applies to S4 and S5)

**Every level is collapsed on open.** Two exceptions, both explicit:

1. the branch that was open last, and
2. the branch routed to from a WO# entry (that one opens expanded).

The user named this rule directly. It is also the mitigation for the one risk
flagged against S5: a three-level tree re-clutters the very pane this rework
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
