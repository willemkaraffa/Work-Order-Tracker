# Project Overseer: role hierarchy + the verbose-permission gate

Status: DESIGN AGREED, NOT BUILT. Written 2026-07-17. Supersedes nothing; sits
beside [project-overseer-extraction.md](project-overseer-extraction.md) (that doc
= repo structure; this doc = the operational chain of command + one concrete gate).

## Why this exists

Gates are STATIC: they forbid a KNOWN pattern (em-dash, --no-verify, thrash of a
scratch script). They cannot catch a NEW antic nobody pre-encoded. The expensive
failures live in that blind spot:

- Over-testing (this session, twice): no commit, so no gate fired; no peer watched
  the coder mid-run. The human had to be the live babysitter.
- Sole-judge dismissals: the coder (Claude) dispositioned its OWN reviewer's
  findings. A peer finding gets waved off; nobody could compel.
- Claude asserted "the gates work" and they did not (the thrash guard blocked its
  own review loop). No independent voice challenged the claim before the human did.

The fix is not more dumb gates. It is a CHAIN OF COMMAND: an independent superior
who receives findings, can compel, names novel bad behavior as it appears, and
escalates to the human only when warranted. Judgment is fallible, but so is a
static gate; the point is a second, higher, independent judgment in the loop
BEFORE and AROUND the action, not only a post-hoc diff review at commit.

## The chain of command

Authority flows down; findings and infeasibility flow up. Each layer can compel
the layer below and must answer to the layer above.

| Rank | Role | Model | Does | Answers to |
|---|---|---|---|---|
| 0 | **YOU** (human) | - | Sets the grand goal. Final authority. | - |
| 1 | **Overseer** | Claude (chat-facing main session) | Makes the grand plan WITH you. Tasks the architect. Escalation valve: decides what reaches you (like Claude Code asking which option). | YOU |
| 2 | **Architect** (+ Researcher as its assistant) | Gemini (external) | Drafts the STRUCTURED plan from the grand goal. Verifies feasibility. Hands plan to coder AND verifies the coder actually READ it. Receives reviewer findings and DISPOSITIONS them. Rejects an infeasible ask UP to you with reasons + alternatives. | Overseer |
| 3 | **Coder** | Claude (**Task subagent**, decided; see Probed facts) | Implements the plan. Cannot self-dismiss findings. Deviation from plan = trip back UP, not a silent pivot. | Architect |
| 3r | **Reviewer** | Gemini (external) | Catches bugs, coding errors, collateral damage. Reports UP to the ARCHITECT, never to the coder. | Architect |

Load-bearing insight: the reviewer reports to the coder's SUPERIOR, not the coder.
A peer's finding can be waved off (the sole-judge failure). A superior's finding
compels. This is AUTHORITY, not merely independence.

## Probed facts (RUN 2026-07-17, not assumed)

The coder-boundary decision hung on one unknown: do the gates still apply inside a
Task subagent? If they did not, moving the coder into a subagent would have bought
independence and lost the ENTIRE enforcement layer. Probed rather than assumed.

**Probe 1: do hooks fire inside a Task subagent? YES.**
A throwaway subagent was told to run `node scratch/hookprobe.js` three times and
report verbatim. Attempts 1-2 ran and node-errored. Attempt 3 returned
`PreToolUse:Bash hook error ... [verify-thrash-guard] BLOCKED`, and the command
never executed. The gates reach into subagents.

(The probe deliberately used the thrash guard on a nonexistent script, NOT
`git commit --no-verify`. Had hooks not fired, a `--no-verify` probe would have
produced a real gate-bypassing commit. Pick probes whose failure mode is inert.)

**Probe 2: are counters shared between parent and subagent? YES, one bucket.**
The guard's state file for this session (`wot-thrash-<session-id>.json`) contained
BOTH the subagent's `hookprobe.js` entries and the parent's `countprobe.js` entry.
Same session id, same file. A subagent does NOT get a fresh count.

**Consequences:**
1. **Coder = Task subagent. Q1 CLOSED.** Real context separation, zero loss of
   teeth, and no reset-by-spawn hole.
