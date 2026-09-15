---
at: 2026-09-15T16:20:14.534Z
role: observation
action: T1-smoke-test-before
outcome: matched
intent: docs/intent/2026-09-15-merge-main-into-schedule-retention.md
sha256: 30f842e5a35dbc6ced9357e0197ac2f8428366cb058802eb26a7851c365290e8
observation: T1-smoke-test
phase: before
kind: invariant
expected: exit 0; contains "ALL PASS"
exit: 0
matched: true
head: f71bbf6
---

## observation / T1-smoke-test-before

### Instruction sent (verbatim)

```text
node test/renderer-smoke.test.js
```

### Reply received (verbatim)

```text
renderer smoke
==============
  ok   empty data mounts without throwing
  ok   empty data root has rendered children
  ok   empty data error boundary did not catch
  ok   seeded WO mounts without throwing
  ok   seeded WO root has rendered children
  ok   seeded WO error boundary did not catch
  ok   seeded WO + S1a library mounts without throwing
  ok   seeded WO + S1a library root has rendered children
  ok   seeded WO + S1a library error boundary did not catch
  ok   ServiceLibrary mounts without throwing
  ok   ServiceLibrary renders children
  ok   L2 page sub-entry renders (HVAC)
  ok   Included sentinel renders verbatim
  ok   custom L1 category renders (Warranty)

ALL PASS

```
