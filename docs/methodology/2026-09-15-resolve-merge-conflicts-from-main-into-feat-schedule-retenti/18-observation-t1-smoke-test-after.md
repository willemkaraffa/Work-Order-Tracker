---
at: 2026-09-15T18:58:30.995Z
role: observation
action: T1-smoke-test-after
outcome: matched
intent: docs/intent/2026-09-15-merge-main-into-schedule-retention.md
sha256: 911d1263c8512fb5475bd70b37f052f0ac64d0836c432489791498d5551156b7
observation: T1-smoke-test
phase: after
kind: invariant
expected: exit 0; contains "ALL PASS"
exit: 0
matched: true
head: f71bbf6
---

## observation / T1-smoke-test-after

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