2. **Budgets are SESSION-wide, not per-agent.** A coder subagent burns the same
   verify budget as the overseer. So `verifyBudget` must be a TOTAL for the plan,
   never a per-agent allowance, or the overseer and coder silently compete for one
   pool and the first to spend it starves the other.
3. State is keyed by session id, so it dies with the session. Fine for thrash and
   budget (both are burst-scoped). Do NOT build plan state on this mechanism; a
   plan must outlive the session.

**Incidental fix found by the probe:** the thrash guard's own block message used to
end with "rename/relocate the script or wait out the window" -- it published its
own escape hatch. The subagent read it and reported it; it declined only because
the probe forbade acting. A guard that coaches its bypass trains circumvention.
Message now names renaming as TAMPERING and says to stop and tell the user
instead. Lesson generalizes: audit every block message for workaround coaching.

## Key mechanics

1. **Plan = the unit of approval (proportionality).** A plan is approved ONCE and
   authorizes every small change inside it; no per-edit permission. The roundtrip
   is per-plan, not per-rename, so the loop cannot cost more than it saves. (This
   session is the worked example: one audit goal approved, many edits under it.)
2. **Disposition authority moves OFF the coder.** Today the coder dispositions its
   own findings in `.review-findings.json`. That is the sole-judge hole. Findings
   route to the ARCHITECT; the coder cannot dismiss. `review-gate.js` already
   blocks commit until findings are dispositioned; only WHO holds the pen changes.
3. **Coder output is bound to plan steps by EVIDENCE, not attestation.** For each
   step marked done the coder cites what it changed and ran; the architect
   verifies the citation against reality. See "Q2 rejected: receipts" below.
4. **Escalation is bidirectional.** Architect deems an upstream ask unfeasible ->
   kicks it UP to you with why + alternatives. Overseer decides if a downstream
   flag warrants your attention.
5. **Architect = external Gemini, on purpose.** Independence (not Claude judging
   Claude) AND it owns the plan context, saving Claude credits. Task subagents are
   Claude-only, so the architect is a SCRIPT (like the reviewer), not a Task agent.

## Modularity is LATER

The Overseer Project's endgame is swappable models behind one-function seams
(see the extraction doc). Gemini is not the best non-Claude model; that is
accepted for now. Get the STRUCTURE working first, worry about plug-in models
after. Do not gold-plate seams before the chain of command actually runs.

---

## FIRST BUILDABLE: the verbose-permission gate

The immediate, agreed, self-contained piece. Lets the overseer speak past the
caveman length budget ONLY when the human grants it, using the app's native
confirm button. The ASK is the gate.

### Problem it solves

`length-check.js` (Stop hook) caps assistant PROSE at 2200 chars. Right for code
work; too tight for design discussion. When it blocks, the first (over-budget)
reply already streamed to the user, then the trimmed rewrite streams too = the
user sees the message TWICE ("double printing"). Three design turns tripped it.

### Mechanism (VERIFIED this session, not assumed)

