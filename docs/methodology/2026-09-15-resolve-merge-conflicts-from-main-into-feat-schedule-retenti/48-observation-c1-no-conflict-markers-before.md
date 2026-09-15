---
at: 2026-09-15T16:20:04.339Z
role: observation
action: C1-no-conflict-markers-before
outcome: matched
intent: docs/intent/2026-09-15-merge-main-into-schedule-retention.md
sha256: 30f842e5a35dbc6ced9357e0197ac2f8428366cb058802eb26a7851c365290e8
observation: C1-no-conflict-markers
phase: before
kind: invariant
expected: exit 0
exit: 0
matched: true
head: f71bbf6
---

## observation / C1-no-conflict-markers-before

### Instruction sent (verbatim)

```text
node -e "const fs=require('fs');process.exit(['scrape_amh.py','extension/background.js','extension/content.js','test/renderer-smoke.test.js'].some(f=>/^(<<<<<<<|>>>>>>>) /m.test(fs.readFileSync(f,'utf8')))?3:0)"
```

### Reply received (verbatim)

```text

```
