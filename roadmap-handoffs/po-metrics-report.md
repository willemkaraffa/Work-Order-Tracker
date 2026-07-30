# Project Overseer: Metrics Report

Status: SCOPE LOCKED 2026-07-30. No code yet. Source of truth for the PO metrics
PDF report. Built after this doc, collectors first.

## Purpose

Produce a repeatable, industry-standard PDF report that tracks the health of the
Project Overseer agentic system over time: hallucination rates, autonomy, role
adherence, gate efficacy, and spend. Every number is derived on-read from
on-disk ledgers so the report is auditable, not asserted.

## The agent roster (5 roles)

A PO metric is PER-ROLE, not per-model. The same model can fill different roles
and score differently; tag model + role per session and segment.

| # | Role | Model now | Authority | Hallucination surface |
|---|------|-----------|-----------|-----------------------|
| 1 | Overseer (front-facing) | Claude (main thread) | authority WITH human | false claims to the user (done/verified/passed), misreported gate state |
| 2 | Architect | Gemini | commit-acceptability judge | bad spec, wrong disposition |
| 3 | Coder / Builder | Claude (subagent) | advisory | invented API, false "it works" |
| 4 | Reviewer | Gemini | advisory | dismissed (fabricated) findings |
| 5 | Researcher | Tavily today (blunt search); a model later | advisory | ungrounded leads (a hallucination surface ONLY once a model fills it) |

Overseer is row 1 on purpose: its hallucinations reach the user directly, the
highest-stakes surface. It is also the agent that WRITES this report, so its own
numbers CANNOT be self-reported (self-grading conflict, the cite.js / no-self-judge
lesson). Overseer accuracy is measured by an independent ground truth (verify exit
code + git state + ledgers) compared against what the Overseer claimed.

## Metric categories (v1)

Industry definitions (from 2026 prior-art research, advisory): hallucination rate
target <3.2%, task success 87%+, steps-to-completion 3-5, missed-escalation <3%.

| # | Category | Data source | Measurable now |
|---|----------|-------------|----------------|
| 1 | Hallucination rate (per role) | see per-role below | reviewer YES; coder PARTIAL; overseer PARTIAL |
| 2 | Autonomy rate (human-free actions) | spawn grants + gate refusals per session | YES |
| 3 | Gate catch rate (caught vs escaped) | commit/review/plan/authority refusals vs bugs that reached main | YES |
| 4 | Rule precision | rule-registry scoreboard (tp/fp/precision) | YES |
| 5 | Role adherence / friction | role-router + role-lock + coder-role-gate + spawn-limiter firings; rule-registry G5 | PARTIAL (needs per-session log) |
| 6 | Efficiency / spend | cost-ledger: calls, tokens, spawn floor, verify-budget overruns | YES |
| 7 | Task success rate | gate-passed commits + verify green; needs a per-session outcome label | PARTIAL (some manual tagging) |
| 8 | Tool / spawn reliability | cost-ledger spawn deaths vs success (e.g. API 529 deaths) | YES |
| 9 | Groundedness / citation | cite.js + verify adherence | PARTIAL |

### Hallucination rate, per role (the industry definition, applied exactly)

Definition = ungrounded/fabricated outputs / total judged outputs, graded against
ground truth. The definition is not the problem; the denominator and the per-role
split are. Wire those and it is exact.

- Reviewer (Gemini): dismissed findings / total findings. In `.review-findings.json`
  today (52 dismissed / 66 = provisional). MUST split "architect ruled the finding
  false" (a real reviewer hallucination) from "coder had already fixed it" (NOT a
  hallucination). The cite.js lesson: symbol-absent conflates the two and overcounts.
  After the split, the reviewer rate is exact.
- Coder (Claude builder): false "done/works" claims + invented APIs, with the
  deterministic verify gate + the reviewer acting as ground-truth judge. Needs a
  collector that logs each verifiable claim and its verify/reviewer verdict, so the
  denominator (verifiable claims) exists. Then coder-hallucinations / verifiable
  claims per session is a true percentage.
- Overseer (Claude main): false claims to the user, judged by independent ground
  truth (verify exit + git + ledgers) vs the claim. NOT self-reported.
- Architect (Gemini): spec/disposition errors. Low volume; defer to v2.
- Researcher: none until a model fills the role.

