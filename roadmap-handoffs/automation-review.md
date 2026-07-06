# Automation / Scraper Review — Handoff + Fix Specs

Date: 2026-07-06
Scope: all automation + scraper code, reviewed against CLAUDE.md framework (surgical
changes, port-mechanism, verify-before-claim, anti-tech-debt A/B/C/E).
Status: F0 + F1 + F2 + F4 DONE (2026-07-06). F3 + F5 OPEN. `npm run verify` green
(5 pass/0 fail); scrape_amh.py py_compile OK.

F2 DONE: scrape_amh.py make_driver adds `--user-data-dir` from EDGE_PROFILE (amh-runner.js
sets it to userData/edge-amh-profile). Shared profile forced a single-flight guard in
amh-runner.js (captureInFlight) — a 2nd concurrent capture rejects "already running" instead
of crashing on the Edge SingletonLock. NOT live-run against portal (verify: two back-to-back
single captures; 2nd should log "Existing AMH session detected" + skip iframe login).
F4 DONE: amh-runner.js `proc.stdin.on('error', ()=>{})` (folded in with the single-flight).

DONE:
- F0 = DELETE. Removed scraper.js, scraper-extract.js, scrape-existing-amh.js,
  scrape_amh_bids.py, test/live-capture.js, and 8 extract tests
  (extract/stress/contacts/full-flow/scraper-surface/wo9718400/expand-static) +
  test/fixtures/. Emptied FIXTURE_TESTS in test/run.js. Dropped dead-file citations
  in amh-runner.js, orders-logic.js, scrape_amh.py comments.
- F1 = APPROVED-ONLY. scrape_amh.py extract_bids: `bid = approved[0] if approved else None`
  (dropped the bids[0] fallback). No approved bid -> empty items -> existing "no bid
  items" warning surfaces the WO.

OPEN: F2 (session persistence), F3 (token origin filter), F4 (stdin error listener),
F5 (portalLink str guard). Specs below unchanged.

## Live path (ground truth)

Renderer `window.scraper.captureWO` / `captureAllAMH`
  → preload.js:87-88 IPC `capture-wo` / `capture-all-amh`
  → main.js:896 / main.js:918 handlers
  → `runAmhCapture` (amh-runner.js)
  → spawns `scrape_amh.py` (headless Edge login → capture Bearer token → REST
    `Order/Query` → build WO objects)
  → renderer `applyCapture` (app.jsx:5213) merges result.

MSR is NOT in this path — MSR imports via the Chrome extension → `/import` bridge.

Everything below the token/API line is the ONLY automation that runs in the shipped
app. `scraper.js`, `scraper-extract.js`, `scrape-existing-amh.js`, `scrape_amh_bids.py`
are legacy and execute in prod NEVER (see F0).

---

## F0 — Dead code + test-debt (DECISION REQUIRED before other work)

Facts:
- `scraper.js` (544 lines, in-app BrowserWindow DOM scraper) is required by NOTHING in
  main.js/preload.js. Only consumer: `test/live-capture.js` (manual harness).
- `scraper-extract.js` is read only by `scraper.js` (scraper.js:29). Prod-dead.
- `scrape-existing-amh.js` + `scrape_amh_bids.py` = standalone `npx electron` dev CLI,
  not wired to the app.
- Yet the test suite validates the DEAD extractor: `extract.test.js`, `stress.test.js`,
  `contacts.test.js`, `full-flow.test.js`, `scraper-surface.test.js`, `wo9718400.test.js`
  all import `scraper-extract.js`. `stress` + `scraper-surface` run even in `--logic`.

Why it matters (framework C3/E): `npm run verify` goes GREEN on code the app can't run.
False confidence — a future "scraper fix" may edit the dead DOM path and tests will still
pass while prod behavior is unchanged.

