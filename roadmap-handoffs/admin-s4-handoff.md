# Handoff: Admin module S4 (Flags), UNFINISHED, gate RED

Written 2026-08-31. Repo `C:\dev\Work-Order-Tracker`, branch
`feat/schedule-retention`. Blueprint stays `roadmap-handoffs/admin-module.md`;
read its ABSTRACT before its body.

**NOTHING IS COMMITTED. The S4 work is loose in the working tree.**

---

## Verify session state FIRST. This bit already burned this session.

```
git log --oneline -3
git status --short
node node_modules/project-overseer/scripts/plan-approve.js --status
node node_modules/project-overseer/scripts/overseer-status.js
```

This session opened believing HEAD was `af73d56` and that S3 was next, because
both `roadmap-handoffs/admin-s3-handoff.md` and the memory index said so. HEAD
was actually `c947ef3`: an unrelated MSR-tax stream had landed in between, and
**S3 (`6643f2c`) and S3b (`a48fdb3`) had already shipped.** A handoff's
"NEXT"/"SHIPPED" lines are stale the moment anything else lands. `git log` first,
always. See `lesson_read_the_source_artifact`.

Baseline at `c947ef3`, measured not assumed: **45 pass, 0 fail, 1 skip**
(the skip is `msr-extract`, fixtures absent, and is normal).

---

## Where S4 actually is

Plan `plan-2026-08-31-admin-module-s4-flags-blueprint-`, approved and ENFORCED.
Scope was widened twice (rulings below), so it is now:

```
src/orders-logic.js, src/schedule.jsx, src/app.jsx, src/primitives.jsx,
test/admin-s4-flags.test.js, roadmap-handoffs/admin-module.md,
test/schedule.test.js, roadmap-handoffs/admin-s4-handoff.md
```

Working tree, uncommitted:

```
 roadmap-handoffs/admin-module.md |  40 +++-
 src/app.jsx                      |   1 +
 src/orders-logic.js              |   7 +-
 src/primitives.jsx               |  19 ++
 src/schedule.jsx                 | 398 ++++++++++++++++++++++++++++--
 test/admin-s4-flags.test.js      | 506 +++++++++++++++++++++++++++++++++++++++
 6 files changed, 952 insertions(+), 19 deletions(-)
```

Gate after that work: **43 pass, 3 fail, 1 skip.** Three regressions, all
accounted for below. Plan steps 1-9 are written in code; step 10 (gate green plus
a live Electron check) is NOT done.

### What is in the tree

- `src/orders-logic.js` — `po` added to the parts branch of `normalizeFlags` via
  the existing `noteStr`. Comment blocks updated. This is the ONLY schema change
  in the slice; everything else is UI over a model that was already live and
  already migrated.
- `src/app.jsx` — one line, `onDeleteNote={storeDeleteNote}` on the
  `ScheduleModule` call.
- `src/primitives.jsx` — new `NoteFlagBtn` export, kept deliberately separate
  from `FlagGlyph` (which is for WO emergency/warranty/returnPending, not notes).
- `src/schedule.jsx` — `msToLocalInput`/`localInputToMs`, `fld`/`lbl` recovered
  from `6643f2c`; `FlagFrame` plus `TaskFlagModal` / `ReminderFlagModal` /
  `CalendarFlagModal` / `PartsFlagModal` / `WoLinkModal`; `flagBar` as a plain
  function returning JSX (not a component defined in render, rule A5);
  `writeNote` / `setFlag` / `toggleTaskDone` / `removeNote` / `openNoteInJournal`
  / `woAddress`; calendar chips made editable. Modals mount only while open and
  are keyed on the note id; no flag value is mirrored into state (A1/A2 clean).
- `test/admin-s4-flags.test.js` — 506 lines, correct harness discipline, NOT
  passing.

---

## The three failures, and they are NOT the same kind

### 1. `test/schedule.test.js` — cause KNOWN, ruling ALREADY MADE

