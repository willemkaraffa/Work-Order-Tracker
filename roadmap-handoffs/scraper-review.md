# Scraper Review: AMH + MSR (reliability + speed)

Status: REVIEW / handoff. No code yet. Scope decisions locked with the user 2026-08-04:
deliverable = review doc first; free to replace stacks; **reliability first**; Apify = code/pattern
reference only (auth constraint rules out cloud execution of the user's session).

This doc grounds the current state in the actual code, records researcher + Apify prior-art, names
the shared root cause, and proposes a phased, reliability-first rewrite. It is a spec to vet, not to
execute yet.

---

## 1. Current state (grounded in code)

### AMH — `scrape_amh.py` + `amh-runner.js` (Node spawns Python)
- Mechanism: real (NOT headless) Microsoft **Edge** driven by Selenium, moved off-screen. Logs in
  through the Azure **B2C** iframe, captures the **Bearer token** from the performance log, then
  calls the AMH REST API (`app.amh.com/services-api/api/Order/Query`) directly for structured JSON.
  Browser surface is tiny; all WO data comes from the API.
- Timing (mechanism-derived, `scrape_amh.py`):
  - `make_driver` spawns Edge (+ `clear_stale_profile` ~1s when a lock is stale).
  - `login_and_get_token`: `get(login)` + `sleep(5)`; iframe switch + `sleep(2)`; fill creds
    (`sleep(0.4)` x2); submit + poll; then a **cold-login token retry loop**: `get(WO_LIST_URL)` +
    `sleep(6)` per pass, several passes, until the Bearer appears.
  - Net: **~20-40s of login/token bootstrap every capture**, then the API is fast.
- Why fresh login every run: a **new Edge profile per capture** (code comment ~line 128) — so it
  pays the full B2C login each time and never reuses a session.
- Fragility (code + memory): Edge launch traps (crashpad pipe kills child Edge, refuses to run
  elevated, `--headless=new` click-through overlay since Edge 150 dropped `--headless=old`) — all
  Edge-specific; cold-login token **race** (the retry loop exists for this reason); stale profile
  lock corrupts a run silently.
- Accuracy gap: `Order/Query` returns the **active set only**, ~**100 most recent**; older WOs
  **age out** and are never returned.

### MSR — Chrome extension (`extension/content.js` + `background.js`)
- Mechanism: MV3 extension. The app queues a `findNewMsr` command; the extension **polls**
  `GET /command` on a **0.5-min alarm** (Chrome floor ~30s), then the content script scrapes the
  Salesforce **Lightning / Aura** work-order list. Detail + dropped-batch load pages in **hidden
  same-origin iframes** (`loadInIframe`, `scrollRender`, 35s hard timeout).
- Why an extension at all: MSR is **locked to the authenticated Chrome profile** and allows
  self-framing. That is why it was never folded in-app like AMH.
- Timing: **trigger latency ~30-60s** (the command poll) is the dominant, inherent cost of the
  app->extension bridge (AMH has none of this, it runs in-process); list render ~5-10s typical, up
  to 35s; full capture adds a detail iframe **per WO**.
- Fragility (proven live this session): MV3 **service worker sleeps** during a long awaited response
  (held-open `sendResponse` for a 35s iframe load is lost); **backgrounded-tab throttling**
  slows/freezes the iframe when the tab is not focused (the exact case the user wants); Aura
  **lazy-render / virtualized datatable** drops off-screen rows.

### In-flight (uncommitted, this session)
On the MSR extension: (a) **fail-loud** — every bail reports a reason to the app instead of a silent
Chrome-only notification (committed, PR #10); (b) headless list iframe + (c) ack + fresh-message
result mechanism (uncommitted, PARKED by user decision). (a) is worth keeping regardless. (b)/(c)
are stopgaps on the extension mechanism and are **superseded** by the rewrite below.

---

## 2. Root cause (shared)

For **both** scrapers the slow + variable + fragile part is **bootstrapping an authenticated browser
session every run**. The actual data fetch is fast and reliable (AMH REST JSON; MSR list anchors
once rendered). Neither persists a session or token, so every capture re-pays the login / render /
poll tax and re-exposes the browser-bootstrap failure modes.

Optimizing selectors/timeouts/iframe settle treats symptoms. The lever that moves **both**
reliability and speed is **persisting the authenticated session/token** and removing the per-run
browser bootstrap.

---

## 3. Prior art

**Researcher** (advisory, untrusted; scores bracketed): Playwright **storageState** [0.43] (save
signed-in state once, reuse it; also API-login + bearer-token patterns); Azure B2C/Entra with
Playwright [0.42/0.34] (grab the token, inject to localStorage; log in once via global setup);
Salesforce + Playwright [0.30] (reliable login via **saved session state**, data **through the API**).

**Apify** (code/pattern reference): Salesforce Store actors are all AppExchange/partner-directory
(public data) — none touch an authed portal, confirming cloud actors can't use the user's session.
**`apify/playwright-scraper`** (official, open-source, FREE, 10.7k users) exposes `initialCookies`,
`sessionPoolName`, `pageFunction`, `useChrome`, `headless`, "supports login" — the reusable
**template** (Crawlee/Playwright with cookie/session injection), runnable **locally**, MIT, no cloud.

Convergence: **local Playwright (Chromium) with a persisted storageState / token, API-first.**

---

## 4. Recommendation (reliability-first; stacks may change)

Unify both scrapers on **one local mechanism**: **Playwright (Node)** — matches the app's
Electron/Node runtime (replaces the Python subprocess) and runs **in-process, app-triggered like AMH
today** (kills the MSR command-poll).

Core: **log in once per portal, persist `storageState` (cookies + localStorage/token) to disk, reuse
it every capture.** Re-login only when saved state expires.

- **AMH**: with saved state, read the Bearer and hit `Order/Query` REST directly (the fast proven
  path). No fresh profile, no per-run B2C login, no token race. Playwright drives **Chromium**,
  sidestepping the Edge-specific crashpad/elevation/overlay traps. Investigate API
  **pagination / date-window** to close the 100-most-recent age-out gap.
- **MSR**: with a saved Salesforce session, load list + detail in **headless Playwright**, scrape
  the rendered DOM. Removes MV3 lifecycle, the 30-60s poll, backgrounded-tab throttling, and the
  extension from the capture path. Reuse the **validated selectors** (`a[href*="/workorder/"]`, field
  parsers) — port the **mechanism**, keep the working **surface**.

Against the user's goals: **reliability** (one warm session, no per-run race), **speed** (no poll, no
re-login, cached token; both in-process), **accuracy** (AMH API pagination; full rendered MSR list).

**Make-or-break risk (validate first):** MSR is "locked to the authenticated Chrome profile." Must
prove Playwright + saved Salesforce `storageState` authenticates headlessly (Salesforce may bind to
device/UA/IP). If not, MSR stays extension-based (fix the ack+result mechanism, accept the poll).
This one spike decides the MSR direction. Secondary: AMH B2C token lifetime + refresh cadence; keep
`scrape_amh.py` as fallback until the Playwright AMH path is proven.

---

## 5. Phased migration (reliability-first, each phase independently shippable)

- **Phase 0 — Baseline.** Add timing logs to both scrapers; capture real min/median/worst over ~10
  runs each. Replaces the estimates above with data and proves the rewrite wins. Cheap, no risk.
- **Phase 1 — SPIKE (make-or-break).** Throwaway Playwright: log in once to **each** portal, save
  `storageState`, then in a **fresh** headless context reuse it and (AMH) pull one WO via API, (MSR)
  render the list + count `/workorder/` anchors. Success = both authenticate from saved state, no
  re-login. Gates everything.
- **Phase 2 — AMH on Playwright** (lower risk, API-backed) behind a flag; `scrape_amh.py` stays
  fallback until parity (same field map + age-out pagination fix).
- **Phase 3 — MSR on Playwright** (only if Phase 1 MSR spike passed): headless render + existing
  selectors; retire the extension's **capture** role (keep on-page one-click if wanted).
- **Phase 4 — Unify trigger.** Both app-triggered in-process; delete the command-poll and the MSR
  iframe/ack stopgaps Phase 3 supersedes.

**Interim (before the rewrite):** commit MSR fail-loud (PR #10); park the headless-iframe + ack/result
changes (superseded by Phase 3). If MSR must work unfocused before Phase 3, the smaller win is an
**instant trigger from the extension popup** (direct worker message, no 30-60s poll).

---

## 6. Open questions for the user

1. Is one-time interactive login (a visible browser on first run / on token expiry) to seed
   `storageState` acceptable, or must capture be fully unattended forever (stored credentials +
   scripted B2C/Salesforce login)?
2. AMH accuracy: is the 100-most-recent age-out actually biting (missing old WOs) — should Phase 2
   prioritize pagination?
3. Keep the MSR extension's on-page one-click capture after Phase 3, or retire the extension wholly?
