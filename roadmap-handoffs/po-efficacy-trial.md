# Project Overseer efficacy trial

HANDOFF.md item 2: every defect PO has caught so far was a bug in PO itself. There is
no evidence it has prevented a bad change from shipping in a real product. This file is
the evidence, accumulated over ordinary Work-Order-Tracker work.

**No new code.** A table, appended by hand, one row per commit. Building an instrument
to measure an unproven instrument is how the thing being measured survives measurement.

## What each column means

- **raised** findings the reviewer emitted this round.
- **stood** findings still standing after architect triage. This is the numerator that
  matters: a reviewer whose findings never stand is a reviewer that costs and does not
  catch.
- **real** of those that stood, how many were genuine defects that would have shipped.
  Judged later, by whether the fix mattered. Blank until known.
- **wrong** refusals that were WRONG: a gate that blocked a correct change, or a finding
  that stood and turned out to be false. Counts against PO, and it must be counted, or
  the trial only measures the direction that flatters it.
- **calls** Gemini round trips (review + triage + any argued disposition).
- **gate** did a deterministic gate refuse anything this commit, and was it right.

## The table

| commit | what | raised | stood | real | wrong | calls | gate |
|---|---|---|---|---|---|---|---|
| 9496445 | invoice search lock: capture root-mounted state | 3 | 0 | 0 | 0 | 2 | verify green first try; no refusal |
| 5df314e | invoice search lock: root cause, missing phoneMatches import | 0 | 0 | 0 | 0 | 1 | eslint no-undef, once enabled, catches it and blocks |

| ce09442 | MSR scan read the wrong browser tab; extension vendored + linted | 1 | 1 | 1 | 0 | 3 | scraper-data-gate REFUSED a blind scraper edit, correctly |

| fcf23d6 | MSR capture read fields from flattened innerText; now structural | 0 | 0 | 0 | 0 | 1 | scraper-data-gate refused a blind edit, then PASSED once a real dump was read; verify-thrash-guard blocked a 3rd run of a harness I had not scoped |

| 770b2b2 | remittance: multi-statement totals + refuse unrecognized files | 3 | 1 | 0 | 1 | 5 | review-gate REFUSED a stale review after a post-review edit, correctly |

## Running totals

raised 7, stood 2, real 1, wrong 1. Reviewer precision so far: 2/7, and one of the two
that stood was WRONG about live data.

**Round 5 is the first wrong refusal, and it is recorded as such.** The reviewer claimed
the MSR address regex could not match a 4-digit year. Measured before touching anything:
32 of 32 rows across all 6 real statements produce an address with the old pattern, so
the finding was false for every document that exists. It was fixed anyway, because the
described failure is a silently blank address rather than an error and layout hardening
is a standing requirement, but it is counted in the `wrong` column. Counting it as a
catch would be exactly the self-flattery this file exists to prevent.

Reviewer also raised a finding claiming `parse_text` returned 3 values where the code
returns 5. It returns 5, on the line it cited. The architect dismissed it as reading an
outdated version. That is the fifth misread-not-misjudged finding of the trial.

The gate that mattered again was deterministic: `review-gate` refused the commit because
the tree had moved after the review, which is precisely the case where a stale approval
would have covered unreviewed code.

**Round 4 is the clearest result yet, and again it is a gate, not the reviewer.** The
reviewer raised nothing on a diff that rewrote the MSR extraction mechanism. Two gates
did the work:

- `scraper-data-gate` REFUSED an edit to the scraper because no DOM dump had been read
  that session. The edit it blocked contained three guesses about a page never seen. It
  then passed the moment a real dump was in hand, and the dump immediately disproved the
  leading theory (lazy-render) and revealed the real one (label/value read out of
  flattened innerText).
- `verify-thrash-guard` blocked a third run of a test harness whose limits had not been
  scoped before writing it. That was a correct read of the pattern, and the block was
  accepted rather than routed around; the assertion was verified by the commit gate.

Neither is an LLM. Both are deterministic, both cost nothing per run, and both changed
the outcome. That is now three rounds of the same shape.

**Round 3 is the first evidence in PO's favour, and it is not the reviewer's.** The
strongest result was a REFUSAL: `scraper-data-gate` blocked an edit to `scanMsrList`
because no DOM dump of the failing page had been read that session. That edit was built
on three guesses about a page never seen, and the gate cited the prior incident
(WO 03907321, two blind edits, wrong both times). The correct diagnosis, a wrong-tab
pick, was found afterwards and needed no DOM knowledge at all.

The reviewer also produced its first true positive: `esc()` in the vendored extension
escaped `&`, `<`, `>` but not quotes, while being interpolated into `value="..."`
attributes. Verified against the source before it was accepted, then fixed.

Note what that costs to weigh honestly: the finding was in code being vendored, not in
code being written, and `no-undef` on the same file caught a defect in the same pass for
roughly no marginal cost.

**First real result, and it does not favour the reviewer.** The defect was a
whole-app crash reachable by typing one character into the invoice search bar:
`phoneMatches` used and never imported, so render threw and React unmounted the tree.
The reviewer looked at that exact file twice this session and raised 0 findings on it.
`eslint --rule no-undef` finds it in under a second, points at the line, and blocks the
commit. That rule was off for `src/` and is now on.

This is the comparison HANDOFF item 1 asks for: reviewer versus a linter plus the
deterministic gates. One data point, and the linter won it outright.

For context, not part of this trial: the frame's own repo ran ~44 findings with 2
standing before this trial opened, and 4 more with 0 standing on 2026-07-22. Those were
PO reviewing PO, which is the exact circularity this file exists to break.

## Rules for filling it in

1. Record the round even when it is embarrassing, in either direction.
2. Do not fill `real` at commit time. It is knowable only later.
3. A gate that refused and was RIGHT is the strongest evidence PO produces. It belongs
   in the `gate` column with what it caught.
4. Ten commits before drawing any conclusion. Three is noise.