Lines 543-548 assert `entries: a calendar chip carries no checkbox (chips are
read-only)` and `entries: clicking a chip opens no editor`. The approved plan
says in as many words that S4 makes chips editable again, so both assertions
encode RETIRED behaviour. The throw at line 552 is downstream: the chip click now
switches to the Journal tab, so `querySelector('select')` returns null.

The builder correctly STOPPED instead of routing around the scope guard.

**The architect RULED WIDEN on 2026-08-31** and the scope is already widened on
disk. Do not re-ask. Update the retired assertions to the new behaviour.

Identical in shape to S1's `test/reminder-logic.test.js` break, which was also
ruled WIDEN. When a plan retires a behaviour, grep for every test asserting that
behaviour BEFORE drafting scope, not after the gate goes red.

### 2. `test/admin-s3-scratchpad.test.js` — real defect, fix written, UNVERIFIED

`Total: 88 | Pass: 87 | Fail: 1`, failing on `journal: the WO jump reuses
onOpenWO`. Root cause was real and not a test artifact: the new flag button and
the existing jump button BOTH rendered the WO number, so `byLabel('WO-9')`
started matching the wrong one. Two same-labelled buttons doing different things
in one panel is a trap regardless of any test.

Fixed by labelling the flag button `Link WO` always, with the WO number in its
tooltip. **That fix landed AFTER the gate run, so it has never been run.** Verify
it before trusting it.

### 3. `test/admin-s4-flags.test.js` — cause UNKNOWN. Do not assume it is the app.

```
THREW: TypeError: Cannot read properties of undefined (reading 'dispatchEvent')
  at flagRowChecks (...:365:5)
then WATCHDOG
```

Line 365 is `k.click(k.btn('Remove flag'))` immediately after clicking the
Calendar flag button. `k.btn('Remove flag')` came back undefined.

**Static trace done from the chat thread, NOT RUN, so treat it as a lead and not
a finding:**

- The calendar path in `src/schedule.jsx` is structurally identical to the task
  and reminder paths, which pass. Same `FlagFrame`, same mount condition, same
  keying.
- `Modal` (`src/app.jsx:673`) renders INLINE, not through a portal, so the test's
  container-scoped queries are not the problem.
- The `Day` label exists in `CalendarFlagModal` exactly as the test spells it.
- `k.flagBtn` scopes to the flag row via `button[title="Delete this note"]`, so
  the Journal/Calendar binder-tab label collision is already handled.
- `"Remove flag"` only renders when `isSet` is true, i.e. when the note the modal
  opened on actually carries `flags.calendar`. **The most promising lead is that
  the modal opened on the wrong note, or on a note without that flag** —
  `flagRows()[0]` is the PAD's row, and the pad and the journal each render their
  own `flagBar`.

**Start by suspecting the TEST, not the shipped code.** See
`lesson_author_written_tests_agree_with_the_bug`. The builder wrote both this
test and the code it fails against.

The builder left a print-only diagnostic at `<scratchpad>/calmodal-probe.js`. It
is now BLOCKED by the thrash guard (2 runs in 10 min). **Renaming or relocating
it to get a fresh count is tampering, not a judgment call.** Come back with a
fresh session and a fresh count, or diagnose it a different way.

---

## The builder's probe CORRECTED the plan's premise. Carry this forward.

The plan asserted that an unflushed flag write permanently clobbers the flag or
the text. The probe, driving the real `useWorkOrders` and the real
`ScheduleModule` through both orderings, shows that is **wrong**:

```
case 2  before: {"body":"beta","flags":{}}   pad="beta EDITED"
case 2  right after the flag write: {"body":"beta","flags":{"task":{...}}}
case 2  UNFLUSHED ordering:          {"body":"beta EDITED","flags":{"task":{...}}}
case 3  UNRELEASED delete -> store:  GONE FROM THE STORE
case 3  the pad still shows:         "gamma EDITED"  (text now belongs to no note)
case 3  and keeps typing into a dead id: GONE FROM THE STORE -- store note count 3
case 4  RELEASED delete -> store:    GONE FROM THE STORE
case 4  the pad shows:               ""
```

