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
| 1 | Commit-authority gate: coder may not run `git commit` / `git push` / type the trailer | The human's ruling in section 0 is currently unenforced | Bash `agent_id` probe | DONE, armed `1c44d41` |
| 2 | Scoped grants: lock re-checks a recorded path list | Grant is unscoped today | none | DONE (uncommitted) |
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

**Next session: item 2** (scoped grants), then 3.

---

## 7. Session log, 2026-07-24: item 1, the commit-authority gate

Shipped as `bb95245`: `.claude/hooks/commit-authority-gate.js` plus 28 tests in
`test/commit-authority-gate.test.js`. Blocks a subagent (`agent_id` present) from
`git commit`, `git push`, `git tag`, `gh pr create`, `gh release`, `npm publish`, and
from typing the `Role-Definition-Approved:` trailer in a command, an `Edit`
`new_string` or a `Write` `content`. No `agent_id` passes unconditionally.

**ARMED in `1c44d41`, and PROVEN LIVE.** It first shipped inert: the human answered the
role-lock prompt "Keep locked", so the gate was registered nowhere. They then unlocked
it, and it now runs first in the `Bash`, `PowerShell`, `Edit` and `Write` `PreToolUse`
chains, with the file in `overseer.json` `guards` and `roles.locked` like its three
siblings.

The proof is not the test suite. A read-only probe subagent ran two commands:
`git status --short` returned the working tree, and `git tag --list` was REFUSED with
exit 2 and the `[commit-authority]` message. The overseer's own shell calls in the same
session were unaffected. Two things that were assumptions are now measured: the
`agent_id` discriminator works end to end through the real harness, and **hook edits to
`.claude/settings.json` take effect MID-SESSION**, with no restart.

**Accepted over-block:** `git tag --list` is read-only but matches the `git tag` verb, so
a subagent cannot list tags. Narrowing the verb to its mutating forms would mean a second
parser for no benefit at this size. Recorded so the next reader knows it is a decision,
not an oversight.

**A BYPASS SURVIVED ARMING, fixed in `aec8f2d`.** The verb matcher required the head word
and the verb to be ADJACENT, so any standard global flag between them walked through:

```
allowed   git -C . commit -m x
allowed   git --no-pager commit -m x
allowed   npm --prefix . publish
blocked   git commit
```

The gate was armed, live-proven, and wrong, all at once. `git -C <path> commit` is not an
exotic evasion; it is what a subagent working out of a subdirectory types.

The fix is the mechanism: between the head token and the verb tail, allow a run of FLAG
tokens and their values, and nothing else. Flag and value tokens exclude `;`, `&` and `|`,
so a run cannot straddle a command separator. Multi-word verbs match head-then-tail, so
`gh --repo o/n pr create` blocks as well. The looser rule of matching head and verb
anywhere in one command segment was REJECTED and the reason is in the code comment: it
regresses `git stash push` and `git log --grep commit`, both correct today.

Verified by a 14-case shell probe piping payloads into the real hook: 5 blocked as
required, 9 allowed as required. Two accepted over-blocks remain, both needing a flag
value literally named after the verb (`git -C commit status`, and the non-real
`git --grep commit`). Both fail toward the gate.

**THE METHOD LESSON MATTERS MORE THAN THE REGEX.** The reviewer ran on the very commits
carrying this bypass and never went near it. A fourteen-line shell loop found it in one
call. A gate is a thing that either fires or does not; PROBE IT WITH REAL PAYLOADS, do
not review it by reading. Every claim in this document that rests on reading rather than
running should be treated as unproven until someone runs it.

**Spawn 2 was used this session**, patch-level, on the human's explicit instruction after
the bypass was reported. Section 4 permits that once the human is alerted. Verify budget
2 of 2, green on the first attempt.

**Still open, in the order they should be taken:**

1. **Reorder the model chain.** Put `gemini-flash-latest` ahead of `gemini-3.1-flash-lite`
   in `MODELS` and drop the 404 entry `gemini-2.5-flash`. This is the highest-value item
   on the list: it is a one-line change that upgrades every reviewer and architect call
   the project makes. It lives UPSTREAM in `C:\dev\Project-Overseer`, so it carries the
   push-and-install loop.
2. **Delete the dead `blockedVerbs` config-override branch.** It reads
   `roles.commitAuthority.mayNotRun`, a key deliberately never added when `overseer.json`
   was armed, so it has never executed and has no test. Drop `blockedVerbs()`, use
   `DEFAULT_BLOCKED` directly, drop the now-unused `path` require. KEEP the
   `words.length < 2` guard in `verbMatcher`: it stops a future one-word verb from
   silently building a broken regex. Ruled by the human 2026-07-24 to defer rather than
   take a third coder spawn.
