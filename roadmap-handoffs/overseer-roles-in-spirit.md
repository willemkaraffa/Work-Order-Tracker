# Operating the roles in spirit

Compiled 2026-07-23, from the point the human ruled that **the architect and overseer
are the only roles with authority to decide whether edits are acceptable to commit.**
The coder may stage, run tests, and execute a commit script. It may never rule that a
commit is acceptable.

This is the scope document. Nothing below is dispatched until the human has ruled on
the buckets in section 5.

---

## 1. What is BUILT and PROVEN today

All live-proven by running, not by reading.

| Thing | State | Proof |
|---|---|---|
| `coder-role-gate.js` | live | overseer Write to `test/` refused; subagent Write allowed |
| `role-lock.js` | live | refused before the human grant, allowed after |
| `role-lock-check.js` | live | real `git commit` REFUSED, `HEAD` unchanged at `8b672c2` |
| `overseer.json roles` | live | scope + locked list is data, read by both gates |
| read budget (`read-router.js`) | built, NOT live | upstream only, `C:\dev\Project-Overseer` |

39 tests across 4 suites. Reviewer run twice, architect triaged 4 findings, 0 open.

~~Nothing committed. Nothing pushed.~~ **Stale as of 2026-07-24.** All of the above
landed in `eb51804` (5 hooks, 4 test suites, `overseer.json` roles, both git hooks, this
doc). Still not pushed: this repo is 14 commits ahead of `origin/main` on
`fix/msr-scan-wrong-tab`.

The discriminator is `agent_id`, a top-level PreToolUse payload field present only on
subagent calls. Measured on Claude Code 2.1.217. `transcript_path` is the parent for
both and `isSidechain` is not visible to a hook; neither works.

---

## 2. DEFECTS found and NOT fixed

1. **The human grant is unscoped.** `lastUserGrant` matches on question text and
   returns the last answer. No file list, no expiry, no use count. The human granted
   two named fixes; the mechanism granted every locked path for the whole session.
   Fix: bake scope into the question, or record a path list the lock re-checks.

2. **Coder commit authority is ungated.** The coder was spawned `general-purpose`,
   which carries every tool. Nothing stopped it running `git commit`, typing
   `Role-Definition-Approved:` itself, or pushing. It did not, because it was told not
   to. That is discipline, not a gate.
   **Fact now MEASURED (2026-07-23):** a subagent's Bash payload DOES carry `agent_id`
   (probed via `cavecrew-investigator` running `echo`; log line showed `agent_id` +
   `agent_type` on a Bash call). The overseer's calls carry neither. So a PreToolUse
   Bash hook CAN block `git commit`/`push`/trailer when `agent_id` is present. Commit
   authority is enforceable at the shell for the current Claude-coder arrangement.
   Caveat: this inverts under an external overseer, which is why item 5 supersedes it.

3. **`agent_id` breaks model agnosticism.** It is a Claude Code field. If the overseer
   moves to another model, Claude Code becomes the coder, every call arrives with no
   `agent_id`, and the gate blocks everything. Polarity inverts.
   Replacement: a **dispatch token** written by the overseer before dispatch, so the
   gate asks "was this work dispatched" rather than "is this a Claude subagent".

4. **The commit trailer is forgeable.** A git hook has no session, so it cannot call
   `user-grant.js`. It reads a commit message Claude can type. It closes the
   shell-write hole, not the lying hole. Only the PreToolUse side is forgery-proof.

5. **`user-authority-gate` known gaps**, recorded as passing tests: a channel name held
   in a variable is invisible; the same edit in a file outside its five-filename
   whitelist walks through, while its message claims otherwise.

---

## 3. The COST MODEL, measured from this session's transcripts

No new instrumentation was needed; per-call usage is already in the transcripts.

```
MAIN THREAD        210 calls   cache read 24,385,710   ~116k per call
ALL SUBAGENTS       82 calls   cache read  3,713,656   ~50k per call
```

