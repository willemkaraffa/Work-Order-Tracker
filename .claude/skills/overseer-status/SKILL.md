---
name: overseer-status
description: Report what Project Overseer is actually enforcing right now, read from disk. Use whenever the user asks whether the Overseer is on, running, or active, says "overseer status", "is PO on", "is the harness running", "are the gates working", invokes /overseer-status, or asks whether a session used the architect. Also use before trusting that a gate protected a change.
version: 0.1.0
---

# overseer-status

Run the script and show the user its output. That is the whole job.

```
node scripts/overseer-status.js
```

## Do not paraphrase the output

Print it. Do not summarise it into a reassuring sentence, do not re-describe the
design from memory, and do not add health claims the script did not make. The
entire point of this skill is that the answer comes from disk rather than from
Claude's account of itself. A summary reintroduces exactly the thing it exists to
remove.

Exit code is 0 when every enforcement point is active, 1 when there is a gap.

## What the sections mean, if the user asks

- **ENFORCEMENT** is automatic. These fire without being asked, including on
  Claude. A hook counts as live only when the file exists AND it is registered in
  `.claude/settings.json`; either alone is a disarmed guard that would otherwise
  look healthy. `GAP` means that protection is NOT running.
- **PLAN** only constrains edits when status is `approved`. A missing plan or a
  `draft` is the normal ad-hoc mode, not a fault.
- **SPEND** counts heavy-verify RUNS (full gate, build, test suite) that the
  PostToolUse hook observed, tallied per PLAN rather than per session, and compares
  them to the plan's `verifyBudget`. It is a floor, not a bill: it counts runs, not
  tokens, and a run started outside a hooked tool is invisible to it.
- **FINDINGS** shows the dismissal provenance split. `Claude self-judged`
  dismissals had no independent review; they are historical, from before the
  architect existed. `UNTRIAGED` or `ESCALATED` counts mean the commit is blocked.
- **RULES** shows `retired` rules, which have stood down by accumulated evidence.
  A retired rule genuinely stops firing; that is deliberate, not a gap.
- **ARCHITECT** is manual. There is no ambient architect and no daemon. Evidence
  it ran in a given session is architect-ruled dismissals or a freshly drafted
  plan, nothing else.

## The honest limit to state if asked "so am I safe?"

The gates cannot be skipped, including by Claude, and `pre-commit` is
tool-agnostic so switching shells does not route around it. But this reports
INSTALLATION, not correctness: a guard can be live and still be wrong, and this
session already produced one guard that fired on the wrong thing. Green here
means the machinery is running, not that its judgement was right.

There is currently no user toggle. The last-resort human override is
`git config --unset core.hooksPath`, which is deliberately visible and which
Claude must never run.
