# Round 5 — Batch A (testable logic)

Source: `06-30 New round Tracker` notes. Batch A = the items that are pure-logic
or fixture-testable, so they go through the QA gate (orders-logic.js + a test
importing shipped code; `npm run verify` green before "done"). UI items (#4 #6
#7 #9 #10 #3 #5) and scraper/automation (#1/#2 #11 #14) are deferred to later
batches. Baseline commit: 1edddb1.

Rule: no blind patches. Where root cause is config-dependent, REPRODUCE first
(capture state) before editing — see CLAUDE.md C1/C4 and bug_note_card_input_lock.

---

## A1 — #8 Job Complete phase hook not clearing schedule

Symptom: a WO moved to a "Job Complete" state keeps its itinerary schedule.

Code reality: three independent schedule-clear paths, all gated the same way
(`isCompletionStatusName(status)` AND `tab==='active'`):
- single-WO setStatus auto-flip — app.jsx:5249
- bulk setStatus auto-flip — app.jsx:4544
- reconciler pass 3 — orders-logic.js reconcileChange11
Plus a `visited`-tag clear (app.jsx:5260) independent of completion.
markComplete (applyMarkComplete) also clears.

Why uncertain: `isCompletionStatusName` returns FALSE for "Job Complete - Enter
Bid" (deliberate, v4.0.1) and TRUE only for Pending-Complete / Closed / (bid
submitted AND complete). So a status the USER calls "job complete" may not trip
any clear path. Which path is expected depends on the user's status names +
statusTags config.

REPRODUCED (user, 2026-06-30): plumbers batch-send notes, so WOs jump straight
Open -> "Job Complete - Enter Bid". That status is deliberately EXCLUDED from
isCompletionStatusName (v4.0.1: bid not yet entered = still active workflow), so
no auto-flip and no schedule clear fires. The WO lingers on the itinerary even
though the tech finished onsite work.

Desired semantics: a "Job Complete - …" status means the site visit is DONE ->
clear the schedule (leave the itinerary) but keep the WO ACTIVE (bid still
pending). That is EXACTLY what the existing `visited` statusTag does
(app.jsx:5260 / 4553: clears schedule, stays on tab). Mechanism already exists
(rule 5 / B3) — do not add new state.

Fix options:
 (a) CONFIG, zero code: tag "Job Complete - Enter Bid" (and siblings) as
     `visited` in statusTags. Immediate, but relies on the user tagging each.
 (b) CODE: in the setStatus path, also clear schedule when the status name
     signals a completed visit even if not a completion status — reuse a small
     predicate `clearsScheduleOnSet(status, statusTags)` =
     `statusTags[status]==='visited' || /job complete/i.test(status)`. Keeps the
     WO active; only the schedule drops. Pure, testable.
Recommend (b) so it is automatic across the batch flow without per-status config,
but CONFIRM the `/job complete/i` heuristic with the user (it would also catch
"Bid Submitted - Job Complete", which already completes — harmless, schedule
already cleared there).

Test: orders-logic test on the extracted predicate — "Job Complete - Enter Bid"
-> clears schedule, tab stays active, status unchanged (NOT flipped to Complete).
Collateral: applySetStatus + bulkSetStatus still inline (Gap 1.5) — extract here
so single + bulk share the predicate. Touches app.jsx setStatus + bulk + woAction.

## A2 — #12a return-trip mis-fires on never-visited WOs

Symptom: WO 03061113 never visited, but a re-schedule registered it as a return
trip.

Root cause: `setSchedule` (app.jsx:4756) decides return-trip from
`hist.some(h => h.action === 'scheduled')` — i.e. "was scheduled before", which
is true even if the tech never went. The real signal is "was VISITED before"
(onsite/visited history), not "was scheduled before".

Fix spec: change the return-trip predicate to key off a visit signal — history
entry indicating an actual visit (statusTag `visited`/`onsite`, or a
`visited`-tagged status in history), not the `scheduled` entry. Grep existing
fields first (rule 5): there is a `visited` statusTag and `onsite` SYSTEM_TAG —
reuse, do not add a new flag.

Pure-logic candidate: extract the predicate `wasVisited(history, statusTags)` ->
orders-logic.js; setSchedule calls it. Test: scheduled-but-not-visited -> first
schedule tag (not return); scheduled+visited -> returnschedule.
Collateral: setSchedule also auto-sets status from the tag; verify the status
auto-set still fires correctly under the new predicate.

## A3 — #12b MSR Created date scraped as wrong field

Symptom: dateCreated = the WO's last-modified / completed date, not the
accept/created date. (WO accepted != 24 Jun as recorded.)

Root cause: scraper-extract.js:414 —
`bodyText.match(/(?:Work Completed|Scheduled Start Time)\s+([\d\/]+)/i)` — pulls
Work-Completed / Scheduled-Start, then falls back to today. Neither is the
accept date.

Fix spec: identify the correct MSR field label for accept/created date by
inspecting the committed fixture `test/fixtures/wo-dump-MSR-1779482947336.json`
(its innerText/html). Update the regex/selector to that label. If MSR does not
expose an accept date in the captured DOM, ASK before falling back.
Test: extend the MSR branch of extract.test.js / a new case asserting
dateCreated matches the fixture's true accept date. Fixture-backed, gateable.
Collateral: dedup + ageDaysFor + throughput all consume dateCreated — a correct
date may shift aging buckets for re-imported WOs (acceptable; that is the point).

## A4 — #13 auto-reject cancelled/trash imports + notify

Symptom: cancelled/trashed WOs get re-imported; user not told.

Code reality: BULK AMH already handles this — captureAllAMH builds a `trashed`
set from `o.deleted` (app.jsx:5147), skips (5166), counts `trashedSkipped`,
toasts. Gap = the OTHER import paths:
- single AMH capture (captureOrder) — confirm it consults the same trashed set;
- MSR / extension `onImport` (app.jsx:3978) — likely no skip;
- notification wording on the single/MSR paths.

Fix spec: reuse the existing trashed-set mechanism (rule B3 — wrap, don't
reimplement). Factor the "is this WO trashed/cancelled in-app?" check into one
helper consulted by single + bulk + MSR/onImport. Notify via the existing toast
+ trashedSkipped pattern.
Test: pure helper `isTrashedImport(incoming, ordersById)` -> orders-logic.js,
unit-tested. The wiring into onImport/captureOrder is verified live.
Collateral: must not skip a WO the user UN-trashed (restored) — key off current
`deleted`/tab state, not stale history.

---

## Sequencing within Batch A

1. A2 (#12a) — clearest root cause, pure predicate, fast gated win.
2. A3 (#12b) — fixture-backed; needs MSR field confirmation from the dump.
3. A4 (#13) — reuse existing mechanism; extend to single/MSR paths.
4. A1 (#8) — REPRODUCE FIRST (live), then centralize the clear rule.

Each lands as its own commit after `npm run verify` is green.
