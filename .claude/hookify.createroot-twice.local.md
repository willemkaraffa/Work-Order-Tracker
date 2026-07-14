---
name: warn-createroot-twice
enabled: true
event: file
pattern: createRoot\(
action: warn
---

**createRoot detected.**

Known trap in preview/browser tests: calling `createRoot` twice on the same `#root`
corrupts the React tree and produces misleading test output.

**Rules:**
- Never re-`createRoot` the same `#root`. Replace the node or use a fresh container.
- Check DOM state (`root.children`) BEFORE reading console logs.
- Read logs small and filtered.

Normal single mount in the app entrypoint: fine, ignore this.
