---
at: 2026-09-14T18:50:59.319Z
role: observation
action: T1-gate-tests-pass-after
outcome: matched
intent: docs/intent/2026-09-14-po-frame-hooks.md
sha256: 9d9c9591e3c0ccf82c25d22eb55380f3c596724d5d611d97fea22044ad0f8d4c
observation: T1-gate-tests-pass
phase: after
kind: invariant
expected: exit 0; lacks "Cannot find module"
exit: 0
matched: true
head: 98895f4
---

## observation / T1-gate-tests-pass-after

### Instruction sent (verbatim)

```text
node test/coder-role-gate.test.js && node test/spawn-limiter.test.js && node test/commit-authority-gate.test.js
```

### Reply received (verbatim)

```text
  ok   overseer writing app code is BLOCKED
  ok   subagent writing the same file is ALLOWED
  ok   agent_id is what decides, not agent_type
  ok   overseer editing main.js is BLOCKED (the actual incident file)
  ok   overseer editing preload.js is BLOCKED
  ok   extension code is app code
  ok   python scrapers are app code
  ok   src at any depth is app code
  ok   the gate itself is now the coder's
  ok   harness scripts are now the coder's
  ok   tests are now the coder's
  ok   .claude/hooks/** is blocked for the overseer
  ok   the coder may still write all of it
  ok   docs are still the overseer's
  ok   test/** does not over-match testing/ (non-code path)
  ok   any .js is code under default-deny, incl testing/
  ok   a nested python file matches **/*.py
  ok   docs stay writable by the overseer
  ok   node_modules is not this repo app code
  ok   a path outside the repo is not app code
  ok   an absolute path INSIDE the repo is still app code
  ok   non-write tools are not this gate's business
  ok   missing file_path does not crash the gate
  ok   garbage stdin fails OPEN

all coder-role-gate tests pass
  ok   coder spawn with 0 prior coders is allowed (spawn 1)
  ok   a read-only current type is uncounted and unlimited
  ok   spawn 2 with no grant is blocked
  ok   spawn 2 with a real human grant is allowed
  ok   a forged Grant in Bash stdout does NOT allow spawn 2
  ok   spawn 3 is blocked even with a valid grant
  ok   a non-coder prior meta does not count toward the limit
  ok   a non-Agent tool is not this hook's business
  ok   garbage stdin fails OPEN

all spawn-limiter tests pass
  ok   subagent BLOCKED: git commit -m "x"
  ok   subagent BLOCKED: git push
  ok   subagent BLOCKED: git tag v1.2.3
  ok   subagent BLOCKED: gh pr create --fill
  ok   subagent BLOCKED: gh release create v1
  ok   subagent BLOCKED: npm publish
  ok   overseer ALLOWED: git commit -m "x"
  ok   overseer ALLOWED: git push
  ok   overseer ALLOWED: git tag v1.2.3
  ok   overseer ALLOWED: gh pr create --fill
  ok   overseer ALLOWED: gh release create v1
  ok   overseer ALLOWED: npm publish
  ok   extra whitespace between the words still blocks
  ok   a chained command blocks (verb is not at the start)
  ok   a verb after a semicolon blocks
  ok   REGRESSION (flag-between-words bypass): git -C . commit blocks
  ok   REGRESSION (flag-between-words bypass): git --no-pager commit blocks
  ok   REGRESSION (flag-between-words bypass): git -c user.name=x commit blocks
  ok   REGRESSION (flag-between-words bypass): npm --prefix . publish blocks
  ok   a multi-word verb behind a flag blocks (head/tail, not adjacency)
  ok   trailer in a Bash command blocks
  ok   trailer in a Write content blocks
  ok   trailer in an Edit new_string blocks
  ok   trailer in old_string ONLY is allowed (it is being removed, not written)
  ok   subagent ALLOWED: staging and read-only git
  ok   subagent ALLOWED: near-misses on the verb list (word boundary)
  ok   subagent ALLOWED: a non-flag word in the gap is not a flag run
  ok   subagent ALLOWED: a commit wrapper script (DOCUMENTED HOLE, intentional)
  ok   PowerShell is gated the same as Bash
  ok   agent_id is what decides, not agent_type
  ok   a tool the gate does not cover is not its business
  ok   missing tool_input does not crash the gate
  ok   missing command does not crash the gate
  ok   garbage stdin fails OPEN

all commit-authority-gate tests pass

```
