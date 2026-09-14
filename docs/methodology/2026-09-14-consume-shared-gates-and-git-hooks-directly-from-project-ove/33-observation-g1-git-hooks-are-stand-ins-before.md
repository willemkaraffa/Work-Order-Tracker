---
at: 2026-09-14T18:49:59.527Z
role: observation
action: G1-git-hooks-are-stand-ins-before
outcome: matched
intent: docs/intent/2026-09-14-po-frame-hooks.md
sha256: 9d9c9591e3c0ccf82c25d22eb55380f3c596724d5d611d97fea22044ad0f8d4c
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