With the current `data.js` merge (`normalizeNote({...n, ...patch})`, patch scoped
to `{flags}` or `{body}`), the unflushed flag write **self-heals** when the timer
fires. What it loses is CONSISTENCY for one `PAD_IDLE_MS` window: the store holds
the pre-flag body while already carrying the flag. That is the window
`PAD_IDLE_MS`'s own comment calls the crash window, so S2's disk writer, a
backup, or a hard kill can still land inside it. Flushing closes it. Keep the
flush.

**The permanent, silent loss is the DELETE half.** An editor left holding a
deleted note id keeps writing into the void, forever, with no error. `removeNote`
releasing the editors is the load-bearing part of this slice, not the flag flush.
This is the more important invariant, and the plan named the wrong one.

Generalise: a debounced editor bound to a record id must be RELEASED when that
record is destroyed, or every later keystroke writes to nothing.

---

## Human rulings. LOCKED. Do not re-litigate.

Taken 2026-08-31 by multiple choice, per the blueprint's instruction to ask at
the slice.

1. **Parts flag gains a cost/PO number.** `{part, status, distributor, address,
   po}`, coerced with the existing `noteStr`. Old records load with `po` null. No
   migration. IMPLEMENTED.
2. **Parts address AUTO-FILLS from a linked WO and STAYS EDITABLE.** Whatever
   ends up in the field is what gets STORED, so the note stays self-contained if
   the WO address later changes. Not derive-at-render, not read-only.
   IMPLEMENTED.
3. **The contact flag is DEFERRED to S7.** It needs contact records that do not
   exist yet. `normalizeFlags` keeps tolerating the key either way. HONOURED.
4. **The `o.history` gap gets fixed for add, update AND delete together.** Ruled
   after the gate went red. See the next section. NOT STARTED.

---

## OPEN WORK ITEM ruled this session but not started: the `o.history` gap

S1's overseer ruling was that note handlers append the order's `o.history` line
for notes carrying a `woId`, because the trail belongs to the work order; a
`woId`-null note writes no history.

The Admin module does not honour that. `src/app.jsx` wires the RAW store mutators
into `ScheduleModule`:

```
6460  onAddNote={storeAddNote}
6461  onUpdateNote={storeUpdateNote}
6462  onDeleteNote={storeDeleteNote}     <- added by S4
```

The history-writing wrappers are the OTHER ones, e.g. `deleteNote` at
`src/app.jsx:5518`, which is `(id, noteId) => { storeDeleteNote(noteId);
noteHistory(id, 'note deleted'); }`. Note the DIFFERENT SIGNATURE: `(id, noteId)`
versus the store mutator's `(id)`. The builder was right not to reuse it as-is,
and right that it matched how add and update were already wired by S3b.

So add and update have silently skipped WO history since S3b, and S4's delete
line continues the pattern. **The user ruled: fix all three together**, so there
is one consistent rule instead of three exceptions, rather than patching only the
delete that S4 introduced.

This needs `src/app.jsx` work and will widen scope again. Get the architect's
scope ruling before touching it.

---

## Verify budget is BLOWN. Plan on a fresh one.

```
heavy-verify runs observed: 5   budget: 3   OVER by 2
```

Two of those were the builder hitting its C2 hard stop on the same paths. The
thrash guard is now armed against `calmodal-probe.js` specifically. A fresh
session resets the practical picture; do not try to reset it artificially.

**Spend the next budget on the two failures whose cause is already known
(`schedule.test.js`, and re-running the `admin-s3-scratchpad` label fix), and
diagnose `admin-s4-flags.test.js` by READING before spending a run on it.**

---

## Process rules that cost real time this session and the last two

- **ONE coder spawn per session.** The chat thread is BLOCKED from writing app
  code by `.claude/hooks/coder-role-gate.js`. Dispatch `builder` (it has Bash and
  can run the gate); `editor` cannot run `npm run verify`. Continuing an existing
  spawn with SendMessage is NOT a second spawn.