- The human grants via `AskUserQuestion` (the app's confirm button). Claude emits
  the question; Claude CANNOT emit the answer.
- The answer is written to the transcript by the harness as a USER-role
  `tool_result`, verbatim: `been answered: "<question>"="<answer>"`.
  - Verified: `grep` of the live transcript shows the exact string.
- FORGE HOLE (found + closed): that same phrase also appears in Claude's own
  ASSISTANT messages when it echoes the question. A naive grep is forgeable by
  Claude. Verified: the phrase occurs in BOTH `role:user tool_result:true` AND
  `role:assistant` entries. So the hook MUST match ONLY user-role tool_result
  entries. Claude cannot author those -> forge-proof.

### Spec

- Overseer calls `AskUserQuestion`: question (STABLE text) "Speak verbosely here?",
  options `Verbose ON` / `Stay caveman`.
- `length-check.js` scans USER tool_result entries for the LAST answer to that
  exact question:
  - `Verbose ON` -> SKIP the length check entirely (no char budget) for the
    current discussion (persists until a later `Stay caveman` answer).
  - `Stay caveman` or no grant -> 2200 as today.
- em-dash / emoji checks stay ON always. Verbosity lifts the LENGTH budget only;
  it is never a license for banned glyphs.
- Scope: the lift is per-discussion (this chat), revocable. It does not persist to
  a fresh session; a new session starts caveman-capped.

### Decisions (settled)

- When lifted: SKIP the length check entirely (not a higher cap).
- Only for that chat; revocable via a `Stay caveman` answer.
- The human holds the button; the overseer only requests. No self-lift.

### Build steps

1. Add `lastUserGrant(transcriptPath)` to `length-check.js`: walk the transcript,
   consider ONLY entries where role is `user` AND the entry is a tool_result,
   find the LAST one matching `been answered: "Speak verbosely here?"="..."`,
   return `ON` / `OFF` / none.
2. In `main()`: if grant is `ON`, return before the length check (keep running the
   em-dash / emoji checks). Else unchanged.
3. Test in `test/hooks.test.js` (black-box, spawn the hook):
   - a synthesized transcript with a USER tool_result `Verbose ON` -> a 5000-char
     reply does NOT block.
   - the SAME grant text placed in an ASSISTANT entry -> STILL blocks (forge-proof).
   - `Stay caveman` after an earlier `Verbose ON` -> blocks again (revoke).
   - em-dash still blocks even when `Verbose ON` (glyph rule survives the lift).
4. `node --check`, run `test/hooks.test.js`. Do NOT re-run the full gate more than
   the verify budget allows (the budget guard will nudge; heed it).

---

## Gates are the chain's enforcement arm

Not a rival layer. The architect is a Gemini SCRIPT; scripts have no authority
over Claude. A role's verdict becomes binding ONLY when a gate enforces it. So
for every authority the architect holds, name the gate that backs it.

Three checks that look like judgment but are deterministic:

| # | Check | Reads |
|---|---|---|
| 1 | An approved plan exists, bound to the tree | `status`, `baseCommit` |
| 2 | Touched files are inside the plan's scope | `scope.files` vs `git diff --name-only` |
| 3 | Behavior counts vs the budgeted number | `verifyBudget` vs the budget-guard's count |

Check 3 is the important marriage: proportionality is something NO gate can
judge, but "budgeted 2, ran 6" is a number a SUPERIOR can judge. Instrument the
behavior deterministically, escalate the number. Over-testing stops being
invisible, which is exactly the failure that started this design.

## The plan artifact

Reuses the `.review-findings.json` ledger pattern; does NOT invent a second
system. Live JSON control artifact, gitignored, archived to markdown on
completion.

```jsonc
{
  "id": "plan-2026-07-17-role-chain",
  "goal": "...",                    // overseer/human, prose
  "status": "draft|approved|rejected|complete",
  "baseCommit": "b078875",          // check 1: binding
  "feasibility": {
    "verdict": "feasible|infeasible",
    "why": "...",
    "alternatives": ["..."]         // REQUIRED when infeasible (the reject-up payload)
  },
  "scope": {                        // check 2
    "files": ["src/**", ".claude/hooks/*.js"],
    "allowNewFiles": false
  },
  "verifyBudget": 2,                // check 3. TOTAL for the plan, NOT per-agent:
                                    // overseer + coder subagent share one counter
                                    // (probed). Per-agent framing starves one side.
  "steps": [{                       // the coder's ONLY write is done + evidence
    "n": 1,
    "do": "...",
    "done": false,
    "evidence": { "files": ["src/foo.js"], "ran": "npm run verify" }
  }],
  "rulings": [{                     // scope-violation rulings, architect-written
    "files": ["src/foo.js"],
    "verdict": "widen|revert|escalate",
    "reason": "...",
    "by": "architect",
    "at": "2026-07-17T00:00:00Z"
  }],
  "approvedBy": "human|architect",
  "approvedAt": "2026-07-17T00:00:00Z"
}
```

**CRITICAL: plan binding is NOT review binding.** The review ledger goes stale on
any tree change, deliberately. A plan must SURVIVE changes, or you re-plan every
commit. So a plan binds to `baseCommit` and stays valid until `status: complete`.
Review staleness is a feature; plan staleness would be a bug. Do not copy the
staleness mechanism across without this distinction.

### Field ownership (this is where authority physically lives)

| Field | Writer |
|---|---|
| `goal` | Overseer |
| `feasibility`, `scope`, `verifyBudget`, `steps`, `status`, `rulings` | Architect ONLY |
| `steps[].done`, `steps[].evidence` | Coder ONLY |
| approval of an infeasible reject | Human |

The coder gets NO direct write path to the file. It writes through a script
(`plan-step.js`) touching only its two fields, same pattern as
`review-disposition.js`. Scope and budget are unreachable to it, so it cannot
widen its own leash.

### Q2 rejected: read-receipts. Adopted: evidence citation

The original Q2 asked how the architect verifies the coder READ the plan. Wrong
question, and the answer would have been theater.

**A receipt proves receipt, not compliance.** An LLM can paraphrase a plan it has
no intention of following. A restatement gate is an attestation, exactly the
"claim without evidence" this project distrusts everywhere else (rule F: report
verified only when verified). Building a gate on an attestation contradicts the
design.

**The failure it targets barely exists.** Three things are actually feared:
1. Coder never had the plan in context.
2. Coder drifts mid-work (scope creep, different approach).
3. Coder read it and rationalized past a constraint.

A receipt addresses only #1, which is solved STRUCTURALLY: the coder subagent is
spawned WITH the plan in its prompt. No plan, no spawn. The plan is in context by
construction. #2 and #3 are behavior, and a receipt says nothing about behavior.

**Adopted instead, wrapping a proven mechanism (rule B3).** `cite.js` makes the
reviewer supply a verbatim symbol and verifies it BY CONTENT; a finding whose
symbol is absent is auto-dismissed as unlocatable. Apply the same discipline
downward: every step marked `done` carries `evidence` (files changed, command
run), and the architect verifies the citation against reality (`git diff`, the
budget counter). A step claimed done whose cited evidence does not exist is not
done. This measures CONDUCT, not comprehension.

**Do not oversell it** (same caveat cite.js states about itself): citation proves
work HAPPENED, not that it was the RIGHT work. A coder can cite real changes made
for wrong reasons. Catching that is the reviewer's and architect's judgment, not
the citation's job.

### Scope violation: escalate, but block on the ABSENCE OF A RULING

Not on the violation itself. Otherwise escalation becomes the soft path Claude
walks straight through.

Flow: touched file outside `scope.files` -> commit refused, "out-of-scope, no
ruling on record" -> architect rules -> commit proceeds once a ruling exists.

- `widen` : legit discovery (the fix genuinely needed the adjacent file).
  Architect amends `scope.files`, reason recorded.
- `revert` : out-of-scope changes get backed out.
- `escalate` : a real plan change; goes up to the human.

**Drift counter:** repeated `widen` means the PLAN was wrong, not that the coder
found N surprises. At a threshold (start at 3) auto-escalate to the human.
Deterministic, no judgment needed.

**Forge-proofing:** the ruling script calls Gemini and writes the verdict itself.
Claude never authors ruling text and never hand-edits `rulings[]`. If Claude can
type the ruling, there is no architect.

## Q3 closed: findings storage, and why role-permissions are impossible

**Probe 2 kills a whole design class.** The coder subagent carries the SAME
session_id as the overseer (that is WHY counters are shared). So a hook cannot
tell the coder from the overseer. **Role-based permissions are not
implementable.** Any design of the form "block the coder from running X" is dead
on arrival. Do not attempt it; do not write rules that assume agent identity.

So: do not gate WHO writes. Gate WHAT can be written.

**Where findings live: the SAME `.review-findings.json`.** No second ledger
(rule 5: reuse the field that already holds the concept). It already carries
findings, status, and reason. Only the WRITER changes.

**Mechanism.** Replace `review-disposition.js` with a script that takes NO verdict
argument. It calls Gemini (the architect) and writes the verdict from the API
response. The caller can TRIGGER a ruling but cannot dictate its outcome, which
sidesteps the identity problem entirely: it no longer matters who runs it. Same
principle as the scope rulings: if Claude can type the verdict, there is no
architect.

The coder keeps one legitimate input: it may attach an ARGUMENT for why a finding
is wrong. That text is passed to the architect as EVIDENCE, not as a verdict.
Argument versus ruling is the whole distinction, and it is what was missing on
2026-07-16 when the coder was sole judge of its own reviewer.

**Layers against direct forgery** (same stack as the plan artifact):
1. PreToolUse blocks Edit/Write to `.review-findings.json`.
2. The same block across Bash and PowerShell, so redirection does not walk around it.
3. pre-commit prints every dismissal and its reason for the human.

**Honest residual:** `node -e` still writes any file. Unfixable locally; see the
forge section. Drift is the real adversary, and this stops drift.

**Cost and consequence:** every disposition becomes a Gemini call. Dispositions
are rare, so this is acceptable. It does mean a dead API blocks dispositions, and
there is deliberately NO override knob, consistent with the existing review-gate
stance. A knob Claude may turn is not a gate.

## How the architect gets invoked (Claude cannot skip it)

You cannot force Claude to CALL anything; Claude has the shell. So do not gate
the invocation. **Gate the ALTERNATIVE.** Make every forward path impossible
without the architect artifact, and Claude calls it out of necessity.

Two compulsion points, both running without Claude's cooperation:

1. **PreToolUse on Edit/Write:** no approved plan covering this file -> BLOCK.
   Claude cannot write a line until a plan exists. This also fixes the TIMING
   problem: it bites BEFORE tokens burn, not at commit.
2. **pre-commit (git-run, tool-agnostic):** checks 1-3 plus step evidence and rulings.
   Proven layer: a PowerShell call once walked through a Bash-only PreToolUse
   guard, but git hooks do not care which shell invoked git. See
   [[lesson_hook_coverage_hole]].

The hook only CHECKS for the artifact; it does NOT call Gemini itself (API
latency on every edit is unacceptable). Blocking is what forces the call.

### The forge problem, and its honest limit

Claude could hand-write `.plan.json` with `status: approved`. Layers:

1. PreToolUse blocks Edit/Write targeting `.plan.json`; only sanctioned scripts write it.
2. The same block across ALL shell tools (Bash + PowerShell), so redirection does
   not walk around it.
3. pre-commit prints the plan + architect verdict for the human. Forgery becomes
   visible, not silent.

**Stated, not hidden:** an agent with shell access can always forge a local file
(`node -e`, a new tool, whatever). No local gate survives a determined adversary.
But the real failure mode here is not adversarial, it is RATIONALIZED DRIFT
("verify does not cover scripts/", "I will just prove it once more"). Gates beat
drift. Design for drift, make tampering require deliberate visible action, and
route escalations through the harness-authored `AskUserQuestion` channel, which
is verified unforgeable.

## The adaptivity loop

How the system grows new teeth without the human hand-carving each one.

1. **DETECT.** At review time the architect is given the CURRENT RULE LIST plus
   one extra question: "did anything go wrong here that NO existing rule names?"
   Without the rule list in its prompt it cannot judge novelty.
2. **CLASSIFY into two lanes.** Test: decidable from tool-call metadata, file
   content, or counts alone, with no read of intent?
   - **Mechanizable** -> a hookify rule + hook + test. A real gate.
   - **Judgment** -> a rubric line in the architect/reviewer prompt. NEVER a gate.
   Getting this wrong is the classic failure: judgment rules shipped as gates
   misfire; mechanizable ones dumped into reminder prose go unread (the em-dash
   warn fired all session, invisible: [[lesson_hook_channels]]).
3. **PROPOSE** to a queue: the antic, the actual incident as evidence, the
   proposed check, the lane, expected false-positive risk.
4. **APPROVE.** Human, via `AskUserQuestion` (harness-authored, unforgeable).
5. **BIRTH.** Mechanizable: a `.claude/hookify.<name>.local.md` rule (8 already
   exist; this is the established path) plus a black-box test in the shape of
   `test/hooks.test.js`. Judgment: a rubric line.
6. **MEASURE.** Every firing logged and labeled true or false positive.
7. **RETIRE.** Precision under threshold auto-flags the rule for removal.

**Steps 6-7 are the half that always gets skipped, and they are the point.**
Adaptivity without pruning is rule bloat, which decays into the reminder pile
nobody reads. The loop must ADD and KILL.

Missing backing store (does not exist yet; the 8 hookify rules have no
measurement data):

```jsonc
{ "id": "verify-budget", "lane": "mechanizable", "status": "proposed|active|retired",
  "born": "2026-07-17", "evidence": "over-verified twice, ate half a session",
  "firings": 12, "truePositives": 9, "falsePositives": 3, "precision": 0.75 }
```

**Who labels a firing?** NOT the coder; it is biased toward killing rules that
constrain it. Labeling authority sits with the architect, same chain logic as
finding disposition.

**Proof the loop works:** this session ran it manually. Over-testing was novel,
no rule named it. Classified mechanizable (count heavy-verify runs in a window).
Became `verify-budget-guard.js`. Fired on the coder within minutes, on its own
first commit. The human was the architect. Automating it means the architect
detects and proposes; the human keeps the approval button.

## Conflicts with current code (must reconcile when building the chain)

- `review-disposition.js` today takes the verdict as a CLI argument, so whoever
  runs it decides the outcome. Under the chain it must take no verdict at all and
  write what the architect API returns. NOT a "who may run it" seam: that is
  unimplementable (see Q3).
- The reviewer (`gemini-review.js`) writes findings the coder reads. Under the
  chain, findings must surface to the architect first.
- There is no architect script yet. It does not exist. Building it is the bulk of
  the work and is NOT in this handoff's first-buildable scope.
- `.plan.json` needs a `.gitignore` entry alongside `.review-findings.json`
  (line 15) and `.gemini-key` (line 13). Without it, every plan write lands in the
  diff, which trips the plan's OWN scope check against itself.
- The rule registry backing the adaptivity loop does not exist either. The 8
  `.claude/hookify.*.local.md` rules currently carry no measurement data, so
  steps 6-7 (MEASURE, RETIRE) have nothing to read.

## Non-negotiables (inherited, do not regress)

- Gates block; agents advise. An agent's opinion never gates. See
  [[reference_workflow_enforcement_map]].
- No override knob for Claude. A knob Claude may turn is not a gate. The verbose
  lift is safe ONLY because the human, not Claude, authors the grant.
- Hooks: BLOCK to stop, additionalContext to nudge, never warn (systemMessage is
  invisible to the model). See [[lesson_hook_channels]].
- Guards fail OPEN; `node --check` after every hook edit. See
  [[lesson_hook_coverage_hole]].
- Findings ledger ACCUMULATES; a re-roll must not drop a finding.
- AGENT IDENTITY IS NOT AVAILABLE to hooks: a subagent shares the parent's
  session_id (probed). Never design a rule that depends on knowing which agent
  acted. Gate what can be WRITTEN, not who may write it.

## Open questions

1. ~~Coder as a Task subagent or the same main session?~~ **CLOSED 2026-07-17:
   Task subagent.** Probed: hooks fire inside subagents and counters are shared,
   so separation costs no teeth. See Probed facts.
2. ~~How does the architect verify the coder read the plan?~~ **CLOSED
   2026-07-17: wrong question.** Receipts rejected as attestation-theater;
   evidence citation adopted instead. See "Q2 rejected: read-receipts".
3. ~~Where do reviewer findings live so the coder cannot edit them?~~ **CLOSED
   2026-07-17: same ledger, different writer.** A separate ledger was the wrong
   answer; so was any role-permission scheme (impossible, see Probed facts).
   Verdicts come from the architect API response, never from the caller. See
   "Q3 closed: findings storage".

## Build order

1. Verbose-permission gate (self-contained, above). Ship first.
2. Move disposition authority to the architect (needs the architect to exist).
3. Architect script (Gemini): draft plan, feasibility, read-check, own findings.
4. Wire reviewer -> architect. Reject-up path to the human.
5. Confirm the chain BITES: stage a plan violation, confirm it is caught and
   escalated, not silently absorbed.
6. Adaptivity loop LAST, and only after the chain runs: rule registry (the
   backing store above), then DETECT/CLASSIFY/PROPOSE wired into the architect's
   review pass, then MEASURE/RETIRE. Built before the chain exists, it would be a
   rule generator with no superior to label its firings, which is how rule bloat
   starts.