3. **Two bypass candidates, still walking through the fixed matcher**, both surfaced by
   the `gemini-flash-latest` eval above:

```
rc=0  git-commit -m x     dashed plumbing form
rc=0  git ci -m x         alias form
```

   Low severity TODAY, and the reason is measured, not assumed: modern git removed dashed
   forms from `PATH`, and `git config --get-regexp '^alias\.'` returns nothing on this
   machine. Either change makes them live. A fix would need the alias set read at gate
   time, which is a real design question, not a regex tweak.

**The verb list is a constant, not pure config, and that was forced.** `coder-role-gate.js`
reads its scope wholly from `overseer.json` and fails OPEN (empty list) on a missing key.
Copying that here would have produced a gate that enforced NOTHING while looking
installed, because `overseer.json` was locked and the key could not be created. So
`DEFAULT_BLOCKED` is the floor and `roles.commitAuthority.mayNotRun` overrides it only
when present and non-empty. The override branch is therefore UNTESTED: the key does not
exist and faking it against a fixture `cwd` would test the fixture, not the real config.

**Spawn budget: 1 of 1.** One `builder`. The scope shrank mid-session when the unlock was
refused, and the plan was re-drafted by the architect on the smaller file set BEFORE
dispatch rather than after, so the refusal cost a Gemini call and no coder spend.

**The reviewer scored 0 for 2. Third consecutive session at zero.** First finding: that
concatenating `new_string` and `content` could split the trailer across the boundary,
dismissed because the two are joined with `\n`. Second, on the arming commit: that
registering the gate on `Bash` creates a circular dependency, dismissed because the hook
is a child process reading stdin that issues no tool calls and so cannot re-enter itself.
Both were answerable from the code in front of it. A third run, on the bypass fix, raised
nothing at all.

### RETRACTED: the reviewer was never the problem. The MODEL was.

An earlier draft of this section called the reviewer structurally guessing and cited a
0-for-N record across three sessions. **That verdict is withdrawn.** It rests on a
confound nobody checked until it was tested:

```
MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest', 'gemini-2.5-flash']
```

Every reviewer and architect call this session logged `gemini-3.5-flash: 503` or
`429: trying next model`. All of them ran on `gemini-3.1-flash-lite`, the lite fallback.
**The intended model never answered once.** A score against a model that never ran is not
evidence about the role.

**The eval that settled it, with ground truth known in advance.** The PRE-fix hook from
`bb95245` was handed to `gemini-flash-latest` with a plain correctness question. In ONE
call it named:

```
git -C . commit -m "msg"          the exact bypass the lite model missed twice
git --no-pager commit -m "msg"    same
git -c user.name="Dev" commit     same
git-commit -m "msg"               NEW, nobody had found it
git ci -m "msg"                   NEW, alias form
```

**Model chain, probed id by id rather than assumed:**

```
gemini-3.5-flash       429 on the free tier with billing off   primary, never answers
gemini-3.1-flash-lite  answers everything, weak                serves every call today
gemini-flash-latest    works, clearly stronger                 sits third, never reached
gemini-2.5-flash       404, the model does not exist           dead entry
```

**The rubric is NOT at fault, checked rather than assumed.** A suspicion that
`gemini-review.js` was eating safety refusals is withdrawn: its rubric is a plain
code-review prompt with no adversarial framing. The one refusal observed came from the
overseer's own eval prompt, which asked for "bypasses for a security gate" and was
refused outright; rewording it as a correctness question got the full answer above. That
is a lesson about how to ask, not a defect in the reviewer.

**Generalisable, and it cost a wrong verdict in a permanent document to learn:** a role's
quality verdict is INVALID unless the model that actually served the calls is known. The
fallback chain is silent by design and the served model is printed only in a log line
nobody was reading. Log the served model with every scored run.

**The coder found three holes the brief did not anticipate**, all recorded in the hook:
`git commit-tree` and other hyphen-extended plumbing needed `(?![\w-])` rather than `\b`;
quoted or variable-indirect commands (`git "commit"`, `$v="git push"; iex $v`) walk
through any string matcher; and `agent_type` is unused, so an architect ever run as a
subagent would be blocked despite holding the authority.

### New defects, belonging in section 2

6. **The approval channel key-matches the question text EXACTLY.** `user-grant.js` does
   a `hasOwnProperty` lookup on the question string, so `plan-approve.js` sees nothing
   if the `AskUserQuestion` carried any extra body text alongside the required
   sentence. It cost a wasted human round-trip this session: the human pressed
   "Approve" and the script reported "no human approval on record", which is
   indistinguishable from a refusal. A `startsWith` or normalised match would fix it.

