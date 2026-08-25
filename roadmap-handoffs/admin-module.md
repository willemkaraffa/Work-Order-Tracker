# Admin module (replaces the Scheduling module)

Status: deliberated 2026-08-21, no code written. Supersedes the emphasis of
`roadmap-handoffs/scheduling-module.md`, which is now historical.

---

## Abstract: what the user actually wants

Written from the user's own words in deliberation. The architect reads THIS to
know intent. The technical body below is one translation of it, and a translation
can be wrong while still being internally consistent.

> The entire purpose of this app was to digitize work that, at the start of my
> job, was still being done on paper.

The module is a **secretarial workspace**. It replaces the physical notepads the
user still writes on. Not a calendar. A calendar is one thing a note can become.

The primitive is a **note**. Writing must be instant: composer already open,
body only, no title, no date, no required fields. The user takes dictation from
his boss and from customers on the phone, and an older boss will not wait for a
form to be filled in.

A note gains meaning **after** it is written, by flagging it: task, reminder,
calendar entry, parts order, contact, journal. Several flags at once are normal.
"Remind Cecil about invoice" is a note AND a task AND a reminder.

What lives on those pads today: checklist lines, customer contact details,
invoice follow-ups, how to set up a warranty account, a policy his boss told him
about private-client service-call pricing, plans for winning more business,
applicant interview scheduling. Very little of it belongs to a single work order,
which is exactly why the app has had no home for it.

Around that primitive the user wants a **true admin workspace**: a journal of
everything (searchable, sortable, newest-first, scratchpad entries in their own
sub-tab), a contacts book covering clients, distributors and PMs, and eventually
a rebuilt Overview that answers "what do I need this morning" — for example, the
parts orders currently outstanding, so his team can ask him about a part and he
can answer without opening every work order's notes.

Two standing constraints from the user, in his words:

> Backups are key with information.

Notes must exist as `.md` or `.txt` files on disk, independent of the app
working. No silent auto-delete.

> This app from the beginning has been tailored to my needs ad-hoc, then later
> refined if I get around to it.

Speed of capture beats completeness of schema, every time they conflict.

---

## How this document serves that intent

Stated explicitly so drift is visible instead of silent. If a row here stops
being true during implementation, the plan has drifted from the intent, not from
the doc.

| Intent | Where this doc delivers it |
|---|---|
| Notepad is the module, not a feature | Slice 3 makes the composer the landing view; Slice 6 demotes the calendar to a tab |
| Instant capture, no forms | Data model: `body` only is a valid note; every other field optional |
| Meaning added after writing | Flags model; flag modals are per-flag and small |
| One note, several meanings | Flags are independent booleans/payloads, never a mutually exclusive `kind` |
| Notes that outlive a work order | Journal is a VIEW over one note store; starred WO notes surface even when the WO is hidden |
| Contacts book, extensible | Contact `type` is user-editable data, not hardcoded tabs |
| Morning answers on Overview | Parts flag carries structured fields so Overview can render columns; Overview itself is a separate project |
| Backups are key | `.md` export; no auto-delete; bulk delete only, user-initiated |
| Text editing that feels normal | Markdown in `body`, bold/italic toolbar, Electron spellcheck |

---

## Why the previous attempt missed

Recorded so the same failure is not repeated, and because it is the reason this
document leads with an abstract at all.

`scheduling-module.md` locked eleven decisions. Ten were about a calendar. The
notepad appeared once, as decision 4, phrased as a subordinate feature. Slicing
then put the calendar at S2 and tasks at S3. Every downstream gate — architect
feasibility, plan approval, reviewer, `npm run verify` — checked the code against
that document. Nothing checked the document against the user's intent.

Result: four shipped slices, all green, and a module whose landing view is a week
calendar (`src/schedule.jsx:222`, `useState('week')`) with the task backlog as a
pinned side strip. Faithful to the doc. Wrong product.

The abstract above exists to give the architect something to check the body
against.

---

## Current-state facts, verified by reading code

Every line here was read at commit `0c395f1`, not assumed.

### Notes today: three separate things

1. **WO note cards.** Shape `{id, ts, type, body, pinned, edited}`, stored on the
   order as `o.noteCards` (see the migration that builds them,
   `src/orders-logic.js:132`). Rendered by `NoteCard` / `NoteComposer` in
   `src/detail.jsx`.
