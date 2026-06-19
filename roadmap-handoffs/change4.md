# CHANGE #4 - Landing screen footer (Proceed button) gets clipped

You are continuing a roadmap on the Work Order Tracker (Electron + React-via-Babel desktop app). Work in this repo:

```
C:\dev\Work-Order-Tracker
```

Branch: `claude/roadmap-v3.1`. App version 3.0.1. User runs dev build with `npm start` from this directory (quit installed-app tray instance first - single-instance lock). Reload with Ctrl+R. JSX compiled at runtime by Babel standalone (index.html:28); no local build step. Verify syntax by reading; user reloads to test.

## Rules (from CLAUDE.md - obey exactly)
- Read existing files before writing. Don't re-read unless changed.
- No emojis or em-dashes.
- Do not guess APIs, versions, flags, SHAs, or package names. Verify by reading code/docs.
- Work silently; chat only after the task is complete; minimal wording.
- Before implementing, search for existing working code and prefer wrapping it.
- When porting from a working reference, port the MECHANISM, not just the surface details.
- When you flag a risk in static review, either mitigate it or design a live test for it before proceeding.
- On the second failed attempt at the same problem, stop and re-examine the approach before a third try.
- Commit each discrete change separately. Do NOT push. Do NOT publish.

## Bug report (user, after Change #3)
On the landing screen (the "attention" view, the welcome pane with the GambleMark, alerts, and the "Proceed to work orders" button), the window does not accommodate all the content: the Proceed button at the bottom gets cut off / clipped. The button must always be visible regardless of window height; the alerts list should scroll internally instead of pushing the footer off-screen.

This is a layout bug, not a window-resize request. The app window is a normal fixed-size desktop window with internal scrolling (min 900x600, see main.js:165). The fix is to bound the layout so the footer stays pinned and the middle region scrolls - NOT to grow the OS window.

---

## Verified investigation (HEAD 5c42541 - read these before coding, confirm still current)

### The shell grid (root cause)
The whole app renders into one container at `index.html:4861-4869`:
```jsx
<div style={{
  ...themeVars,
  position: 'fixed', inset: 0,
  background: 'var(--bg-canvas)',
  color: 'var(--text-1)',
  display: 'grid',
  gridTemplateColumns: '220px 1fr 1.2fr',
  overflow: 'hidden',
}}>
```
It defines `gridTemplateColumns` but NO `gridTemplateRows`. The single implicit row is therefore `auto` (content-sized). The three columns (Sidebar / ListPane / rightPane) all share that one row, so the row's height tracks the TALLEST column's intrinsic content. When the middle ListPane has many rows (intrinsic content taller than the viewport), the shared auto row grows past the viewport; every column is stretched to that over-tall row; and because the container is `overflow: hidden` and `position: fixed; inset: 0` (exactly viewport height), the bottom of the over-tall row is clipped. On the Landing column that clipped bottom is the footer holding the Proceed button.

### Why the other panes do not visibly clip
- `DetailPane` (`index.html:2135-2140`) sets `height: '100%'` on its `<section>` and its body regions use internal `overflow: auto`, so its own content never forces the row taller.
- `ListPane` (`index.html:1776`) is a flex column whose tall content lives inside a `flex: 1; minHeight: 0; overflowY: auto` div, so its min-content stays small - but its MAX-content is what can still inflate the shared auto row.
- `Landing` (`index.html:2536`) is a flex column `<section>` with `minWidth: 0, minHeight: 0` but NO `height: '100%'`. It has a pinned-footer design (header / scroll-middle / footer) that only works when the section has a bounded height. With the unbounded shared row it is the pane whose footer ends up below the clipped edge.

### Landing component (the visible victim)
`Landing({ alerts, onSelectWO, onProceed })` at `index.html:2534`:
- Section root `:2536`: `display: flex, flexDirection: column`, has `minWidth: 0, minHeight: 0`, MISSING `height: '100%'`.
- Header `:2537`; scrollable middle `:2560` (`flex: 1, minHeight: 0, overflow: auto`); footer `:2579` (`borderTop`, holds the Proceed button at `:2586`).
The footer/middle/header structure is already correct for a pinned footer; it just needs a bounded parent height.

