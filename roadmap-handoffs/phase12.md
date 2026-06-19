# PHASE 12 — Light mode v3 (Catppuccin Latte port) + density wiring

Execute the tasks in order. Read every file you touch before editing. No
emojis, no em-dashes. After each task, grep to confirm.

---

## Why this approach (read first, do not skip)

Phase 10 and Phase 11 light-mode revisions were both hand-rolled OKLCH
guesses and both got rejected by the user ("blinding white", then "bad").
Per rule (3) -- on the second failed attempt, stop and re-examine the
approach -- we are switching mechanism. Instead of inventing more values,
this phase ports a vetted public palette wholesale.

**Catppuccin Latte** is the palette. It is:
- The flagship light theme of the Catppuccin project (110k+ GitHub stars
  on the main repo, adopted in hundreds of dev tools and apps).
- Designed explicitly for eye comfort -- this is the project's stated
  goal, not an inference.
- Three-tier surface model (`base` / `mantle` / `crust`) that maps 1:1 to
  the app's `bg-surface` / `bg-canvas` / `bg-surface-2` tokens.
- Max lightness #eff1f5 (94%) -- below the "blinding" threshold the user
  complained about. Has subtle cool-blue cast so it does not read as
  sterile.

**Do not deviate from these hex values.** They are the canonical Catppuccin
Latte values from `catppuccin/catppuccin`. Porting the mechanism means
taking the whole palette, not cherry-picking and substituting.

Reference: https://catppuccin.com/palette/ (Latte column).

---

## TASK 0 — Read first (no edits)

1. `index.html` lines 38 to 78 (current TT_LIGHT -- Phase 11 warm cream).
2. `index.html` -- grep `density` and `setDensity` to confirm what is
   plumbed and what is NOT consumed.
3. Search for `ListPane` and the WO row component to find where row
   padding / font size is currently hard-coded.

---

## TASK 1 — Replace TT_LIGHT with Catppuccin Latte port

Replace the entire `TT_LIGHT` object (lines 38 to 77) with this block.
Hex values are verbatim from Catppuccin Latte. The mapping decisions
(which Latte token feeds which app token) are documented inline.

```js
const TT_LIGHT = {
  // Surface hierarchy: base is brightest (cards), mantle is the page
  // background that recedes, crust is the deepest band for phase headers.
  '--bg-canvas':     '#e6e9ef',  // Latte: mantle  -- recessed page bg
  '--bg-surface':    '#eff1f5',  // Latte: base    -- card / row surface
  '--bg-surface-2':  '#dce0e8',  // Latte: crust   -- phase header band

  // Interactive states
  '--bg-hover':      '#d4d8e1',  // between crust and surface1
  '--bg-row-sel':    '#bdc7f0',  // tinted with Latte blue, selected row
  '--accent-soft':   '#dce5fb',  // soft blue wash backgrounds

  // Borders use Latte surface scale
  '--border-1':      '#ccd0da',  // Latte: surface0
  '--border-2':      '#bcc0cc',  // Latte: surface1

  // Text uses Latte text/subtext/overlay scale
  '--text-1':        '#4c4f69',  // Latte: text
  '--text-2':        '#6c6f85',  // Latte: subtext0
  '--text-3':        '#9ca0b0',  // Latte: overlay0

  // Accents map straight to Latte named colors
  '--accent':        '#1e66f5',  // Latte: blue
  '--accent-fg':     '#ffffff',

  // Age-warning tints derived from Latte red
  '--age-1':         '#f4d4d8',  // very light red wash
  '--age-2':         '#eeb6bc',  // mid red wash
  '--age-3':         '#e58a93',  // saturated red wash

  // Flags map to Latte semantic colors
  '--flag-emergency':'#d20f39',  // Latte: red
  '--flag-warranty': '#1e66f5',  // Latte: blue

  // Phase fg = Latte named color, phase bg = tinted soft wash.
  // Hue rationale matches the design-notes default phase map (Thread 3).
  '--p-intake':      '#5c5f77',  // Latte: subtext1   (neutral gray)
  '--p-intake-bg':   '#dce0e8',  // Latte: crust
  '--p-await':       '#df8e1d',  // Latte: yellow
  '--p-await-bg':    '#f5e3c2',  // tinted yellow
  '--p-approved':    '#40a02b',  // Latte: green
  '--p-approved-bg': '#cde5c4',  // tinted green
  '--p-progress':    '#1e66f5',  // Latte: blue
  '--p-progress-bg': '#c8d7fb',  // tinted blue
  '--p-wrap':        '#8839ef',  // Latte: mauve
  '--p-wrap-bg':     '#dccaf6',  // tinted mauve
  '--p-done':        '#179299',  // Latte: teal
  '--p-done-bg':     '#c3e0e2',  // tinted teal
  '--p-billing':     '#209fb5',  // Latte: sapphire
  '--p-billing-bg':  '#c5e2ea',  // tinted sapphire

  // PM chip color seeds. PM editor overrides per-PM via hex; these are
  // the LEGACY var-based fallbacks. New per-PM colors come from the data
  // layer (Phase 9). Keep the vars defined so old chip code does not
  // crash on themes that still reference them.
  '--pm-amh':        '#40a02b',  // Latte: green
  '--pm-amh-bg':     '#cde5c4',
  '--pm-msr':        '#8839ef',  // Latte: mauve
  '--pm-msr-bg':     '#dccaf6',
  '--pm-rkt':        '#fe640b',  // Latte: peach
  '--pm-rkt-bg':     '#fbd7bd',
};
```

Do NOT touch TT_DARK. The user explicitly approves the existing dark mode.