2. **"More Information" misc note.** `o.notes`, a single free-text field per WO,
   separate from the cards (`src/detail.jsx:441`, `src/app.jsx:5375`).
3. **Entries.** `wo_data.entries`, shape from `normalizeEntry`
   (`src/orders-logic.js:452`): `{id, kind, title, body, date, start, end,
   remindAt, done, woId, tech, created, updated}`. `kind` is a mutually exclusive
   enum of task / event / reminder, defaulted at write time
   (`src/orders-logic.js:455`).

Entries were built four days ago (S3 `355d3db`, S4 `d4c803f`) and are the wrong
primitive for the intent above: they force a kind before the user has decided
what the note is.

### Search does not cover note text

`orderMatchesQuery` (`src/orders-logic.js:685`) matches WO number, phone,
address, city, PM and tech. Note bodies are not searched anywhere. So the WO
picker needed when tagging a note to a WO is free; journal full-text search is
new work.

### Clients already exist, thinly

`DEFAULT_PMS` (`src/constants.js:8`) is `{name, fullName, color}`, persisted as
`data.pms` (`src/app.jsx:4048`). Every WO links by NAME via `o.pm`. The WO
sidebar already renders a Gmail-style row per client
(`src/app.jsx:1756`, view key `'cl:' + c.name` at `src/app.jsx:1766`). WO detail
already has a client picker.

Per-client tax policy is safe against new clients: `catalogTax()`
(`src/constants.js:43`) falls back to a default for unknown names. Adding private
residential clients cannot break invoice math.

### Contacts already exist on work orders

`contacts: [{role, name, phone}]` (`src/app.jsx:366`, `:549`), editable in the WO
form (`src/app.jsx:1140`-`1180`).

### WO folders are rooted and partly hardcoded

`resolveWoFolder` (`main.js:658`) joins `WO_ROOT()` with a hardcoded branch:
MSR and AMH get named directories, everything else lands in `Other Customers`.

### Every save rewrites the whole store, and rotates a backup first

`writeStore` (`main.js:62`) calls `rotateBackups()` and then writes the entire
data file. Per-keystroke autosave would copy the full dataset and rewrite it on
every character, and would collapse all ten rotating backups into ten seconds of
history — destroying the thing the user called vital.

### The text lock-out bug is instrumented, and is not an editor bug

`src/search-hook.js` already carries `__lockDebug()`, a passive watchdog, and a
Ctrl+Alt+U rescue hotkey. The comments there name two candidate mechanisms, both
app-level:

- `window.__modalOpen` is hand-incremented and hand-decremented
  (`src/search-hook.js:22`). Any unmount path that skips cleanup leaks it above
  zero forever. CORRECTED after S0 shipped: this one never blocked typing. The
  handler returns WITHOUT `preventDefault`, so keys still reach the page and only
  type-to-search dies. The original wording here overstated it.
- A render throw unmounts the React tree, so focus falls to `BODY` and no
  focusable node remains. `rootChildren: 0` in a snapshot distinguishes this.
  This is the mechanism that makes ALL text entry impossible, and so it is the
  better explanation of what the user actually experiences.

Neither lives in note rendering. **Rebuilding the note editor would inherit both.**

Both were closed structurally in S0 (`1b563ca`). If a lock still happens after
that, a third mechanism exists and the watchdog snapshot is the only evidence.

---

## Locked decisions

1. **The note is the primitive.** One record type for the whole app.
2. **Flags, not kinds.** Task, reminder, calendar, parts, contact, journal are
   independent flags on a note. Several at once. Never an exclusive enum.
3. **Capture first, structure later.** A note with only `body` is valid. Flag
   modals are small, per-flag, and appear only when that flag is applied. Never
   one combined form.
4. **`entries` is folded into notes.** Reminders and events become notes with
   flags. Accepts rework of two shipped commits.
5. **Journal is a view, not a container.** Starring a WO note sets a flag where
   the note already lives. Nothing is copied, so nothing drifts. Journal queries
   the union: all Admin notes plus starred WO notes. Invoiced/hidden WOs surface
   automatically.