**Tool schema is a 3.2x per-call multiplier.** Call-1 context, before the agent acts:

```
13,465 / 13,482 / 13,503   cavecrew-builder   5 tools
41,676 / 42,568 / 44,131   general-purpose    every tool
```

~29.5k of pure schema, resent on EVERY call. Applied to the two builds: 1.24M of 2.48M
and 0.77M of 1.43M. **About half the coder spend was carrying unused tool schemas.**

Context growth within a spawn is secondary: 42.5k to 65.3k over 26 calls, about 22%.

**There is no server-side session.** Every call resends the whole conversation. A
persistent process does not avoid this; it only buys cache hits on a stable prefix
within the TTL. This is why `C:\dev\Overseer` was retired over spawn cost, and why the
retirement reason is now partly addressable.

**Cost estimator:** `est = floor + (files x ~6.5 calls x per-call context)`. Against
today it predicts 1.63M for both builds; actual 2.30M and 1.24M. Band roughly +/-50%,
tightening as a ledger accumulates.

**The estimator answers "should this be batched", not "is this worth it".** Cost is
floor-dominated, so a 1-file change costs nearly what a 3-file change costs. Benefit is
not computable and must not be faked. When the floor dominates, the correct message to
the human is "this spawn is mostly fixed cost, here is what could ride along for
nearly nothing".

### CORRECTION 2026-07-24: the floor does NOT dominate

The claim above was written from one session's numbers. `scripts/cost-ledger.js` now
derives the same figures from all 38 session transcripts on disk, and they do not
support it:

```
(any spawn)                 floor 25.2k + 19.5 calls x 34.5k    floor is  4% of a 3-file spawn
general-purpose             floor 42.0k + 19.5 calls x 51.5k    floor is  4%
builder                     floor 18.7k + 19.5 calls x 41.7k    floor is  2%
caveman:cavecrew-builder    floor 13.5k + 19.5 calls x 13.6k    floor is  5%
```

Per-call context (~34k) sits close to the floor (~25k), and a spawn makes many calls.
So the dominant term is context x calls, not the one-time floor. The batching warning
built for this never fires on real data at any realistic file count, and the threshold
was deliberately NOT lowered to manufacture a firing.

Two things follow. **The batching question is nearly moot**: bundling three items into
one spawn saves about two floors, roughly 50k against a 700k spawn, so the no-batch
ruling in section 4 costs far less than it was thought to. It stands on failure
isolation alone now, which is a better reason anyway. **The lever that matters is calls
and per-call context**, which is what the tool-schema finding and the read budget
already attack. `general-purpose` at 51.5k per call versus `cavecrew-builder` at 13.6k
is a 3.8x difference that repeats on every call of the spawn.

The 3.2x schema multiplier below is unaffected and still the largest single lever.

**Waste identified:** the interrupted dispatch (`a1d5a649`) ran 8 calls and died,
355,341 tokens, nothing landed. Cleanest evidence that the spec must be settled BEFORE
dispatch.

---

## 4. The PIPELINE, as ruled by the human

1. Human states intent.
2. **Overseer and human deliberate SCOPE** before the architect drafts. Overseer thinks
   in the spirit of the request, not its letter, and surfaces adjacent work to accept or
   defer. Surveys go through Gemini (`ask.js`), never through the overseer reading files.
   Lean toward asking. Human direction above all.
3. **Architect drafts** from the settled scope. It should also rule on whether the scope
   is COMPLETE for the intent, not only whether the plan is sound.
4. **Escalate to human** on the established triggers: looks unfeasible, or too
   consequential for an LLM to rule on alone.
5. **ONE coder spawn.**

**Spawn budget.** Spawn 1 is the target. Spawn 2 only after the other roles revised and
the human was alerted, delivering roughly patch-level instructions (magnitude is a
judgement, not a literal rule). Spawn 2 doing significant work, or any third spawn, is a
**major system failure** and must be reported as one.