## Report enrichments (fold-ins, all locked into v1 unless noted)

1. Trust tiers. Split hard-enforced metrics (a hook/gate produced the number,
   trustworthy) from advisory/self-reported (softer). Color each chart by tier. A
   green gate does NOT prove the judgment rules held. Highest-priority honesty
   feature. See [[reference_workflow_enforcement_map]].
2. Caught vs escaped ratio. Leading = defects caught before commit; lagging =
   defects that reached main. Track caught:escaped over time; healthy PO drives
   escapes toward zero. More meaningful than raw catch count.
3. Cost normalized by outcome. Not raw tokens. Tokens per committed feature and
   tokens per caught defect. Spawn floor (18.9k) x spawn count = overhead line.
4. Target bands on every chart. Draw the industry red-flag thresholds (hallucination
   <3.2%, task success 87%+, steps 3-5) so a point reads pass/fail at a glance.
5. Session metadata as controlled variables. Stamp each session with model,
   reasoning-effort, caveman level, task type. Enables segmentation instead of one
   blurred all-session line.
6. Negative-space / last-fired timestamps. A gate with zero firings for weeks is
   either perfect or silently dead (precedent: warn-only hook fired unseen all
   session; a skill sat inert for months). Track "gate last fired" so a dead sensor
   is visible.
7. Attribution integrity. Key every event on the TOOL that produced it
   (AskUserQuestion tool_use_id, hook exit code), never on role or text (Bash stdout
   is user-role but Claude-authored). Underwrites the accuracy of every count. See
   [[lesson_transcript_role_is_not_authorship]].
8. Per-report integrity line: the fraction of numbers independently verified vs
   Overseer-self-reported. The report grading itself.

## Graphs / accuracy

- Graph fidelity = data fidelity. Plots are exact vector charts of ledger numbers,
  not estimates. Provisional metrics are LABELED provisional on the chart, not hidden.
- "Models" = trendlines. With few sessions a trend is noise. Plot raw per-session
  points + a simple moving average, annotate n, NO forecasting until enough sessions.
- Toolchain: reportlab 4.5.1 (already installed) does PDF + native vector charts
  (reportlab.graphics.charts). matplotlib/pandas NOT installed and NOT required;
  avoid installing matplotlib on Python 3.14 (wheel-availability risk).

## Granularity (LOCKED)

Both: a snapshot summary page (current all-time state) + per-session trend charts
behind it. Per-session rows with a trailing moving average per metric.

## Build order (collectors first)

1. Collectors: small scripts that dump each metric to an auditable JSON the report
   reads. New logging needed for: coder verifiable-claims (hallucination denom),
   role-gate firings (category 5), session metadata (enrichment 5), gate last-fired
   (enrichment 6), reviewer dismiss-vs-already-fixed split (category 1 exactness).
   Reuse existing ledgers for the rest (rule-registry, .review-findings.json,
   cost-ledger, overseer-status).
2. Report script: reads the collector JSON, renders the PDF with reportlab (snapshot
   page + trend charts + target bands + trust-tier colors + integrity line).

Regenerate commands for the existing-data metrics:
```
node node_modules/project-overseer/scripts/overseer-status.js
node node_modules/project-overseer/scripts/cost-ledger.js
```

## Honesty caveats (carried into the report)

- Small n: 13/15 rules are `hypothesis`, only G4 `validated`. 80% overall precision
  is provisional.
- Reviewer FP rate may be overstated until the dismiss-vs-already-fixed split lands.
- Cost = tokens, not dollars, no cache model. "heavy verify runs" = hook-observed
  floor, not exact.
- Role-friction firings mean the guard CAUGHT an overstep, not that roles cooperated;
  report two numbers (attempts caught, oversteps that slipped to commit), not one.

## v1 scope (LOCKED)

IN: categories 1-6 and 8 (hallucination per role, autonomy, gate catch, rule
precision, role adherence, efficiency, spawn reliability), all 8 enrichments, both
granularities, reportlab PDF. Category 7 (task success) and 9 (groundedness) IN as
PARTIAL with manual/label caveats shown. Architect + Researcher hallucination rows
reserved, populated in v2.

OUT of v1: forecasting/statistical models, per-role architect hallucination, any
paid-model dependency.