6. **Links are generic from day one.** `woId`, `pm`, `contactId` are optional
   fields on the same record. Every later tab is a filter, not a migration.
7. **Markdown in `body`, stored as plain string.** Not HTML, not editor JSON.
   Keeps `.md` export a straight copy, keeps search on raw text, keeps paste
   clean. Bold/italic via a toolbar that wraps markers.
8. **Spellcheck via Electron's built-in.** Inside note text, native suggestions
   win over the WO context menu.
9. **No auto-delete, ever.** Bulk delete only, user-initiated, mail-style.
   `.md` export first, prune second.
10. **Autosave is debounced.** Save on pause or blur, not per keystroke. Note
    edits are exempt from backup rotation.
11. **Contacts and clients are one record type,** distinguished by a user-editable
    `type` (Distributors / Clients / PMs, extensible). A private homeowner is a
    client exactly as much as a company is. Clients hold multiple contacts, the
    same way WOs already do.
12. **Client records get a stable id now.** Links keep using name for the moment;
    switching them is its own later slice.
13. **Overview rework is a separate project.** It depends on the parts flag
    existing, so it lands after.

---

## Data model

One note record, one contact record. Both live inside the `wo_data` envelope, for
one write path and one backup.

```
note = {
  id, ts, updated,
  body,                    // markdown, plain string. The ONLY required field.
  pinned, edited,          // carried from the existing WO note card shape
  flags: {                 // absent key = flag not set
    task:     { done, due },
    reminder: { at },
    calendar: { date, start, end },
    parts:    { part, status, distributor, address },
    journal:  true,        // "starred" on the WO side
    contact:  { contactId },
  },
  woId, pm, contactId,     // generic links, all optional
}
```

An Admin note is a note with no `woId`. A WO note is a note with `woId` set.
Nothing else distinguishes them.

```
contact = {
  id,                      // stable
  type,                    // 'client' | 'distributor' | 'pm' | user-defined
  name, fullName, color,   // color kept: the WO sidebar already uses it
  phone, email,
  billingAddress,
  serviceAddresses: [],
  people: [{ role, name, phone, email }],   // mirrors the existing WO contacts shape
  docPath,                 // optional, per-contact document folder
}
```

Existing `data.pms` records migrate into this: `{name, fullName, color}` plus
`type: 'pm'` and a generated id.

---

## Slice order

Each slice ends at `npm run verify` green plus, where the change is observable, a
live Electron check.

**S0 — Harden the renderer. DONE, `1b563ca`.** `RootErrorBoundary` wraps App at
the mount point. `window.__modalOpen` became a mirror; the gate is now a
proof-of-render token registry in `src/search-hook.js`, where a token counts only
while the component that registered it can still be re-rendered, so an orphaned
token is proven dead before it is pruned. No timed reset. Every diagnostic stays
armed. Tests in `test/admin-s0-hardening.test.js`.

Found while doing it, and NOT fixed: `test/renderer-smoke.test.js`,
`test/schedule.test.js` and `test/entries-store.test.js` all build JSDOMs with
`pretendToBeVisual: true`, which runs a per-window rAF loop on a libuv handle,
and renderer-smoke then calls `process.exit()`. That races into
`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` on Windows: every
assertion passes, the process aborts, and the runner scores it FAIL. Intermittent,
so it reads as flakiness. The S0 test avoids it by dropping `pretendToBeVisual`,
closing every JSDOM, turning the loop twice, setting `process.exitCode`, and
arming an unref'd 5s watchdog. Those three files still carry it.

