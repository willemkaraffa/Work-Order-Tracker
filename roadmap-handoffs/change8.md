# CHANGE #8 - "More Information" (Misc) card: a super-pinned, always-present detail field

Replaces the outdated, non-editable legacy "default note" in the detail pane with a single always-present, editable **More Information** card pinned ABOVE the Add-note composer - a header extension for details that do not fit the structured header fields (alternate phone numbers, contact names, gate codes, access notes, etc.).

This is a standalone change (not a ROADMAP line; user-requested follow-up). Commit separately. Do NOT push. Do NOT publish.

Repo: `C:\dev\Work-Order-Tracker`. Branch: `claude/roadmap-v3.1`. App version 3.0.1. Electron + React via Babel-standalone (no build step; JSX compiled at runtime, index.html:28). User runs dev with `npm start` (quit installed-app tray instance first - single-instance lock), reloads with Ctrl+R. Verify syntax by reading; user reloads to test.

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

---

## Key design decision: REUSE `o.notes` as the Misc field (do NOT add a new field)
The legacy free-text field `o.notes` is already wired into three places: the detail-pane "default note", the WO edit form ("Notes" textarea), and CSV export. Per the "prefer wrapping existing working code" rule, repurpose `o.notes` as the **More Information / Misc** field rather than introducing a parallel `o.misc`. User has confirmed the worthless scraper-populated `o.notes` content is irrelevant - do NOT build migration/preservation logic for it.

## Verified investigation (read before coding; confirm still current - change7 already landed)

### Where `o.notes` surfaces today
1. **Detail data builder `toDetailData` (`index.html:818-876`).** The `notes` array (`:850-867`) maps real `noteCards` to display rows, then APPENDS a synthetic legacy card (`:859-865`) whenever `o.notes` is truthy:
   ```jsx
   if (o.notes) {
     list.push({ id: '_legacy', type: 'Note', time: fmtCreated(o.dateCreated), body: o.notes, pinned: false, edited: false, legacy: true });
   }
   ```
   `raw: o` is exposed on the detail data (`:874`) - so the detail pane can read `data.raw.notes` directly.
2. **Migration `migrateOrders` (`index.html:~3915`).** Step 1 (around `:3921-3931`) folds `o.notes` into a real `noteCard` ONLY when `noteCards` is empty, and does NOT clear `o.notes`. NOTE: this means an order whose `o.notes` was folded ALSO still hits the `_legacy` append above, so the same text can render twice today (latent duplicate-display bug). Removing the `_legacy` append (PART below) fixes that as a side effect.
3. **WO edit form `WOForm` (`index.html:1401-1408`).** A "Notes" `<textarea>` bound to `form.notes` -> `o.notes`.
4. **CSV export (`index.html:4637`).** `['Notes', o => o.notes || '']`.

### Detail-pane render order (the relocate target)
`DetailPane` (`index.html:2259`) renders the notes region at `index.html:2381-2394`:
```jsx
<div style={{ padding: '18px 28px 0', display:'flex', flexDirection:'column', gap:12, flex:1, minHeight:0, overflowY:'auto' }}>
  <NoteComposer onSave={(note) => onAddNote && onAddNote(data.wo, note)} />
  {data.notes.map((n, i) => (
    <NoteCard key={n.id} {...n} onEdit={...} onDelete={...} onPin={...} />
  ))}
</div>
```
The Misc card must render as the FIRST child of this scroll region, before `NoteComposer`.

### Edit mechanism to PORT (do not reinvent)
`NoteCard` (`index.html:2485-2569+`) already implements the exact inline-edit mechanism we want: local `draft` state seeded from `body` (`:2488`), `React.useEffect(() => setDraft(body), [body])` (`:2491`) to resync when the prop changes, a `saveEdit` that only fires `onEdit` when the trimmed draft differs (`:2502-2506`), and a textarea + Cancel/Save block (`:2540-2566`). Port THIS mechanism into the Misc card.

### Handler model to PORT
App-level note handlers use `updateOrder(id, cur => ({ ...cur, <field>, history:[...] }))`. `editNote` (`index.html:4724-4734`) is the closest model. Detail-pane handlers are wired on the `<DetailPane>` element (`index.html:4943-4956`).

