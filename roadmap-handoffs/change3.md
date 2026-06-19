# CHANGE #3 - Make the Work Type symbol more noticeable + rename context-menu "Open"

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

## Roadmap line (ROADMAP.md line 12)
"CHANGE: Make the Work Type symbol on the list panel more noticeable"

## Bundled fix (user reported after Change #2 live-test)
The right-click context-menu item labeled "Open" (added in Change #2, opens the WO in the detail pane) is confusing next to the "Open" work-order status. Rename it.

---

## Current state (all verified at HEAD 4dfcae6 - read before coding)

### TypeIcon component (the Work Type symbol)
`TypeIcon({ kind })` at `index.html:288`:
```jsx
function TypeIcon({ kind }) {
  const label = kind === 'P' ? 'Plumbing' : kind === 'H' ? 'HVAC' : 'Electric';
  return (
    <span title={label} style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 18, height: 18, borderRadius: 4,
      border: '1px solid var(--border-2)',
      color: 'var(--text-2)', fontSize: 10, fontWeight: 700,
      fontFamily: 'ui-monospace, monospace',
      flexShrink: 0,
    }}>{kind}</span>
  );
}
```
It is a small, low-contrast, monochrome bordered box showing a single letter (P/H/E). `kind` is the letter produced by `typeLetter(type)` (`index.html:629`): `plumbing->P`, `hvac->H`, `electrical->E`, else first letter uppercased.

Used in TWO places (shared component):
- `ListRow` meta row, `index.html:2050` (the list panel - the roadmap target).
- `DetailPane`, `index.html:2299` (`<TypeIcon kind={data.type} />{data.typeLabel}`).

### Established colorized-chip mechanism to reuse (do NOT reinvent)
Two existing primitives already render colored translucent chips with the exact pattern to mirror:
- `PMChip` (`index.html:272`): looks up a per-PM hex, then `bg = hexToRgba(hex, 0.18)`, sets `background: bg, color: hex`. Fixed-size inline-flex box.
- `StatusPill` (`index.html:315`): `border: 1px solid hexToRgba(c, 0.45)`, `background: hexToRgba(c, 0.18)`, `color: c`.
- `hexToRgba(hex, alpha)` helper at `index.html:258` - already handles 3- and 6-digit hex.

Reuse `hexToRgba` and this background+border+color formula. Do not add a new color utility.

### Context-menu "Open" item (bundled-fix target)
`index.html:1956`, inside the ListPane context-menu render:
```jsx
<MenuItem onClick={() => { onSelectWO(ctxMenu.woId); closeCtx(); }}>Open</MenuItem>
```

---

## Task 0 - rename context-menu "Open" (bundled fix)
Rename the label only; behavior is unchanged (it still calls `onSelectWO`).
- At `index.html:1956`, change the visible text from `Open` to `View details`.
- Confirm the exact wording with the user if they prefer a different label (e.g. "Open work order", "View", "Show details"). Default to `View details` - it is unambiguous against the "Open" status and matches the action (focus the detail pane).
Commit alone. Live-test: right-click a row; the first non-status item now reads "View details"; clicking it still opens the WO in the detail pane.

---

## Task 1 - colorize the Work Type symbol so it stands out

Goal: the type box should read at a glance by color, not just by a faint letter. Mirror the `PMChip`/`StatusPill` mechanism (translucent fill + matching border + saturated text color) rather than inventing a new style.

### 1a. Add a type-color map near the other color constants
Place a `TYPE_COLORS` map keyed by the SAME letters `TypeIcon` receives (`P`/`H`/`E`), beside `DEFAULT_STATUS_COLORS` (search `DEFAULT_STATUS_COLORS` - it ends near `index.html:231`). Recommended palette (confirm with user; easy to tweak live):
```js
const TYPE_COLORS = {
  P: '#3b82f6', // Plumbing - blue
  H: '#f97316', // HVAC - orange
  E: '#eab308', // Electrical - amber
};
```
Fallback for unknown letters: `'#6b7280'` (same neutral used by `statusColor`/`normalizeHex`).

### 1b. Rewrite TypeIcon to use the color
Replace the body of `TypeIcon` (`index.html:288`) so it pulls `c = TYPE_COLORS[kind] || '#6b7280'` and applies the established formula. Keep it the same shape/role; bump size slightly for visibility:
```jsx
function TypeIcon({ kind }) {
  const label = kind === 'P' ? 'Plumbing' : kind === 'H' ? 'HVAC' : kind === 'E' ? 'Electrical' : 'Other';
  const c = TYPE_COLORS[kind] || '#6b7280';
  return (
    <span title={label} style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 20, height: 20, borderRadius: 4,
      border: `1px solid ${hexToRgba(c, 0.5)}`,
      background: hexToRgba(c, 0.18),
      color: c, fontSize: 11, fontWeight: 800,
      fontFamily: 'ui-monospace, monospace',
      flexShrink: 0,
    }}>{kind}</span>
  );
}
```
Note: the original `label` ternary collapsed every non-P/non-H kind to "Electric" (so an unknown letter mislabeled as Electric). The version above splits `E` out and labels anything else "Other"; this is a small correctness improvement, not scope creep. Keep it.

Because `TypeIcon` is shared, the detail pane (`index.html:2299`) also gets the color - that is consistent and desirable; do not fork a separate component.

### Risk + live test
Risk: a future custom work type would map to the neutral gray fallback. That is acceptable (degrades gracefully, still bordered). Live-test: open the Active tab; Plumbing/HVAC/Electrical rows show distinctly colored type boxes; the detail pane shows the matching colored box; an unknown type shows a neutral gray box with its first letter.

Commit alone.

---

## File map (verified, HEAD 4dfcae6)
- `index.html:231` end of `DEFAULT_STATUS_COLORS` (add `TYPE_COLORS` near here).
- `index.html:258` `hexToRgba`; `:272` `PMChip` (reference pattern); `:315` `StatusPill` (reference pattern).
- `index.html:288` `TypeIcon` (Task 1b target).
- `index.html:629` `typeLetter` (produces the `kind` letter).
- `index.html:2050` `TypeIcon` in `ListRow` (list panel - the roadmap target).
- `index.html:2299` `TypeIcon` in `DetailPane`.
- `index.html:1956` context-menu "Open" item (Task 0 target).

## Notes / gotchas
- JSX compiled at runtime by Babel standalone; verify by reading, user reloads (Ctrl+R).
- The installed app at `%LOCALAPPDATA%\Programs\Work Order Tracker\resources\` is a SEPARATE frozen copy; test only via `npm start`.
- Order store `%APPDATA%\work-order-tracker\wo-data.json` (parse twice via `wo_data` key).
- Prior work on this branch (do not disturb): all FIX items, sort keys + lastNote fix + Status (reverse) lock + direction toggle, Change #2 (scroll preservation, detail-pane status dropdown, right-click context menu + `woAction`).
- Roadmap line 13 ("multiple selection ... mass-changing status with right click") and line 14 ("right-click context menu to perform more actions") build on the Change #2 context menu - they are the natural next items after this one; not in scope here.
