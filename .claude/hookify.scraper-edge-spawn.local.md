---
name: warn-scraper-edge-spawn
enabled: true
event: file
pattern: msedgedriver|webdriver|selenium|CHROME_CRASHPAD_PIPE_NAME|--headless|spawn\(.*edge|user-data-dir
action: warn
---

**Touching Edge/Selenium spawn code.**

Load the `scraper-debug` skill before theorizing. These traps each cost multiple wasted
debug cycles and are invisible in the code:

- **Read the `msedgedriver --verbose` log FIRST.** Do not guess at Selenium failures.
- "Chrome instance exited" / GetHandleVerifier has TWO causes: (a) Electron's
  `CHROME_CRASHPAD_PIPE_NAME` leaking into the spawned Edge child (only repros with a
  BrowserWindow open), or (b) the terminal running elevated. Edge refuses to run as admin.
- A stale profile lockfile looks exactly like a launch crash. Clear the user-data dir
  before blaming the headless mode.
- The black overlay during capture is a click-through GPU overlay, not a window. It is
  non-blocking. Do not chase it.

Port the MECHANISM, not the surface. AMH = headless Edge + token/API via Python
subprocess. MSR = extension. Do not "unify" them.