- **C2 is a hard stop, not a speed bump.** Two failed attempts on the same
  verification path means the APPROACH is wrong. The builder obeyed this and
  stopped with the work half-proven, which is the right outcome, not a failure.
- **`package-lock.json` poisons the reviewer.** `gemini-review.js` has a 200k
  budget and a modified lock file eats it. `git stash push -- package-lock.json`,
  review, commit, THEN `git stash pop`. Keep the stash THROUGH the commit,
  because `review-gate` hashes `git diff HEAD` including the working tree.
- **`main.js` alone now exceeds the reviewer budget** and gets truncated even
  with the lock file stashed.
- **New untracked files need `git add -N`** or `git diff HEAD` cannot see them
  and the reviewer never reads them.
- **Cite plan steps ONLY immediately before the commit that contains them.**
  `plan-check` demands each done-step's evidence appear in the CURRENT diff.
  This is why the S4 steps are all still unticked: the work is uncommitted.
- **Re-review after any post-review edit.** `review-gate` hashes the tree.
- **PowerShell here-strings passed to the Bash tool commit literally.** Use
  `git commit -F -` with a heredoc.
- **The architect degrades models silently.** Two of the three architect calls
  this session logged `gemini-flash-latest: 503 Service Unavailable: trying next
  model` and were actually served by `gemini-3.5-flash`; the third was served by
  `gemini-flash-latest`. A role verdict is not interpretable unless the served
  model is known. Read the banner. See `project_gemini_reviewer`.

## Known test trap, STILL unfixed in three files

`test/renderer-smoke.test.js`, `test/schedule.test.js` and
`test/entries-store.test.js` build JSDOMs with `pretendToBeVisual: true`, which
runs a per-window rAF loop on a libuv handle, and renderer-smoke calls
`process.exit()`. On Windows that intermittently aborts with
`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`: every assertion passes
and the runner still scores FAIL, so it reads as flakiness.

The admin tests (`s0-hardening`, `s1-migration`, `s2-backup`, `s3-scratchpad`,
and the new `s4-flags`) avoid it by dropping `pretendToBeVisual`, closing every
JSDOM, setting `process.exitCode` instead of calling `process.exit()`, and arming
an unref'd watchdog. Since `test/schedule.test.js` is NOW IN SCOPE, fixing its
harness while you are already editing it is nearly free. Consider it.

Note also that a bundle's bare `setInterval` resolves to Node's global, so
`window.close()` does not reap the App's timers; clear them explicitly or the
test hangs to the watchdog.

## Line endings

The builder's scripted edits wrote LF into files git reports as CRLF in the
working tree. `git diff HEAD` is unaffected because autocrlf normalises. Flagged
only so nobody mistakes it for a real diff.

## Still unproven, now for the FIFTH slice running

**Live pixels.** Nobody has clicked the running Electron app since S1. S3b claims
bundle-level proof of its autosave behaviour, which is real but is not the same
thing. S4 is observable UI: flag buttons, five modals, a delete, a task tick. Its
done-gate includes a live Electron check and that check has not happened.

Do not let S4 close on a green suite alone.

## Open questions still parked

- **S5:** `.md` export layout, one file per note or one file per day appended.
- **S5:** PII acknowledgement for client details landing on disk in plain text.
- **S7:** which contact types ship by default beyond Distributors / Clients / PMs.


---

# 2026-09-01 session: two of the three failures are CLOSED. Read this first.

This session was an invoices task. The S4 tree blocked its commit (the pre-commit
gate verifies the WORKING TREE, not the staged subset), so the user ruled: fix the
failures first. Nothing in `src/` was touched. Only three test files changed.

## Closed

