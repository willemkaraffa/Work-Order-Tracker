---
at: 2026-09-14T19:41:40.445Z
role: observation
action: G1-git-hooks-are-stand-ins-before
outcome: matched
intent: docs/intent/2026-09-14-po-frame-hooks.md
sha256: f69e2014afe8f56a45b893b844402e596279ea798a92b54f24abc6c2299e38a5
observation: G1-git-hooks-are-stand-ins
phase: before
kind: flip
expected: exit 3
exit: 3
matched: true
head: 98895f4
---

## observation / G1-git-hooks-are-stand-ins-before

### Instruction sent (verbatim)

```text
node -e "const fs=require('fs');const p=fs.readFileSync('.githooks/pre-commit','utf8');const q=fs.existsSync('.githooks/post-checkout')?fs.readFileSync('.githooks/post-checkout','utf8'):'';process.exit(p.includes('exec sh node_modules/project-overseer/git-hooks/pre-commit')&&!p.includes('user-authority-check')&&q.includes('node_modules/project-overseer/git-hooks/post-checkout')?0:3)"
```

### Reply received (verbatim)

```text

```