**No batching (ruled 2026-07-23).** Build items are NOT bundled into one coder spawn to
share the fixed spawn cost. Bundling amortizes the ~50k floor once, but one spawn is one
blast radius: a mid-spawn failure on item N risks the in-flight items above it, and the
reviewer/authority separation is easier to keep honest one item at a time. The human
chose failure isolation over the cost win. **No-batch means one build item per SESSION,
not many coder spawns in one session**: the latter would trip this same limiter and the
one-spawn-per-session discipline. Cost is spread across sessions, never multiplied inside
one. Item 4 (minimal coder agent) ships first, so every later single-item session already
runs on the lean agent and pays roughly half the schema tax per call.

**Fault attribution.** Inadequate coder output is the fault of the roles that instructed
it, never the coder's, unless the coder slipped its bounds. Today: five spawns, every
defect traced to the overseer's instructions, no coder overstepped.

**Two distinct causes of a respawn, needing different fixes:**
- scope too narrow -> fixed by step 2
- spec defective -> fixed by the ARCHITECT ruling on the coder's PROMPT before dispatch

Both of today's spec defects (a self-contradictory glob rule; a never-read rule that
made the task impossible and forced shell writes) were visible in the prompt text alone.

**Coder variants.** Under-tooling is the expensive error: a missing tool kills the spawn
and costs a full floor plus a budget strike. Over-tooling costs a rounding error per
call. Err generous, few coarse variants:
- `editor`: Read, Edit, Write, Grep, Glob. Measured 13.5k.
- `builder`: the above plus Bash, to run tests and iterate. Default. Est 14-15k,
  NOT measured.
- possibly a preview-capable third, only if live UI verification is required.
The **architect** picks the variant, since it knows the file set and whether tests run.

---

## 5. SCOPE for the human to rule on

Nothing here is dispatched until these buckets are settled.

### 5a. Candidates, in the spirit of what has been asked

Status column added 2026-07-24.

| # | Item | Why it belongs | Depends on | Status |
|---|---|---|---|---|
| 1 | Commit-authority gate: coder may not run `git commit` / `git push` / type the trailer | The human's ruling in section 0 is currently unenforced | Bash `agent_id` probe | NOT BUILT, next |
| 2 | Scoped grants: lock re-checks a recorded path list | Grant is unscoped today | none | NOT BUILT |
| 3 | Spawn limiter: 1 free, 2nd needs human grant, 3rd blocked as declared failure | Enforces the budget | none | NOT BUILT |
| 4 | Minimal coder agent definitions (`editor`, `builder`) | ~half of coder spend is unused schema | none | DONE, live |
| 5 | Dispatch token replacing `agent_id` | Restores model agnosticism | design ruling | DEFERRED by ruling |
| 6 | Cost ledger harvester + estimator + batching warning | Data already on disk | 4 | DONE, `16e082d` |
| 7 | Architect rules on the coder PROMPT before dispatch | Both of today's defects were prompt-visible | none | NOT BUILT, run by hand |
| 8 | `overseer-status` reports roles, spawn count, cost ledger | Status omits everything built today | 3, 6 | DONE, `16e082d` |

Notes on the four that moved:

- **4** lives in `~/.claude/agents/`, which is GLOBAL, not per-project. Every project on
  this machine gets `builder`, `editor` and `reviewer`, not just this one.
- **6 and 8** were built together in one spawn, ruled by the human as one item on the
  grounds that 8 is a thin reporting surface over 6's data. They live UPSTREAM in
  `C:\dev\Project-Overseer`, on branch `feat/read-budget`, and are therefore **committed
  but not running here**: this repo consumes `project-overseer` from GitHub, so nothing
  changes in this checkout until that branch is pushed and reinstalled.
- **8's stated dependency on 3 was wrong.** Spawn count comes from counting
  `agent-*.meta.json` in the live session's `subagents/` dir, which needs no limiter and
  no new counter. When 3 is built it should read that same count rather than invent one.
