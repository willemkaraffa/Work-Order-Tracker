# Diagnostic sweep — 2026-07-09

Source of truth for this bug/tech-debt pass. Goal: every code path produces its
intended result. Each finding: symptom -> root cause (file:line) -> fix -> collateral
-> status. Done-gate: `npm run verify` green + live-test the AMH-login-gated items.

## F1 — Cannot add (or rename/delete/reorder) technicians  [FIX]

Symptom: "Add tech" does nothing.
Root cause: `TradesSection` ([src/settings.jsx:1524](../src/settings.jsx)) destructures
`{ types, setTypes, mapTypeColors, setMapTypeColors, techJobTypes, setTechJobTypes,
techs, techColors, setTechColors }` — it OMITS `setTechs`, even though the parent
passes it (settings.jsx:85 `setTechs={setTechs}`, wired from app.jsx:3859/5838). So
`addTech`/`renameTech`/`deleteTech`/`moveTech` (1550-1554) all call an undefined
`setTechs` -> `TypeError: setTechs is not a function` -> the handler throws, nothing
persists.
Fix: add `setTechs` to the destructured props.
Collateral: rename/delete/reorder tech were broken by the same omission -> all fixed
by the one change. Class check: grepped every prop TradesSection uses; `setTechs` was
the only missing one (setTypes/setTechColors/setMapTypeColors/setTechJobTypes present).
Status: FIXED.

## F2b — Overlay STILL persists: premise was wrong (headless mode was a red herring)  [FIXED, probe-verified]

Attempt #2 (`--headless=old` + pythonw) also failed. Root cause of the REPEATED failure:
**Edge is v150 (Chromium 150); Chromium REMOVED old headless in v132.** So `--headless=old`
is silently ignored/falls back to `--headless=new` -> the overlay is the ONLY headless
mode available on this Edge, and NO gpu flag suppresses its DirectComposition surface
(both `--disable-gpu` and `--disable-gpu-compositing` were tried). Every prior fix stayed
inside a falsified premise ("pick the right headless/gpu flag"). The reference AMH scraper
avoids the overlay only because it drives **Chrome** (`webdriver.chrome`), whose headless
surface differs; we cannot switch engines (AMH blocks generic Chrome -> the reason Edge
exists here).
FIX (new approach, not another flag on the old one): **drop headless entirely; run a real
HEADED Edge window positioned far OFF-SCREEN** (`--window-position=-32000,-32000`, no
`--headless`). No headless mode -> no headless surface; off-screen -> invisible; headed is
also less bot-detectable for the login. Kept pythonw.exe (console-less) from F2a.
PROBE-VERIFIED (no AMH login needed): a standalone `make_driver()` launch reported
`browserVersion 150.0.4078.48`, `window_rect x=-32000 y=-32000` (off-screen), loaded a
data: page, read its title, quit clean. Confirms: headed launches OK, window is off-screen,
no crash. The window is CREATED off-screen (position applied at launch), so no on-screen
flash.
LIVE-GATED (residual): only the user can visually confirm zero overlay during a real AMH
Fetch, and that headed login still captures the token (headed >= headless for auth, low
risk). amh-runner is MAIN process -> RESTART Electron.
Status: FIXED (probe-verified config), needs one live AMH Fetch to close.

## F2a (superseded by F2b) — earlier headless=old + pythonw re-approach  [kept for record]

