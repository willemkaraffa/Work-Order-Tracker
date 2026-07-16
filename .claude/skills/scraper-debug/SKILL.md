---
name: scraper-debug
description: Diagnose AMH/MSR scraper and Edge/Selenium failures in the Work Order Tracker. Use this whenever the scraper fails or hangs, whenever you see "Chrome instance exited" or GetHandleVerifier, whenever touching msedgedriver, webdriver, headless Edge, or WO capture code, and before theorizing about why a browser automation run died. Each trap here already cost multiple wasted debug cycles.
version: 0.1.0
---

# scraper-debug

## Read the driver log first

`msedgedriver --verbose` writes a log. Read it before forming a theory.

Every failure below was diagnosed faster from that log than from reading code, and the
wasted cycles all came from guessing instead. Browser automation fails for environmental
reasons that are simply not visible in the source.

## Trap 1: "Chrome instance exited" / GetHandleVerifier

One error string, THREE unrelated causes, none of them in the scraper's logic. It is Edge's
generic launch-crash stack, which is exactly why it reads like a code break and is not one.
Check in this order:

**a) Orphaned Edge holding the profile lock.** THE most common cause, and the one that
looks most like a real regression, because it appears with no code change and never clears
on retry. A capture that dies without `driver.quit()` (app closed mid-run, parent killed,
timeout) leaves its Edge processes alive. Those orphans keep the profile's `SingletonLock`,
so every later capture launches a second Edge on the same `--user-data-dir`, hits the lock,
and dies at startup. One crash then poisons every run until the orphans die. Check FIRST,
before any theory:

```powershell
Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" |
  Where-Object { $_.CommandLine -like '*edge-amh-profile*' } |
  Select-Object ProcessId,CreationDate
```

Any hits with no live `msedgedriver` are orphans. A shared creation timestamp in the past
is the tell. `scrape_amh.clear_stale_profile` now sweeps these automatically after a failed
launch, so if you are seeing this trap again, the sweep itself failed — check that its
command-line match still matches (path casing, separators), not that the diagnosis is new.

**b) Crashpad pipe leak.** Electron sets `CHROME_CRASHPAD_PIPE_NAME` in its environment.
That variable leaks into the spawned Edge child and kills it. Delete it from the spawn env.
This only reproduces when an Electron BrowserWindow is open, which makes it look
intermittent and unrelated to the change you just made. It is not. Already handled in
`amh-runner.js`; a recurrence means that delete was removed.

**c) Edge refuses to run elevated.** If the terminal or app is running as Administrator,
Edge will not launch, and no code change will fix it. Run non-elevated.

## Trap 2: stale profile lockfile

A leftover lockfile in the user-data dir makes Edge look like it crashed on launch. It did
not. Clear the profile dir and retry before concluding a headless mode is broken. A previous
`--headless=old` "crash" was misattributed for exactly this reason: the real cause was the
lockfile, and the wrong conclusion stuck around for a long time.

Note the ordering: a stale lockfile is what an orphan process LEAVES BEHIND, so Trap 1a is
the live version of this and deleting lock files while an orphan still holds the profile
fixes nothing. Kill the processes, then clear the files.

## NOT a cause: msedgedriver / Edge major-version mismatch

Do not start here, however tempting the version numbers look. Verified live 2026-07-16:
bundled `msedgedriver` 149 drives Edge 150 fine. Edge auto-updating past the bundled driver
is not what breaks capture, and "the driver is stale" burned a full debug cycle before the
real cause (Trap 1a) turned up. If the driver truly mismatches, the error names the versions
explicitly; a bare GetHandleVerifier does not.

## Trap 3: black overlay during capture (historical)

A transparent, click-through GPU/DirectComposition overlay painted by `--headless=new`. Not
a window, not a console. Capture worked and it cleared on finish.

Settled, and no longer reachable: the scraper does not run headless at all any more (see
Architecture). No headless mode means no headless surface. If an overlay ever returns,
something re-added a `--headless` flag.

## Architecture, settled

- **AMH**: Edge driven by Selenium from a Python subprocess (`scrape_amh.py`,
  `amh-runner.js`), which captures the Bearer token from the performance log and then calls
  the REST API directly. The Order/Query API returns the ACTIVE set only, capped at the 100
  most recent, so old WOs age out of it (`fetch_admin_order`/VendorAdminOrders reaches those).
  Trade is derived from condition-issue category plus notes keywords.
- **NOT headless.** Edge 150 removed `--headless=old`, and `--headless=new` paints the Trap 3
  overlay that no GPU flag suppresses. So it runs a REAL, HEADED Edge parked off-screen at
  `--window-position=-32000,-32000`. Invisible, no headless surface. Do not "restore" headless.
- **Persistent Edge profile** (`EDGE_PROFILE`, a writable userData dir) keeps the AMH session
  cookie alive across runs, which skips the ~30s iframe login. That profile is also the thing
  an orphaned Edge holds hostage in Trap 1a. It is the shared resource; treat it as one.
- **MSR**: stays on the extension.

These are different because the portals are different. Do not unify them.

## Rules that keep being learned the hard way

Port the MECHANISM, not the surface. If the working reference drives Selenium with real
keystrokes and an iframe switch, do not reimplement it with a BrowserWindow and synthetic
events just because the selectors matched. Selectors and field names are surface; the stack
is the mechanism, and the mechanism is what makes it work.

Bulk capture must skip trashed and deleted WOs that are still sitting on the portal's open
list (the deleted-skip in the `captureAllAMH` existing-map).

A spawned browser outlives whatever spawned it. Killing the parent (app quit, timeout, hard
kill) does NOT kill Edge; it just removes the thing that would have called `driver.quit()`.
Any new spawn path needs both halves: kill the child TREE on quit (`taskkill /T`, in
`amh-runner.js`), and heal orphans on the next run (`clear_stale_profile`). Prevention alone
loses to a hard kill; healing alone means every crash costs a manual cleanup.

Heal a shared resource lazily, never eagerly. `clear_stale_profile` runs only AFTER a launch
has already failed, because it cannot tell an orphan from a live concurrent capture on the
same profile. Sweeping before every launch would upgrade a harmless startup crash into
killing a working run's browser. After the launch fails, the lock already proves nothing else
can run there, so the kill is free.

When scoping a kill by command line, match with lowercased `.Contains()`, not `-like`. `[` and
`]` are legal Windows path characters but wildcard character classes to PowerShell, so `-like`
can silently match nothing, skip the orphan, and hand back the original bug with no diagnostic.

A second failed fix on the same symptom means the approach is wrong, not the code. Stop and
re-examine the premise rather than shipping a third patch on top of a bad one.