- **7** was operated by hand this session and earned its keep: it caught two defects in
  the coder prompt before dispatch (a step to edit `test/run.js`, which auto-globs and
  needed nothing; and a reuse instruction pointing at `plan-approve.js`, which was
  outside the approved scope). Both were visible in the prompt text alone, again.

### 5b. Already in flight, needs a decision not a design

| # | Item | Blocked on | Status |
|---|---|---|---|
| 9 | Commit today's work | Comes AFTER Cost + Authority + Process items are done (human ordered In-flight LAST). THEN needs human approval + `Role-Definition-Approved:` trailer. Not before. | DONE early, `eb51804`. The ordering was overtaken: the work was committed with the trailer before the Cost items ran. Not pushed. |
| 10 | Read budget live | Push `Project-Overseer`, `npm install` here | COMMITTED `c958a7d`, still NOT live. Same push-and-install blocker as 6 and 8, so all three clear together. |

### 5c. Carried, unrelated to this thread

| # | Item |
|---|---|
| 11 | Notification does not fire on extension capture (open since 2026-07-22, undiagnosed) |

### 5d. Ordering, RULED by the human 2026-07-23

Deliver to the architect next session in this order: **Cost items (4, 6, 8) -> Authority
items (1, 2, 3) -> Process item (7) -> In-flight items (9, 10) LAST.**

The human chose "measure first" on the agnosticism-vs-ship-now question. That probe is
now done (defect 2 above): `agent_id` is present on subagent Bash, so the authority
items ARE buildable on it today. The dispatch-token question (item 5) is NOT resolved;
it is deferred, not dropped. If agnosticism becomes near-term intent, items 1 and 3 get
rewritten on the token. The human accepted that risk by ordering authority items before
the token decision.

Item 4 (minimal coder agents) leads because it depends on nothing and pays back ~half
the coder spend immediately. Every later coder spawn should already be running on a
minimal agent, so 4 is a prerequisite for the cost figures the rest assume.

---

## 6. Session log, 2026-07-24: the Cost items

Ran the pipeline from section 4 end to end for the first time.

**What happened.** Scope deliberated with the human on four rulings (bundle 6 with 8;
build upstream; derive on read with no state file; source spawn count from transcripts).
Architect drafted, human REJECTED the first draft because it would have landed on a
dirty upstream tree. Committed the read-budget work first (`c958a7d`), re-drafted on the
clean tree, human approved, ONE `builder` spawn, reviewer, architect triage, commit.

**Spawn budget: 1 of 1.** No respawn. Both prompt defects were caught before dispatch
rather than after, which is exactly the failure mode item 7 exists to prevent.

**The overseer's own facts were wrong, and the coder caught it.** The dispatch brief
asserted "every assistant line has `message.usage`". True but incomplete: one API call is
written as SEVERAL assistant lines, one per content block, all carrying the same usage
object. Measured: 269 lines against 123 distinct `requestId`s. Summing lines would have
reported the bill at about 2.2x and every number in section 3 would have been wrong in
the same direction. The ledger keys by `requestId`, and there is a test for it.

Worth generalising: the overseer measured this by hand last session and got it wrong. The
coder, forced to make the numbers reproduce a stated ground truth, found it. Ground truth
in the dispatch brief is what made that possible. Keep doing that.

**The plan gate needed an override to work at all.** `plan-approve.js` derives the
transcript key from ITS repo root, but the session ran from `Work-Order-Tracker` while
the plan lived in `Project-Overseer`, so it found no transcript and could not see the
human's answer. `WOT_TRANSCRIPT` pointed it at the real file. Cross-repo work is a hole in
the approval channel, not a one-off: any session driving a plan in another checkout hits
it. Worth fixing when the authority items are built.

**The reviewer scored 0 for 2 again.** One finding on each commit, both dismissed by the
architect, both misreads of code that was in front of it (a `path.basename` call three
lines up, in the second case). Consistent with the upstream handoff's claim that the
reviewer is structurally guessing. It cost two Gemini calls per commit to learn nothing.

**Next session: item 1** (commit-authority gate), then 2, then 3. One item.
