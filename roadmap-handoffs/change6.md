# CHANGE #6 - Row layout: (A) status pill far-left, (B) city right-aligned by day counter

This handoff covers TWO ROADMAP items that live in the SAME component (`ListRow`) and share one visual test, so they are batched in one doc. They are still committed SEPARATELY (one commit per item), per the repo rule "commit each discrete change separately."
- **PART A** (ROADMAP line 16): relocate the status pill to the far left of the meta row, before the company (PM) chip.
- **PART B** (ROADMAP line 17): move the city tag from inline-after-address to a right-aligned slot, consistently positioned immediately left of the day counter.

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
- (Memory) When something "still" looks wrong after a fix, grep the user-visible string and confirm WHICH component renders it before editing. This repo has duplicate components sharing labels.

## ROADMAP items
- Line 16: "CHANGE: Relocate status pills on rows to far left before Company pills, currently makes rows feel cluttered can harder to parse."
- Line 17: "CHANGE: Change format of City on row to always align right; all city tags should be in the same position in their particular row to the left of the day counter."

---

## Verified investigation (HEAD 54bf15a - read before coding, confirm still current)

There is exactly ONE list-row renderer: `ListRow` at `index.html:2019` (density only changes sizing via `densityFor(density)` -> `d`; it is not a second component). The list-panel rows the user means are these. The detail-pane and the landing alert cards (`AlertCard` :2601, `FSAlertCard` :3685) are SEPARATE and out of scope - do not touch them. (Confirm by grepping the visible fields if unsure.)

`ListRow` renders a flex column with two stacked rows inside the content cell:

### Headline row (`index.html:2053-2064`)
```jsx
<div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
  <span style={{ fontWeight: 700, fontSize: d.line1, color: 'var(--text-1)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '-0.005em' }}>{row.addr}</span>
  {row.city && <span style={{ color: 'var(--text-2)', fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap' }}>· {row.city}</span>}
  {row.flags?.map((f) => <FlagGlyph key={f} kind={f} />)}
  {row.age != null && (
    <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>{row.age}</span>
  )}
</div>
```
- `row.age` is the day counter (days in stage). It is pushed to the far right by `marginLeft:'auto'`. `ageHidden` (`:2020`) hides it (e.g. Paid view); when hidden there is no right-aligned element.
- `row.city` currently sits INLINE right after the address as `· {city}`, so its position slides with address length (the cluttered/inconsistent behavior line 17 calls out).

### Meta row (`index.html:2066-2077`)
```jsx
<div style={{ fontSize: d.line2, color: 'var(--text-2)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
  <PMChip pm={row.pm} />
  <TypeIcon kind={row.type} />
  <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-2)', fontSize: 13 }}>{row.wo}</span>
  <Dot />
  {!useSyncPill && <>
    <StatusPill status={row.status} size="sm" />
    <Dot />
  </>}
  {row.tech && <span>{row.tech}</span>}
  {showSyncPill && <SyncPill status={row.syncStatus} />}
</div>
```
- `PMChip` (`:2067`) is the "company pill" the roadmap refers to. `StatusPill` (`:2072`) currently appears AFTER PMChip/TypeIcon/WO#.
- `useSyncPill` is true for `view === 'sent' || 'invoiced'` (`:2025`); in those views the StatusPill is intentionally NOT shown (a `SyncPill` is shown instead at `:2076`). PART A must preserve that: only the `!useSyncPill` status pill moves.

---

## PART A - Task A1: move the status pill to the front of the meta row (line 16)
In the meta row (`:2066-2077`), make the `!useSyncPill` `StatusPill` the FIRST item, before `PMChip`. Keep separators sensible. Replace the meta-row inner JSX with:
```jsx
  {!useSyncPill && <>
    <StatusPill status={row.status} size="sm" />
    <Dot />
  </>}
  <PMChip pm={row.pm} />
  <TypeIcon kind={row.type} />
  <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-2)', fontSize: 13 }}>{row.wo}</span>
  {row.tech && <>
    <Dot />
    <span>{row.tech}</span>
  </>}
  {showSyncPill && <SyncPill status={row.syncStatus} />}
```
Notes:
- Result order: `StatusPill . PMChip Type WO# . tech [SyncPill]`. The leading Dot that used to sit after WO# is removed; the tech now carries its own leading `Dot` only when present (avoids a dangling separator when there is no tech).
- Do NOT change `StatusPill`/`PMChip`/`SyncPill` internals. This is pure reordering within one flex row.
- In sent/invoiced views (`useSyncPill`), nothing leads the row except PMChip (status pill is absent by design) - that is correct and matches today's behavior minus the relocated pill.

Commit Part A alone.

