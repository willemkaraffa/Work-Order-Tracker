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
**Nothing committed. Nothing pushed.**

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
not many coder spawns in one session** — the latter would trip this same limiter and the
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

| # | Item | Why it belongs | Depends on |
|---|---|---|---|
| 1 | Commit-authority gate: coder may not run `git commit` / `git push` / type the trailer | The human's ruling in section 0 is currently unenforced | Bash `agent_id` probe |
| 2 | Scoped grants: lock re-checks a recorded path list | Grant is unscoped today | none |
| 3 | Spawn limiter: 1 free, 2nd needs human grant, 3rd blocked as declared failure | Enforces the budget | none |
| 4 | Minimal coder agent definitions (`editor`, `builder`) | ~half of coder spend is unused schema | none |
| 5 | Dispatch token replacing `agent_id` | Restores model agnosticism | design ruling |
| 6 | Cost ledger harvester + estimator + batching warning | Data already on disk | 4 |
| 7 | Architect rules on the coder PROMPT before dispatch | Both of today's defects were prompt-visible | none |
| 8 | `overseer-status` reports roles, spawn count, cost ledger | Status omits everything built today | 3, 6 |

### 5b. Already in flight, needs a decision not a design

| # | Item | Blocked on |
|---|---|---|
| 9 | Commit today's work | Comes AFTER Cost + Authority + Process items are done (human ordered In-flight LAST). THEN needs human approval + `Role-Definition-Approved:` trailer. Not before. |
| 10 | Read budget live | Push `Project-Overseer`, `npm install` here |

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