7. **`verify-budget-guard.js` keys on command TEXT, not on gate runs.** Citing the
   literal string `npm run verify` as `plan-step.js` evidence counted as a gate run.
   It fired "you have run the FULL GATE 4 times" in a session that ran it twice, once
   by the coder and once by `pre-commit`. A warning that cries wolf is training to
   ignore it, which is the same failure mode as an advisory gate.

8. **A COMPLETED plan cannot be closed.** `.plan.json` stays `status: approved` with
   every step done, and `ACTIVE` in `plan.js` has no terminal state, so a finished plan
   keeps enforcing its scope over all unrelated work indefinitely. The only exit is to
   overwrite it with the next plan, which is what this session did to update this very
   document. There is no sanctioned "done" write path; `plan-step.js` reaches only
   `done` and `evidence`.

---

## 8. Session log, 2026-07-27: item 2, scoped grants

**DONE, uncommitted.** Defect 1 (section 2) is closed: the unlock grant is no longer
session-wide across every locked path.

**Mechanism, ruled by the human: bake the path into the question.** `role-lock.js` no
longer holds a fixed `QUESTION` constant. It builds
`Unlock the role definition for editing "<rel>"?` from the exact repo-relative file it
is checking, and reads the human's answer to THAT string. A grant for `overseer.json`
does not match the question for `.claude/settings.json`, so it does not unlock it.
`lastUserGrant` is reused UNCHANGED; no new state file, no new `overseer.json` key. Several
files in one shot go through `AskUserQuestion`'s questions array, one question per path.