## PART B - Task B1: right-align the city tag next to the day counter (line 17)
In the headline row (`:2053-2064`): remove the inline city span and instead render city + age together in a right-aligned group so the day counter stays far right and the city sits immediately to its left in a consistent position. Replace the headline-row inner JSX with:
```jsx
  <span style={{ fontWeight: 700, fontSize: d.line1, color: 'var(--text-1)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '-0.005em' }}>{row.addr}</span>
  {row.flags?.map((f) => <FlagGlyph key={f} kind={f} />)}
  {(row.city || row.age != null) && (
    <div style={{ marginLeft: 'auto', flexShrink: 0, display: 'flex', alignItems: 'baseline', gap: 8 }}>
      {row.city && <span style={{ color: 'var(--text-2)', fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap' }}>{row.city}</span>}
      {row.age != null && (
        <span style={{ fontSize: 13, color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>{row.age}</span>
      )}
    </div>
  )}
```
Notes / interpretation (state under scrutiny):
- "All city tags in the same position to the left of the day counter" is implemented as a right-aligned group: `marginLeft:'auto'` pins the group to the right edge, the day counter is the rightmost element, and city is immediately left of it with a fixed `gap`. The group's RIGHT edge is consistent across rows; the city's left edge still varies with city length, but it is always anchored to the right side next to the counter (vs today's slide-with-address inline position). If the user instead wants a fixed city column (every city starting at the same x), that needs a width-reserved column and a different layout - confirm with the user before doing that; do NOT assume it.
- The leading `· ` prefix is dropped (it only made sense inline after the address). City now reads as its own right-aligned tag.
- `flexShrink: 0` keeps the city/age group from being squeezed; the address span keeps `overflow:hidden + ellipsis` to truncate first.

Commit Part B alone.

## Risk + required live test
Risk flagged (mitigate or test, do not ignore):
1. **Address truncation regression.** The address `<span>` has `overflow:hidden; textOverflow:ellipsis; whiteSpace:nowrap` but no explicit `flex`/`minWidth:0`. Today it truncates because the right-aligned age consumes free space. After Part B the right group is `flexShrink:0`, so a very long address must still ellipsize and must NOT push the city/age group off the right edge. LIVE TEST below covers this. If a long address overflows or shoves the group off-screen, add `flex: 1, minWidth: 0` to the address span (smallest fix) - do that only if the test shows it.
2. **Wrap behavior.** The meta row has `flexWrap: 'wrap'`. Reordering (Part A) could change where it wraps at narrow widths. Confirm in the test that the meta row still reads cleanly when wrapped.
3. **Both parts touch the same `ListRow` render.** Do Part A, test, commit; then Part B, test, commit - so a regression is attributable to one change.

Live test (user runs `npm start`, Ctrl+R):
1. **Status pill position (A)**: in Active view, confirm each row's meta line now leads with the colored status pill, then PM chip, type, WO#, tech. Rows should parse more easily (status scannable down the left).
2. **Sent/Invoiced views (A)**: switch to Sent and Invoiced; confirm NO status pill leads the row (sync pill still shown), i.e. the `useSyncPill` path is intact and nothing throws.
3. **City right-aligned (B)**: confirm the city tag now sits at the right of the headline, immediately left of the day-counter number, in the same horizontal zone on every row regardless of address length.
4. **Long address (B / risk 1)**: find or temporarily create a WO with a very long street address; confirm the address ellipsizes and the city/age group stays fully visible on the right, not pushed off-screen or overlapping.
5. **No city / no age**: confirm rows with no city (and Paid view where age is hidden) still render without an empty gap or a stray separator.
6. **Density**: toggle density (compact/comfortable) in Settings; confirm both rows still align at both sizes.

---

## File map (verified, HEAD 54bf15a)
- `index.html:2019` `ListRow` (the only list-row renderer; both tasks here).
- `index.html:2053-2064` headline row (Part B target: address `:2054-2058`, inline city `:2059`, flags `:2060`, age/day-counter `:2061-2063`).
- `index.html:2066-2077` meta row (Part A target: PMChip `:2067`, TypeIcon `:2068`, WO# `:2069`, StatusPill block `:2071-2074`, tech `:2075`, SyncPill `:2076`).
- `index.html:2025-2026` `useSyncPill`/`showSyncPill` (gates the status-vs-sync pill; Part A must preserve).
- `index.html:2020-2024` `ageHidden`/`ageBg` (day-counter visibility + age-tint background).
- `StatusPill`, `PMChip`, `TypeIcon`, `SyncPill`, `FlagGlyph`, `Dot` - existing chip components, do NOT modify (reorder only). Grep for `function StatusPill`/`function PMChip` if you need their props.
- Out of scope: `AlertCard` (`:2601`), `FSAlertCard` (`:3685`) - different components, do not touch.

## Notes / gotchas
- JSX compiled at runtime by Babel standalone; verify by reading, user reloads (Ctrl+R).
- The installed app at `%LOCALAPPDATA%\Programs\Work Order Tracker\resources\` is a SEPARATE frozen copy; test only via `npm start`.
- Order store `%APPDATA%\work-order-tracker\wo-data.json` (renderer persists via `window.storage.set('wo_data', ...)`).
- Prior work on this branch (do not disturb): all FIX items; sort keys + lastNote + Status (reverse) lock + direction toggle; Change #2 (scroll preservation, detail status dropdown, right-click menu + `woAction`, multi-select + BulkBar + bulk handlers); Change #3 (context-menu "View details" rename, colorized TypeIcon + `TYPE_COLORS`); Change #4 (in-pane Landing grid-row bound + `height:100%`); Change #5 Part A (mass status change via right-click, `bulkSetStatus` + `ctxBulk`); Change #5 Part B (launch-landing clip fixed in `FullScreenLanding` `:3568` - scroll wrapper + `flexShrink:0` footer; an interim `setZoomFactor` attempt was reverted).
- Remaining roadmap after this: line 14 (more list context-menu / bulk actions), line 15 (custom filters/pages via Tools dropdown), line 18 (scraper full address parsing - street vs city/zip), line 19 (scraper reliability + spreadsheet import).
