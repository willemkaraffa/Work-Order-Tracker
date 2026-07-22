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

## Running totals

raised 3, stood 0, real 0, wrong 0. Reviewer precision so far: 0/3.

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