### Window sizing (not the bug, do not change unless asked)
`main.js:165`: `width: 1280, height: 820, minWidth: 900, minHeight: 600`. Header (~120px) + footer (~70px) = ~190px, well under the 600px min, so once the layout is bounded the button always fits.

---

## Task 1 - bound the shell grid rows (primary fix)
At `index.html:4866`, add an explicit single-row track so the grid row is exactly the container (viewport) height and children can shrink/scroll internally:
```jsx
display: 'grid',
gridTemplateColumns: '220px 1fr 1.2fr',
gridTemplateRows: 'minmax(0, 1fr)',
overflow: 'hidden',
```
`minmax(0, 1fr)` (not just `1fr`) is required: the `0` minimum lets the columns' internal `overflow: auto` regions actually shrink and scroll instead of expanding the track. This fixes the root cause for ALL panes, not just Landing.

## Task 2 - bound the Landing section (belt-and-suspenders, mirrors DetailPane)
At `index.html:2536`, add `height: '100%'` to the Landing `<section>` so it matches the mechanism DetailPane already uses (`index.html:2140`) and its pinned-footer flex column resolves even if the grid track ever changes:
```jsx
<section style={{ minWidth: 0, minHeight: 0, height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-canvas)' }}>
```
Do the same to the `SettingsDrawer` root (`index.html:2640`) ONLY if Task 1 alone leaves it clipping in the live test - it is a `display: grid` section without `height: '100%'` and shares the same risk. Verify by test before touching it; do not change preemptively.

Commit Tasks 1 and 2 together as one layout fix (they are the same bug), or separately if you prefer - either is fine since they are one logical change.

## Risk + required live test
Risk flagged: changing the shared grid track affects EVERY view, so a regression would show as broken scrolling in the Active list or detail pane. Mitigation is the live test below - run it fully before declaring done.

Live test (user runs `npm start`, Ctrl+R):
1. Open the landing/attention view (the welcome pane). With the window at default size AND dragged down to the 600px minimum height, confirm the "Proceed to work orders" button is fully visible and not clipped.
2. Ensure there are several attention alerts (or temporarily lower alert thresholds in Settings) so the middle list is long; confirm the alert list scrolls internally while the header and footer stay pinned and the button stays visible.
3. Switch to the Active tab: confirm the work-order list still scrolls normally and nothing is clipped.
4. Open a WO in the detail pane: confirm the detail pane still scrolls and its bottom is not clipped.
5. Open Settings: confirm the settings content still scrolls and the left nav "Close" button is reachable.

If any of steps 3-5 regress, the `minmax(0, 1fr)` track is correct; investigate the specific pane's own `minHeight: 0` / `overflow` instead of reverting Task 1.

---

## File map (verified, HEAD 5c42541)
- `index.html:4861-4869` shell grid container (Task 1 target, add `gridTemplateRows` at `:4866`).
- `index.html:2534` `Landing`; section root `:2536` (Task 2 target); scroll-middle `:2560`; footer `:2579`; Proceed button `:2586`.
- `index.html:2135-2140` `DetailPane` section with `height: '100%'` (reference mechanism).
- `index.html:1776` `ListPane` section (flex column).
- `index.html:2640` `SettingsDrawer` section (conditional Task 2 follow-up).
- `main.js:165` BrowserWindow sizing (context only; do not change).

## Notes / gotchas
- JSX compiled at runtime by Babel standalone; verify by reading, user reloads (Ctrl+R).
- The installed app at `%LOCALAPPDATA%\Programs\Work Order Tracker\resources\` is a SEPARATE frozen copy; test only via `npm start`.
- Order store `%APPDATA%\work-order-tracker\wo-data.json` (parse twice via `wo_data` key).
- Prior work on this branch (do not disturb): all FIX items; sort keys + lastNote fix + Status (reverse) lock + direction toggle; Change #2 (scroll preservation, detail-pane status dropdown, right-click context menu + `woAction`); Change #3 (context-menu "View details" rename, colorized TypeIcon + `TYPE_COLORS`).
- Remaining roadmap after this: line 13 (multi-select + mass status change), line 14 (more list context-menu actions), line 15 (custom filters/pages), lines 16-19 (row layout tweaks, scraper work).
