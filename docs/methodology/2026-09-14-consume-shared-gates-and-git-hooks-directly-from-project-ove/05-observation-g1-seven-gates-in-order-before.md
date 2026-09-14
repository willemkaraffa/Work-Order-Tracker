---
at: 2026-09-14T15:30:53.519Z
role: observation
action: G1-seven-gates-in-order-before
outcome: matched
intent: docs/intent/2026-09-14-po-frame-hooks.md
sha256: 76cf32169344486baae1730fc50a2e8a2b78f59628e731173316ff8fa6f9c643
observation: G1-seven-gates-in-order
phase: before
kind: flip
expected: exit 3
exit: 3
matched: true
head: 98895f4
---

## observation / G1-seven-gates-in-order-before

### Instruction sent (verbatim)

```text
node -e "const fs=require('fs');const p=fs.readFileSync('.githooks/pre-commit','utf8');const at=['review-gate.js','plan-check.js','changelog-check.js','falsification-check.js','fidelity-check.js','user-authority-check.js'].map(n=>p.indexOf(n));const post=fs.existsSync('.githooks/post-checkout')&&fs.readFileSync('.githooks/post-checkout','utf8').includes('session-start.js');process.exit(at.every((v,i)=>v>=0&&(i===0||v>at[i-1]))&&post?0:3)"
```

### Reply received (verbatim)

```text

```
