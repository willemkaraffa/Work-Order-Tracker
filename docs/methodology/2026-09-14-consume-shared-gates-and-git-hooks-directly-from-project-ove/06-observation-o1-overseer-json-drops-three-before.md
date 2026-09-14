---
at: 2026-09-14T15:30:53.602Z
role: observation
action: O1-overseer-json-drops-three-before
outcome: matched
intent: docs/intent/2026-09-14-po-frame-hooks.md
sha256: 76cf32169344486baae1730fc50a2e8a2b78f59628e731173316ff8fa6f9c643
observation: O1-overseer-json-drops-three
phase: before
kind: flip
expected: exit 3
exit: 3
matched: true
head: 98895f4
---

## observation / O1-overseer-json-drops-three-before

### Instruction sent (verbatim)

```text
node -e "const c=require('./overseer.json');const g=JSON.stringify(c.guards)+JSON.stringify(c.roles.locked);process.exit(['coder-role-gate','spawn-limiter','commit-authority-gate'].some(h=>g.includes(h))?3:0)"
```

### Reply received (verbatim)

```text

```