The alternative (item 2's title, "record a path list the lock re-checks") was put to the
human and REJECTED in favour of the above: same scoping guarantee, less machinery, and it
touches nothing but `role-lock.js`.

**Does NOT worsen defect 6.** The exact-match in `user-grant.js` is a hazard for questions
carrying extra body text, but `role-lock` reconstructs the question deterministically from
`rel` with no extra text, so match is exact by construction on both ends.

**Verified: `npm run verify` green, 21 pass / 0 fail.** The load-bearing test is new:
`a grant for one locked path does not unlock another` proves the scope bites (grant for
`overseer.json` -> status 0; same transcript, `.claude/settings.json` -> status 2). Build
produced `bundle/app.js`; lint 98 warnings / 0 errors (pre-existing).

**Spawn budget: 1 of 1.** One `builder`. The edit target `.claude/hooks/role-lock.js` is
BOTH locked and overseer-`mayNotWrite`, so it needed a subagent (for `coder-role-gate`)
AND a human unlock (for `role-lock` itself). Both cleared: `role-lock` read the grant off
the PARENT transcript on the subagent's PreToolUse, confirming again that the human's
answer in the main session is visible to a dispatched coder. The design fork and the
unlock were settled in ONE `AskUserQuestion` before dispatch, so the spawn ran on a
settled spec.

**Reviewer: NOT run.** The Gemini reviewer scored 0-for-N until the model reorder in
`7495de1`, and this change is small with its scope proven by the new test. Deferred to the
human's call rather than spent by default.

**Item 3** (spawn limiter): BUILT + ARMED + LIVE-PROVEN 2026-07-27 (`bcec985`), see
section 9. Authority items 1-3 all shipped.

---

## 9. Item 3 spawn limiter: BUILT + ARMED + LIVE-PROVEN (2026-07-27, `bcec985`)

**Shipped exactly as the design below.** Built by ONE `builder` spawn (the two new files
`.claude/hooks/spawn-limiter.js` + `test/spawn-limiter.test.js`, 9 cases green). The two
LOCKED registration files (`settings.json` Agent chain after role-router.js; `overseer.json`
guards + roles.locked) were edited by the MAIN thread, not the builder: the builder toolset
has no `AskUserQuestion`, so it cannot obtain the path-scoped unlock grants; the overseer got
them and did those edits (overseer may write those once role-lock is satisfied). Live-proven
against this session's real transcript: 1 prior builder meta -> a simulated coder `Agent`
call counted n=2 and BLOCKED without a grant; an `Explore` payload ran free. Probe gotcha:
pass a Windows-native transcript_path; an MSYS `/c/...` path makes Node's readdirSync fail ->
count 0 -> false allow. Fresh Gemini review clean.

The settled spec, as built:

**Rule enforced:** 1 coder spawn free, 2nd needs a human grant, 3rd+ hard-blocks as a
declared major system failure (doc section 5). Read-only spawns are unlimited.

**Two forks ruled by the human 2026-07-27:**
- **Count scope: CODER spawns only.** Read-only investigators / `Explore` / `Plan` run
  free and do not count. The budget is about the "one coder spawn" discipline, and a
  13.6k investigator before a builder is normal, not abuse.
- **2nd-spawn grant channel: the structural `AskUserQuestion` read**, same forge-proof
  mechanism as `role-lock` (`lastUserGrant`), NOT a new channel.

**New hook `.claude/hooks/spawn-limiter.js`, PreToolUse on `Agent`.** Registered in
`settings.json` Agent chain AFTER `role-router.js`, so reviewer/architect spawns (which
role-router blocks first) never reach it and never count. Fails OPEN on any error.

**Counting, derived from `transcript_path` alone (no `projectKey` needed, and this is what
makes it testable):** the transcript lives at `.../projects/<key>/<sessionId>.jsonl` and
subagent metas at `.../projects/<key>/<sessionId>/subagents/agent-*.meta.json`. So
`dir = path.dirname(transcript_path)`, `sessionId = path.basename(transcript_path,'.jsonl')`,
subagents dir = `path.join(dir, sessionId, 'subagents')`. Count `*.meta.json` whose
`agentType` (the field is confirmed present: `{"agentType":"builder",...}`) is in
`CODER_TYPES`, lowercased. The meta is written at spawn START, and the CURRENT spawn's
PreToolUse fires BEFORE its meta exists, so the count is exactly the number of PRIOR coder
spawns. Confirmed on a live session: one item-2 `builder` meta present, its jsonl still
being written.

Do NOT reuse `cost-ledger.spawnCount` (it cannot filter by type) nor `agentsFor` (it runs
a full-jsonl `tally` per agent purely to count, needless IO on a per-spawn hook). A ~6-line
inline meta-reader is the right size; it reads the same files, so it is not a parallel
system.

**`CODER_TYPES`** (write-capable, lowercased): `builder`, `editor`,
`caveman:cavecrew-builder`, `general-purpose`, `claude`. Accepted imprecision: type is a
proxy for capability. `general-purpose`/`claude` are catch-alls that CAN write, so they
count (conservative); a write task mislabeled `Explore` would slip, a read task labeled
`general-purpose` over-counts. Good enough, documented.

**Logic.** `n = priorCoders + 1`.
- `n === 1` -> allow.
- `n === 2` -> `ans = lastUserGrant(transcript_path, 'Grant a second coder spawn this session?')`;
  allow iff `/^grant/i` on `ans.trim()`, else BLOCK (exit 2). Message: this is spawn 2;
  per section 5 it needs the roles revised and roughly patch-level scope, and the human's
  grant via `AskUserQuestion` with that EXACT question; forging the answer is tampering.
- `n >= 3` -> BLOCK (exit 2), NO grant path. Message: spawn 3 is a declared major system
  failure (section 5). Stop, report it, re-examine the approach (rule C2). A grant cannot
  open this; a persisted `Grant` from spawn 2 does not carry over.

**Non-Agent tool, read-only type, or missing `transcript_path` -> return (allow).** No
provable count means no block, consistent with the fail-open posture of the other gates.

**Tests `test/spawn-limiter.test.js`** (node + spawnSync, fixture a temp
`<sessionId>/subagents/` with N coder metas, point `transcript_path` at a sibling temp
`.jsonl`):
- coder type, 0 prior coder metas -> 0.
- read-only type (`Explore`), 2 prior coder metas -> 0 (not counted, not limited).
- coder type, 1 prior coder meta, no grant -> 2.
- same, with a real `AskUserQuestion` `Grant` in the transcript -> 0.
- forged `Grant` in Bash stdout -> 2 (load-bearing, like role-lock's forge test).
- coder type, 2 prior coder metas, WITH a valid grant present -> 2 (spawn 3 ignores grant).
- non-coder metas present do not push a coder spawn over its limit (a `cavecrew-investigator`
  meta among the priors is not counted).
- non-Agent tool -> 0; garbage stdin -> 0 (fail open).

**Registration (all locked, so next session needs the role-lock unlock grant + a coder
subagent + a `Role-Definition-Approved:` trailer on commit):** add `spawn-limiter.js` to
the `settings.json` Agent matcher after `role-router.js`; add
`{ "file": "spawn-limiter.js", "label": "spawn limiter" }` to `overseer.json` `guards`; add
`.claude/hooks/spawn-limiter.js` to `overseer.json` `roles.locked` so the gate cannot later
edit itself, like its siblings.

**Dispatch note (DONE):** item 7 applied. Vetting the spec as a coder prompt before spawn 1
caught the split the dispatch brief missed: the builder toolset has no `AskUserQuestion`, so
the two LOCKED-file registrations could not go to the subagent and were done by the main
thread instead. Everything else built as written.