Options:
- (A) DELETE `scraper.js`, `scraper-extract.js`, `scrape-existing-amh.js`,
  `scrape_amh_bids.py`, `test/live-capture.js`, and the 6 extract tests + their fixtures.
  Cleanest; irreversible-ish (recoverable from git). Collateral: test/run.js auto-globs,
  so removing the 6 `*.test.js` files needs no runner edit. Remove FIXTURE_TESTS entries
  in test/run.js:16-19 for the deleted fixture tests.
- (B) BANNER: add a `// LEGACY — not in the shipped capture path (see automation-review.md)`
  header to each dead module and leave tests. Keeps history, keeps false-green tests.

Recommendation: (A). The Edge/API path fully replaced the DOM path; keeping a tested-but-
dead parallel scraper is exactly the A/B tech-debt the rules target.

GATE: do not start F1-F5 edits until this is decided — deletion may drop files the fixes
would otherwise touch.

---

## Bugs in the LIVE Python path

### F1 — Non-approved bid fallback imports wrong amount (MEDIUM, data quality)

File: scrape_amh.py:199-221 (`extract_bids`), specifically the bid pick at :205-206:
```python
approved = [b for b in bids if normalize_text(b.get("statusName")).lower() == "approved"]
bid = approved[0] if approved else (bids[0] if bids else None)
```
Behavior: WO with only Draft/Pending/Rejected bids → falls back to `bids[0]`, extracts its
items + total, imports as `bidAmount` / `bidItems`. The retired JS path read APPROVED bids
ONLY (scraper.js:241 `getApprovedBidUrls`, filter on the "Approved" pill). Mechanism drift.
Warning fires only when NO items (scrape_amh.py:281) — a non-approved bid WITH items imports
clean and unflagged.

DECISION NEEDED (intent): approved-only, or keep pending amounts?
- Fix spec (approved-only): drop the `else bids[0]` fallback:
  ```python
  bid = approved[0] if approved else None
  ```
  Then WOs with no approved bid return `items=[]`, `total=0` → existing "no bid items"
  warning (scrape_amh.py:281) surfaces them in the review modal. No new field.