---

## PART 1 - data + handler (no UI yet)
1. **Stop the legacy/duplicate display.** In `toDetailData` remove the `_legacy` append (`index.html:859-865`) entirely. `data.notes` now contains only real note cards. (Genuine old notes already converted to real cards by migration are unaffected; the worthless scraped `o.notes` simply stops surfacing here.)
2. **Stop folding `o.notes` into a note card.** In `migrateOrders`, remove step 1 (the `if (cards.length === 0 && typeof o.notes === 'string' && o.notes.trim())` block, ~`:3921-3931`) so `o.notes` is preserved AS the Misc field rather than being copied into the note stream going forward. Leave the rest of the migration (priority-field archive, `noteCard` id backfill from change7 Part C) intact. Do NOT clear `o.notes` (non-destructive).
3. **Add a `setMisc` handler** in the App component, modeled on `editNote` (`:4724-4734`):
   ```jsx
   const setMisc = React.useCallback((id, text) => {
     updateOrder(id, cur => ({
       ...cur, notes: text,
       history: [...(Array.isArray(cur.history) ? cur.history : []), { ts: Date.now(), action: 'more info edited', detail: '' }],
     }));
   }, [updateOrder]);
   ```
4. **Wire it** onto `<DetailPane>` (`:4943-4956`): add `onSetMisc={setMisc}`. Add `onSetMisc` to the `DetailPane` signature (`:2259`).

Decision baked in (flag if wrong): writing the Misc field appends a history entry. If the user finds that too noisy for a free-text field, drop the history line - confirm. Keeping it is consistent with note edits.

