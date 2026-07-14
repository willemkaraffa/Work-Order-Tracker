---
name: block-dangerous-bash
enabled: true
event: bash
pattern: rm\s+-rf\s+[/~]|rm\s+-rf\s+\*|Remove-Item\s+.*-Recurse.*-Force\s+[A-Za-z]:\\?\s*$|dd\s+if=|mkfs
action: block
---

**BLOCKED: destructive filesystem command.**

This pattern deletes or overwrites broadly (root, home, drive root, or a wildcard),
and it is not reversible.

**Before any delete:**
- Look at what you are about to remove. If it contradicts how it was described, or
  you did not create it, stop and surface that instead of proceeding.
- Scope the path explicitly. No `/`, no `~`, no bare drive root, no `*`.
- Prefer moving to a scratch directory over deleting.

If the user explicitly asked for this exact destructive command, have them run it
themselves.