- Fix spec (keep pending but flag): keep fallback, add a warning in build_wo when the
  chosen bid's statusName != "approved" (reuse the existing `warnings` list, no new field):
  ```python
  # in build_wo, after extract_bids
  if bid_items:
      bids_all = order.get("bids") or []
      appr = [b for b in bids_all if normalize_text(b.get("statusName")).lower()=="approved"]
      if not appr:
          warnings.append("bid amount is from a non-approved bid")
  ```
  (extract_bids would need to also return the chosen bid's status, OR recompute here.)

Collateral: `applyCapture` treats `bidAmount` as portal-owned and always overwrites
(app.jsx:5230). Approved-only means a WO losing its only pending bid keeps NO amount — that
is correct (nothing approved yet). No invoice-path change: `bidItemsToInvoiceLines`
(orders-logic.js:489) is shape-only.

Live test (rule 4): run `capture-all-amh` against the portal with at least one WO that has
a pending-but-not-approved bid; confirm approved-only returns empty+warning, or the flag
appears. Fixture test: add a `bids:[{statusName:"Draft",...}]` order to a stress fixture and
assert `bidItems==[]` (approved-only) — but note the extract tests are F0-dead; if F0=A,
add this assertion in a NEW python-facing test or a live run instead.

### F2 — Fresh login every capture, no session persistence (MEDIUM, UX regression)

File: scrape_amh.py:62-83 (`make_driver`). No `--user-data-dir`, so every spawn is a clean
Edge profile. Consequence: the "Existing AMH session detected" branch (scrape_amh.py:94-95)
is UNREACHABLE; every single-WO detail-pane capture pays the full iframe login
(~5s+2s+0.4s+0.4s + up to 25s poll + 12s list-load ≈ 20-45s of `time.sleep`). The retired
path kept the session warm via `persist:amh-scraper` partition (scraper.js:280).

Fix spec: give Edge a persistent profile dir so the auth cookie survives runs.
```python
# make_driver(), after opts = Options()
profile_dir = os.environ.get("EDGE_PROFILE") or str(SCRIPT_DIR / ".edge-amh-profile")
opts.add_argument(f"--user-data-dir={profile_dir}")
```
Packaged app: pass `EDGE_PROFILE` from amh-runner.js pointing at `app.getPath('userData')`
(writable; SCRIPT_DIR under resources/ is read-only when packaged):
```js
// amh-runner.js runAmhCapture, in env setup
env.EDGE_PROFILE = path.join(app.getPath('userData'), 'edge-amh-profile');
```
Collateral: profile dir accrues cache. Acceptable; one dir. Concurrency: only one capture
runs at a time (UI single-flight via setCaptureStatus), so no profile-lock contention.

Live test (rule 4): two back-to-back single captures; second must skip the login iframe
(assert `[LOGIN] Existing AMH session detected.` on stderr) and finish materially faster.

### F3 — Bearer token grabbed from first request of ANY origin (LOW→MED, fragile)

File: scrape_amh.py:130-143. Loops perf log, takes the FIRST `Authorization: Bearer *` on
any `requestWillBeSent`. A telemetry/3rd-party request landing first → wrong token → every
`api_get` 401s → `RuntimeError` and total capture failure. Live-verified 2026-06-22 so
currently OK; brittle to AMH adding analytics.

Fix spec: require the request URL to be the AMH API host before accepting the token.
```python
if msg.get("method") == "Network.requestWillBeSent":
    req = msg["params"]["request"]
    url = req.get("url", "")
    if "services-api" not in url and "app.amh.com" not in url:
        continue
    headers = req.get("headers", {})
    ...
```
No new field. Live test: run a capture, assert token still captured (stderr
`Bearer token captured`) and WOs return.

### F4 — amh-runner stdin has no error listener (LOW)

File: amh-runner.js:54. `proc.stdin.write(...)` with no `'error'` handler on the stdin
stream. If Python dies on import (e.g. selenium missing) before reading stdin, the write can
emit EPIPE with no listener → possible unhandled stream error in the main process. The
process-level `proc.on('error')` / `'close'` do NOT catch stream errors.

Fix spec: swallow stdin errors (the `close`/`code!==0` path already surfaces the real cause
via stderr):
```js
proc.stdin.on('error', () => {});   // Python may exit before reading stdin; close handler reports the real error
proc.stdin.write(JSON.stringify(woNumbers));
proc.stdin.end();
```
Live test: temporarily point `pythonPaths().script` at a script that `sys.exit(1)`s before
reading stdin; confirm reject carries the stderr tail, no uncaught exception.

### F5 — portalLink concat not type-guarded (LOW)

File: scrape_amh.py:302:
```python
"portalLink": (WO_LINK_BASE + order.get("id") + "?tabId=general") if order.get("id") else "",
```
Truthy-guarded, not type-guarded. Non-str `id` (int) → `str + int` TypeError → build_wo
raises → whole WO returns `ok:False` (main.py:355/371 catch). One malformed id kills that WO.

Fix spec:
```python
"portalLink": (WO_LINK_BASE + str(order.get("id")) + "?tabId=general") if order.get("id") else "",
```
Live test: covered incidentally by any successful capture (portalLink populates); assert
`res.wo.portalLink` starts with WO_LINK_BASE.

---

## Suggested order
1. F0 decision (blocks the rest if delete).
2. F1 intent decision + fix (data correctness, highest user impact).
3. F2 (UX; biggest daily annoyance).
4. F3, F4, F5 (hardening; low risk, batch together).

## Done-gate for each fix
`npm run verify` (build + tests) MUST pass. Python changes have no JS test coverage after
F0=A — verify F1/F2/F3/F5 with a LIVE `capture-all-amh` run against the portal and paste the
stderr `[LOGIN]`/`[API]` trace + one WO's returned fields as proof (rule C4, alpha-test).
