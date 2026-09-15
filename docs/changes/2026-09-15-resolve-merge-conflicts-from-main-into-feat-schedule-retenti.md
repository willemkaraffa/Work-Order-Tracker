---
date: 2026-09-15
model: gemini-flash-latest
diff: 7a6c22a2b7a71186
files: docs/intent/2026-09-15-merge-main-into-schedule-retention.approval.json, docs/intent/2026-09-15-merge-main-into-schedule-retention.md, extension/background.js, extension/content.js, package-lock.json, package.json, scrape_amh.py
---

### Resolve merge conflicts from main into feat/schedule-retention

Resolves merge conflicts across the AMH scraper, extension background and content scripts, and smoke test dependencies while pinning Project Overseer to 0769989 (v0.17.0). In `scrape_amh.py`, retains this branch's per-WO `hydrate_customers` customer refill call inside the bulk loop rather than `main`'s concurrent batch lookup, but incorporates `main`'s empty-field warnings for missing contacts or street addresses in `build_wo`.

In the extension, `background.js` adopts `main`'s 1-minute command polling alarm with top-level registration and immediate spawn draining, but retains this branch's list-aware bail messaging. `content.js` restricts "Find new" scans directly to the currently open list tab rather than falling back to hidden iframe navigation, while updating the `ping` diagnostic handler to share the `isMSRListPage()` readiness check.

Updates Project Overseer dependencies in `package.json` and `package-lock.json` to commit 0769989 to support merge-aware plan checking and changelog generation. Documents approvals and verification conditions in the corresponding intent record.

**Files:** docs/intent/2026-09-15-merge-main-into-schedule-retention.approval.json, docs/intent/2026-09-15-merge-main-into-schedule-retention.md, extension/background.js, extension/content.js, package-lock.json, package.json, scrape_amh.py
