---
at: 2026-09-14T15:57:07.296Z
role: observation
action: L1-lock-pins-6400a32-after
outcome: matched
intent: docs/intent/2026-09-14-po-frame-hooks.md
sha256: 76cf32169344486baae1730fc50a2e8a2b78f59628e731173316ff8fa6f9c643
observation: L1-lock-pins-6400a32
phase: after
kind: flip
expected: exit 0
exit: 0
matched: true
head: 98895f4
---

## observation / L1-lock-pins-6400a32-after

### Instruction sent (verbatim)

```text
node -e "process.exit(require('./package-lock.json').packages['node_modules/project-overseer'].resolved.endsWith('#6400a3212b477b3ac7cfd4cb905254bc3678c202')?0:3)"
```

### Reply received (verbatim)

```text

```
