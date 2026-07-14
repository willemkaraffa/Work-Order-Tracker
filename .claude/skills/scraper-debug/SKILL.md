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

One error string, two unrelated causes. Distinguish before acting:

**a) Crashpad pipe leak.** Electron sets `CHROME_CRASHPAD_PIPE_NAME` in its environment.
That variable leaks into the spawned Edge child and kills it. Delete it from the spawn env.
This only reproduces when an Electron BrowserWindow is open, which makes it look
intermittent and unrelated to the change you just made. It is not.

**b) Edge refuses to run elevated.** If the terminal or app is running as Administrator,
Edge will not launch, and no code change will fix it. Run non-elevated.

## Trap 2: stale profile lockfile

A leftover lockfile in the user-data dir makes Edge look like it crashed on launch. It did
not. Clear the profile dir and retry before concluding a headless mode is broken. A previous
`--headless=old` "crash" was misattributed for exactly this reason: the real cause was the
lockfile, and the wrong conclusion stuck around for a long time.

## Trap 3: black overlay during capture

A transparent, click-through GPU/DirectComposition overlay from `--headless=new`. It is not
a window and not a console. Capture works, and it clears on finish. It looks alarming and is
not worth chasing. If you do revisit it: try `--headless=old` or `--disable-gpu-compositing`.

## Architecture, settled

- **AMH**: headless Edge plus token/API via Python subprocess (`scrape_amh.py`,
  `amh-runner.js`). The Order/Query API returns the ACTIVE set only, capped at the 100 most
  recent, so old WOs age out of it. Trade is derived from condition-issue category plus notes
  keywords.
- **MSR**: stays on the extension.

These are different because the portals are different. Do not unify them.

## Rules that keep being learned the hard way

Port the MECHANISM, not the surface. If the working reference drives Selenium with real
keystrokes and an iframe switch, do not reimplement it with a BrowserWindow and synthetic
events just because the selectors matched. Selectors and field names are surface; the stack
is the mechanism, and the mechanism is what makes it work.

Bulk capture must skip trashed and deleted WOs that are still sitting on the portal's open
list (the deleted-skip in the `captureAllAMH` existing-map).

A second failed fix on the same symptom means the approach is wrong, not the code. Stop and
re-examine the premise rather than shipping a third patch on top of a bad one.