After editing, run these greps:
1. `TT_LIGHT = {` -- must return exactly 1 hit.
2. `'#eff1f5'` -- must return at least 1 hit (Latte base surface).
3. `'#e6e9ef'` -- must return at least 1 hit (Latte mantle canvas).
4. `'#dce0e8'` -- must return at least 2 hits (Latte crust used as both
   `--bg-surface-2` AND `--p-intake-bg`).

---

## TASK 2 — Density wiring (make compact / balanced / generous actually do something)

**Problem:** Settings -> Appearance offers a Density segmented control
(compact / balanced / generous), the setting is plumbed via
`updateSettings({ density })` and stored on `settings.density`, but no
component actually reads the value -- row paddings and font sizes are
hard-coded. Switching density currently does nothing visible.

**Fix:** Derive a `densityScale` object from the setting and apply it
where row padding / font size lives.

### 2a. Add a `DENSITY_MAP` constant

Find the top-of-file tokens region (just after `DEFAULT_PHASES`, search
for `MIGRATION_VERSION` -- insert just before that line). Add:

```js
// Density scale tokens. Read in App via `settings.density`, applied to
// list-row padding and primary line font-size. Values picked so compact
// fits ~25% more rows on screen and generous gives ~15% breathing room
// over balanced.
const DENSITY_MAP = {
  compact:  { rowPadY: 6,  rowGap: 2, line1: 14, line2: 12 },
  balanced: { rowPadY: 9,  rowGap: 3, line1: 15, line2: 13 },
  generous: { rowPadY: 13, rowGap: 5, line1: 16, line2: 13 },
};
function densityFor(value) {
  return DENSITY_MAP[value] || DENSITY_MAP.balanced;
}
```

### 2b. Pass density into the row renderer

The row component receives a `density` prop already in some places.
Grep `density` in `ListPane` and the row component to identify the prop
flow. Two cases:

- If the row component does NOT yet accept `density`, add it to the prop
  list. Forward it from `ListPane` -- which already receives `density`
  from App per Phase 8 wiring.
- If the row component accepts `density` but ignores it, that is the
  bug to fix in 2c.

### 2c. Apply density to row styles

In the WO row JSX, find the hard-coded padding / line-1 font-size /
line-2 font-size. Replace with `densityFor(density)` reads:

```js
const d = densityFor(density);
// inside row container style:
padding: `${d.rowPadY}px 14px`,
// line 1 (address) style:
fontSize: d.line1,
// line 2 (meta) style:
fontSize: d.line2,
// gap between line 1 and line 2:
gap: d.rowGap,
```

Do NOT touch every padding in the row -- only the vertical pad on the
container and the two text line sizes. Horizontal padding stays at 14px.

### 2d. Confirm Appearance section still drives the value

The Segmented control in `AppearanceSection` calls `setDensity(value)`,
which writes `settings.density`. After Task 2c, switching the control
should now visibly resize rows.

If grep shows `setDensity` not wired to `updateSettings({ density })`,
fix that wire -- but per Phase 8 review, this should already be in
place. Verify before editing.

---

## TASK 3 — Verification (no code)

Run and report:

1. `TT_LIGHT = {` -- exactly 1 hit.
2. `Catppuccin` -- at least 1 hit (the comment block in TT_LIGHT).
3. `'#eff1f5'` -- at least 1 hit.
4. `DENSITY_MAP` -- exactly 1 definition hit, plus at least 1 read via
   `densityFor`.
5. `function densityFor` -- exactly 1 hit.
6. `function migrateOrders` -- still exactly 1 hit (Phase 11 regression).
7. `new Tray\(` in `main.js` -- still exactly 1 hit (Phase 10 regression).
8. `function hexToRgba` -- still exactly 1 hit (Phase 9 dedupe regression).
9. Grep `o\.priority` -- must show only the `migrateOrders` body
   (Phase 11 regression).

Visually verify (live test, rule 4):
- Switch theme to light. Cards should be lighter than canvas. Phase
  headers should read as a deeper band against cards. No surface should
  read as pure white.
- Switch density compact -> generous. Row heights should visibly change.

If either visual check fails, STOP and report -- do not patch a third
time without re-reading the row component.

---

## Out of scope

- Sync-interval timer (Phase 13 candidate).
- Per-row syncStatus indicators (Phase 14 candidate).
- Tab restructure (new official "Invoiced" bucket -- still deferred).
- Touching TT_DARK.
- Tweaking Catppuccin Latte hex values. Port the palette as-is; if it
  reads wrong in practice, the next phase swaps to a different vetted
  palette wholesale rather than re-tuning these values.

---

## Risk flags (mitigate before committing)

1. **Catppuccin Latte vs the user's taste** -- this is the third light
   palette attempt. If the user rejects this one too, the problem is
   most likely not the palette but a downstream component (e.g. a
   hard-coded `background: '#fff'` somewhere overriding the tokens).
   Before proposing a Phase 13 palette swap, grep for hard-coded
   `#fff` / `#ffffff` / `white` in JSX style props across `index.html`.
2. **PM chip color collision** -- `--pm-amh` is mapped to Latte green,
   same as `--p-approved`. Since per-PM colors are now stored in the
   data layer (Phase 9), the var fallbacks only fire when a PM has no
   color override. Acceptable; flag if it appears in practice.
3. **Density row-flicker** -- changing `settings.density` will rerender
   every row. Acceptable for a setting that flips infrequently. Do not
   memoize prematurely.
4. **Compact density on touch / older eyes** -- the user noted older
   eyes are a concern (per redesign-notes Thread 2). The compact value
   here drops line-1 to 14px and line-2 to 12px. 12px crosses the
   redesign's 13px floor; consider raising compact line-2 to 13px if
   the user reports it is unreadable. Mitigation: that is exactly what
   a live test verifies -- do not pre-adjust.

---

## Commit message

`phase12: light-mode v3 (Catppuccin Latte) + density wiring`