Symptom: a blank surface covers the screen during AMH capture/Fetch.
History: prior fix added `--disable-gpu-compositing` to `scrape_amh.py make_driver()`
(headless=new). It did NOT remove the overlay (attempt #1 failed).
Re-examination (rule C2 — don't stack a 3rd GPU-flag guess on the same approach):
the overlay is a `--headless=new` DirectComposition compositor SURFACE (memory
`lesson_msedgedriver_console_window`: click-through, transparent, clears on finish).
Tweaking GPU flags on headless=new is the wrong lever — the surface is intrinsic to
the new headless compositor. The documented alternative is `--headless=old`, which
renders truly OFFSCREEN (no compositor surface). Memory note: the earlier "old-headless
crash" was a stale profile lockfile, NOT old-headless itself.
PAIRED FIX (memory catch): the PROVEN combo is `--headless=old` AND `pythonw.exe`.
Current code had NEITHER (headless=new + python.exe). Switching only headless would
trade the layered overlay for the PYTHON CONSOLE window: Electron (GUI, no console)
spawning python.exe (console subsystem) gets a fresh black console for the whole run;
Node `windowsHide` is unreliable there (memory `lesson_msedgedriver_console_window`
part 3). pythonw.exe is console-less and round-trips the piped stdin/stdout protocol.
Fix: (a) scrape_amh.py `--headless=new` -> `--headless=old`, drop `--disable-gpu-compositing`
(new-only), keep `--disable-gpu`; (b) amh-runner.js pythonPaths python.exe -> pythonw.exe
(dev `python`->`pythonw`; packaged `python/python.exe`->`python/pythonw.exe`).
Risk + live test: (1) old-headless + persistent profile can hit a SingletonLock if a
prior Edge did not exit cleanly (amh-runner single-flight already serializes); (2)
packaged build must actually bundle pythonw.exe under resources/python/ (verify the
electron-builder extraResources includes it, else packaged capture breaks). LIVE-GATED:
run one AMH Fetch, confirm (a) no overlay AND no console window, (b) token captured,
(c) no "Chrome instance exited". amh-runner is MAIN process -> needs full Electron
RESTART, not a renderer reload. If old-headless regresses, revert to headless=new +
keep pythonw (kills the console) and accept the click-through overlay.
Status: FIXED IN CODE, needs live confirmation (no AMH login here). amh-runner.js is
main-process -> RESTART Electron.

## F3 — Invoice line categories wrong after Recompute (R410A material shows "Labor")  [FIX]

Symptom: legacy `Materials!` lines (e.g. "Material - 0.5lbs R410A") read Category
"Labor" even after Recompute. Untaxed correctly; label wrong.
Root cause: `recomputeInvoice` ([src/orders-logic.js:997](../src/orders-logic.js))
returns EARLY on the price-suspect path (`if (res.priceFlag || res.suspects) { ...;
return next; }`) BEFORE the sentinel category/name/taxable normalization. Those R410A
lines are BOTH legacy-mis-saved (`category:'labor'` from an older pipeline) AND
price-suspect (library refrigerant price != bid price -> the red flag), so recompute
skips their category fix.
Secondary latent bug: `resolveBidLine`'s `confirm()` hardcodes `category:'labor'`
([src/orders-logic.js ~682](../src/orders-logic.js)) — a CONFIRMED General material
item would be mislabeled labor (masked for AMH/MSR because isPmListed shows the client
label instead).
Fix: (a) in recompute, apply the name/category/taxable normalization for sentinel
lines REGARDLESS of the price flag (surface the flag too, but still fix the label);
(b) `confirm()` derives category from wording via `isMaterialWording` instead of
hardcoding labor. Category never feeds tax (computeInvoiceTotals reads agreement +
taxable only), so totals are unchanged — this is label-only, matching the user's
"aesthetic" read.
Status: FIXED.

## Tech debt noticed during the scan (not blocking; logged)

- TD1: stale backup files in repo root — `index.html.bak`, `main.js.bak`. Dead weight;
  candidates for deletion (separate task, not touched here).
- TD2: `confirm()` category hardcode (folded into F3b).
- TD3: recompute does not CLEAR a stale `priceFlag` when a line now cleanly confirms
  (a resolved suspect keeps its old flag until manually dismissed). Low impact; left
  as-is to avoid auto-clearing a flag the user may still want. Noted only.

## Verification

- `npm run verify` (build + all tests) after F1+F3; add a recompute test for the
  flagged-material category fix.
- Live (user): F2 AMH Fetch overlay + token; F1 add a tech in Settings > Trades.
