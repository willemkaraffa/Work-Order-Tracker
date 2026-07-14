---
name: warn-destructive-git
enabled: true
event: bash
pattern: git\s+push\s+.*--force|git\s+reset\s+--hard|git\s+checkout\s+--\s|git\s+clean\s+-[a-z]*f|--no-verify|--no-gpg-sign
action: warn
---

**Destructive or hook-bypassing git command.**

Each of these discards work or skips a safety net:
- `--force` push: overwrites remote history, can destroy a teammate's commits. Use
  `--force-with-lease` if it is truly needed.
- `reset --hard` / `checkout --` / `clean -f`: silently discards uncommitted work.
- `--no-verify` / `--no-gpg-sign`: skips hooks or signing. NEVER do this unless the
  user explicitly asked. If a hook fails, fix the underlying issue.

Ask: is there a non-destructive way to reach the same goal? If not, confirm with the
user before running it.