**S1 — One note record.** SHIPPED. The note shape above is live in
`src/orders-logic.js` (`normalizeNote`), the store is ONE flat `wo_data.notes`
array with `addNote` / `updateNote` / `deleteNote` mutators in `src/data.js`, and
both migrations (`migrateNoteCardsToNotes`, `migrateEntriesToNotes`) run on load,
idempotent by note id. `wo_data.entries` is deleted once emptied. Reminders still
fire through the existing bell: `getReminderNotificationItems` keeps its
signature and its `'reminder-' + id` dismissal keys, and now reads
`flags.reminder.at`. The Schedule module keeps its kind picker as a FORM
PROJECTION only (`noteToEntryForm` out, `normalizeNote`'s legacy branch back in);
storage never sees a `kind` again. Three carried fields worth knowing: `type`
('Note' / 'Customer call' / ...) rides along on the record until S4 maps it onto
flags; `tech` rides along for the calendar's tech filter; a WO's detail pane now
lists EVERY note carrying its `woId`, including a schedule task linked to it.

The three S1 questions are answered (rulings by the user, 2026-08-25):
1. **Store:** ONE flat `wo_data.notes` array. `o.noteCards` comes off every
   order; each migrated record carries `woId`. An Admin note is the same record
   with `woId` null. One write path, one backup.
2. **`o.notes` "More Information" STAYS a distinct per-WO field.** It does not
   fold into the note record; `composeNotes` and the scrape-merge path are
   untouched.
3. **`ts` is written-at and holds journal position; `updated` is edited-at,**
   stored but never a sort key. Editing an old note does not bump it.

**S2 — Debounced save.** Exempt note writes from `rotateBackups()`. Prove the
write path does not rewrite the store per keystroke.

**S3 — Scratchpad.** Module lands on a permanently mounted composer, cursor live,
body only. Saves on blur or Enter. No modal. The backlog panel already built is
reused.

**S4 — Flags.** Flag buttons with hover tooltips. Small per-flag modals. WO
picker on the WO flag reuses `orderMatchesQuery`. Parts flag carries its four
fields.

**S5 — Journal.** Union view, newest-first, filterable. Scratchpad (unflagged,
undated) as its own sub-tab. Full-text search over `body` — new code, not reuse.
`.md` export.

**S6 — Calendar demoted.** Existing `ScheduleModule` becomes a tab, not the
landing view. It keeps reading WO schedules; that part works and stays.

**S7 — Contacts.** Contact record, type tabs, client detail with derived WO list
(grouping already exists in the sidebar). Split the WO sidebar by client type at
the same time — cheap only because this slice adds `type` anyway. AMH and MSR stay
visually separated as a personal section. Per-contact document folder; make the
`Other Customers` branch of `resolveWoFolder` data-driven.

**Separate project — Overview rework.** Parts orders outstanding, plus whatever
else the user wants to see in the morning. Own handoff.

---

## Open questions, parked against the slice that needs them

Deliberately not answered up front. Ask at the slice, in a multiple-choice prompt,
not in prose.

- ~~**S1:** does `o.notes` "More Information" fold into the note record, or stay
  a distinct per-WO field?~~ ANSWERED: stays distinct (ruling 2, see S1 above).
- ~~**S1:** does editing an old note bump it to the top of the journal, or does
  `ts` hold its original position?~~ ANSWERED: `ts` holds its position, `updated`
  records the edit (ruling 3, see S1 above). The store question is answered by
  ruling 1.
- **S3:** module name and nav slot. "Admin" is the working name; the module id is
  still `itinerary` internally and renaming visible strings again is a third
  rename.
- **S4:** parts flag fields — is `{part, status, distributor, address}` complete
  for what the team asks about? Does address auto-pull from a linked WO?
- **S5:** `.md` export layout — one file per note, or one file per day appended?
- **S5:** PII. Client details land in plain-text files on disk, outside the app.
  The user raised private client pages himself; this needs an explicit
  acknowledgement, not a design change.
- **S7:** which contact types ship by default beyond Distributors / Clients / PMs.

---

## Risks

- **S1 is the load-bearing slice.** It rewrites the note storage every other
  slice depends on, and it touches WO detail, which is the most-used screen in
  the app. It lands alone.
- **Folding `entries` discards four days of shipped work.** That is the correct
  call now and gets more expensive every week. Only the user's own test data uses
  entries today.
- **Scope is months, not weeks.** Notes, journal, calendar, contacts, clients,
  parts, plus an Overview project. Slices must ship independently or none will.
- **A rebuilt editor will not fix the text lock-out.** S0 exists precisely so the
  rebuild is not sold as the fix. If a lock still occurs after S0, the watchdog
  snapshot is the evidence, not a guess.
- **Name-keyed client links.** `o.pm`, sidebar view keys `cl:<name>`, and
  possibly `data.presets` all key on the client's name. The stable id added in S7
  does not retire them. That migration is its own slice and must read the preset
  shape first.