Commit Part 1 alone? It is inert without UI - acceptable to fold Part 1 + Part 2 into ONE commit since the feature is a single coherent unit. Recommend ONE commit for the whole change unless you prefer two. Do NOT leave a half-wired handler across a push (we don't push anyway).

## PART 2 - the More Information card UI
Add a small component (e.g. `MoreInfoCard`) that PORTS `NoteCard`'s edit mechanism (draft state + resync effect + Cancel/Save textarea, `:2488-2566`) but is ALWAYS present and styled as a header-extension card. Render it as the first child of the notes scroll region, before `NoteComposer` (`:2386`).

Behavior:
- Header label: "More Information" (the user named "Misc." or "More Information"; use "More Information"). Style it as a distinct, slightly emphasized card (e.g. a left accent or `var(--accent-soft)` background) so it reads as a pinned header extension, NOT a regular timeline note. Do not add a `pin`/`delete`/timestamp menu - it is singular and permanent.
- When `data.raw.notes` is empty: show muted placeholder text (e.g. "Add alternate phone, contact names, access details...") and a click-to-edit affordance.
- When present: show the text (`whiteSpace:'pre-wrap'`, like `:2568`) with an edit affordance.
- Editing: textarea seeded from `data.raw.notes`; Save calls `onSetMisc(data.wo, draft)`; Cancel reverts. Reuse the `saveEdit` "only fire if changed" guard, but ALSO allow saving an empty string (clearing the field) - unlike NoteCard which blocks empty. So the guard is `if (draft !== body) onSetMisc(...)` (drop the `trimmed &&` truthiness check so the field can be cleared).
- Mount it with `data.raw` available; pass `value={data.raw?.notes || ''}` and `onSave={(text) => onSetMisc(data.wo, text)}`.

Render site (`:2386`):
```jsx
  <MoreInfoCard value={data.raw?.notes || ''} onSave={(text) => onSetMisc && onSetMisc(data.wo, text)} />
  <NoteComposer onSave={(note) => onAddNote && onAddNote(data.wo, note)} />
  {data.notes.map(...)}
```

## PART 3 - reconcile the other two `o.notes` surfaces
4. **WO edit form (`index.html:1401-1408`).** Relabel the "Notes" `FormField` to "More Information" (still binds `form.notes` -> `o.notes`). This keeps the field editable from the form too and matches the new name. Confirm `form.notes` initialization (`:1302` region) is unchanged.
5. **CSV export (`index.html:4637`).** Relabel the column header `'Notes'` -> `'More Information'` (value unchanged).

These keep all three surfaces (detail card, edit form, export) consistent on the same `o.notes` field under one name.

## Risks (mitigate or live-test)
1. **Already-folded genuine legacy notes may appear twice** - once as a real migrated note card and once in the More Information field (since migration previously copied `o.notes` into a card without clearing `o.notes`). For worthless scraped data this is irrelevant (user confirmed). For any genuine typed legacy note it could duplicate. MITIGATION: the field is now editable inline, so the user can clear the More Information box in one action. Do NOT add destructive auto-cleanup. LIVE TEST 4 below verifies the duplicate is at worst cosmetic and clearable.
2. **Empty-clear path.** NoteCard blocks empty saves; the Misc field must ALLOW clearing. Ensure the save guard permits an empty string (see PART 2). LIVE TEST 3.
3. **Resync when switching WOs.** `MoreInfoCard` keeps local `draft`; if the user opens WO-A, types without saving, then selects WO-B, the draft must reset to WO-B's value. PORT NoteCard's `useEffect(() => setDraft(value), [value])` resync (`:2491`). Because the detail pane re-renders with new `data.raw.notes` on WO switch, the effect resets the draft. LIVE TEST 5. (If `MoreInfoCard` does not remount on WO change, the effect is what saves you - verify it is present.)

## Live test (user runs `npm start`, Ctrl+R)
1. **Placement + naming:** open any WO detail - a "More Information" card sits at the top of the notes region, above the Add-note box, visually distinct from timeline notes.
2. **Edit + persist:** type alt phone / contact names, Save, reselect the WO (or reload) - text persists.
3. **Clear:** edit to empty, Save - field clears to placeholder and stays cleared after reload.
4. **No worthless legacy surfacing:** a WO that previously showed the old scraped "default note" no longer shows it as a timeline note; if its text lands in More Information, it is editable/clearable. No text renders twice as a timeline card.
5. **WO switch resync:** open WO-A, start typing in More Information WITHOUT saving, switch to WO-B - WO-B shows its own value (not WO-A's unsaved draft).
6. **Form + CSV:** the edit form's field reads "More Information" and edits the same text; CSV export column header reads "More Information".

---

## File map (verify line numbers before editing - they shift as you edit)
- `index.html:818-876` `toDetailData`; legacy append to remove `:859-865`; `raw:o` `:874`.
- `index.html:~3915-3952` `migrateOrders`; fold-step to remove `~:3921-3931` (keep change7 id backfill).
- `index.html:2259` `DetailPane` signature (add `onSetMisc`); notes render region `:2381-2394` (mount `MoreInfoCard` before `NoteComposer` `:2386`).
- `index.html:2485-2569` `NoteCard` - PORT REFERENCE for the inline-edit mechanism (draft `:2488`, resync `:2491`, saveEdit `:2502`, textarea/buttons `:2540-2566`).
- `index.html:4724-4734` `editNote` - handler model for new `setMisc`; `<DetailPane>` wiring `:4943-4956`.
- `index.html:1401-1408` WOForm "Notes" field (relabel); `index.html:4637` CSV "Notes" column (relabel).
- Out of scope: `AlertCard`, `FSAlertCard`, `FullScreenLanding`, in-pane `Landing`. Do not touch.

## Notes / gotchas
- JSX compiled at runtime by Babel standalone; verify by reading, user reloads (Ctrl+R).
- Installed app at `%LOCALAPPDATA%\Programs\Work Order Tracker\resources\` is a SEPARATE frozen copy; test only via `npm start`.
- Order store: `%APPDATA%\work-order-tracker\wo-data.json` (renderer persists via `window.storage.set('wo_data', ...)`).
- Scraper rework (ROADMAP lines 18-19) will later fix the worthless `o.notes` content at the source; this change only changes how the field is presented/edited, not how it is populated.
- Prior branch work (do not disturb): all FIX items; sort keys (+ lastNote, Status reverse lock, direction toggle); Change #2-#6; Change #7 (A WO# right-align, B City route sort, C noteCard id stability, D list context-menu overhaul with nested submenus).
- After this: ROADMAP line 15 (custom filters/pages via Tools dropdown) is the user's next priority for today.