**1. `test/schedule.test.js` -- 62/62, was throwing.** Exactly the ruling already
recorded above: the chips-are-read-only assertions were RETIRED behaviour. They
were REPLACED, not deleted, by assertions of the S4 contract actually shipped in
`entryChip` (`src/schedule.jsx:782`): a task chip carries a tick box, an event
chip does not, and a chip click calls `openNoteInJournal`. The throw at the tech
filter was downstream of the tab switch that the chip click performs, so the test
now clicks the Calendar tab again before reading the `select`. `byLabel` takes the
FIRST match and the tab strip renders above the note flag row (which owns a second
'Calendar' button), so the plain label is still the tab.

**2. `test/admin-s3-scratchpad.test.js` -- 88/88.** The `Link WO` relabel that
"landed after the gate run and has never been run" was run. It holds. No change.

**3. `test/admin-s4-flags.test.js` -- 0/46 (threw) -> 45/46.** The lead recorded
above was right and the cause was the TEST, not `src/schedule.jsx`.

TWO panels render a flag row: the PAD's, and the JOURNAL editor's. Probe output,
taken at four points in `flagRowChecks`:

```
ROWS@352: "Jottings1plain jotting...This noteTaskRemind..."  ||  "NoteBackalready datedTaskRemind..."
```

Index 0 is the PAD, and it stays bound to whatever note was picked FIRST. Index 1
is the Journal editor, bound to the note the preceding `k.row(...)` clicked.
`flagBtn(label, which)` defaulted to `which || 0`, so every flag click after the
first `row()` aimed at the WRONG note. The Calendar modal therefore opened on an
unflagged jotting: `Remove flag` renders only when `isSet`, so it did not exist,
and `k.click(undefined)` threw at :365. Section A passed only by luck (the pad and
the journal were bound to the same note there).

Fix: `flagBtn` defaults to the LAST flag row. One helper, in the test.

## The one that is LEFT: `Total: 46 | Pass: 45 | Fail: 1`

**The failing assertion's NAME IS NOT KNOWN.** It scrolled past a `tail`, and the
thrash guard then blocked the re-run (2 runs / 10 min, correctly, and it was not
routed around). Every assertion from `parts: the PO number is stored on the flag`
onward passed, so the failure is ABOVE that line: section A (the flag row itself,
~:276-:291) or early section B (~:306-:331).

### First step, before any theory

Run the file ONCE, redirecting to a file, and read the whole thing:

    node test/admin-s4-flags.test.js > s4.txt 2>&1

Then read the `FAIL` line and the diagnostic string it prints. Do NOT run it a
second time to "see it again": the guard blocks that, and the captured file is the
whole output.

### Standing leads for whatever that line turns out to be

- Line :330 asserts `!!k.flagBtn('WO-1')` after `k.row('linked jotting')`. Under
  the OLD index-0 default it was reading the pad's row and was near-certainly a
  silent FAIL already; it now reads the journal row, which the probe shows does
  carry `WO-1`. If this is the survivor, check the LABEL, not the row.
- Section A's label/title assertions (:281, :287) address `flagRows()[0]`
  POSITIONALLY and were left alone. They are correct only while one note is bound
  to both panels. If the survivor is one of these, give them the same last-row
  treatment rather than patching the expectation.
- The rule from `lesson_author_written_tests_agree_with_the_bug` has held twice in
  this file already. Suspect the test a THIRD time before editing `src/`.

## What is NOT done

- **Ruling 4 (the `o.history` gap for add + update + delete) is still NOT
  STARTED.** Unchanged by this session.
- **Live Electron pixels: still nobody.** Unchanged, and still the S4 done-gate.
- The invoices work that this gate blocked (`src/orders-logic.js`,
  `src/invoices.jsx`, `test/sent-to-invoice-date.test.js`,
  `test/invoice-sort.test.js`) is live-proven by the user and waits on the gate
  going green before it can commit. Commit those four with an EXPLICIT pathspec:
  `test/admin-s4-flags.test.js` sits in the index as intent-to-add (`git add -N`,
  porcelain ` A`), so a bare `git commit` would land it EMPTY.
