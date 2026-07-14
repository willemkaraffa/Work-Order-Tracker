---
name: require-verify-before-done
enabled: true
event: stop
pattern: .*
action: warn
---

**Done-gate check.**

If you changed ANY code this turn, `npm run verify` must have passed before you
claim a fix works. Build catches JSX/esbuild errors; tests catch logic and render
regressions. A fix you did not run is a guess.

Confirm before stopping:
- Did I change product code? If yes, did `npm run verify` actually PASS?
- Did I report "verified" without running it? That is a false claim. Say
  "static analysis only, not run" instead.
- Did the failure mode I flagged in review get tested, or did I flag and ignore it?

Docs-only, memory-only, or config-only turns: this gate does not apply. Say so and
stop.
