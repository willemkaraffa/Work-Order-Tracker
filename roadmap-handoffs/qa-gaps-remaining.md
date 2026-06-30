# QA Framework — Remaining Gaps (Gap 1 handled separately)

Status 2026-06-30: Gap 1 (handler + reconciler extraction) is being done now. This
file holds Gaps 2 and 3 for a future session. Context: see `qa-protocol.md` and
the `project_qa_framework` memory.

## Gap 2 — note-card input-lock regression (no automated coverage)

Symptom: editing a SAVED note card freezes all text entry until app restart
(`bug_note_card_input_lock` memory — OPEN/recurring). `renderer-smoke.test.js`
asserts mount-only; it does not exercise note editing.

Likely mechanism (target this, not the symptom): NoteCard **remount** — memory note
"id-less card keys caused React to reuse wrong NoteCard instances" points at the
A5 class (inline component / unstable key -> remount -> lost focus/input). The
freeze is the downstream symptom of a remount or a leaked/duplicated event
listener (A6).

Fill plan:
1. jsdom interaction test (preferred first step, cheap):
   - Seed a WO with a saved noteCard, mount real App, navigate to open the WO's
     command center / detail so the NoteCard input is in the DOM.
   - Capture the note input's DOM node reference. Simulate edit + typing
     (dispatch input/change events).
   - Assert: (a) the SAME DOM node persists across the edit (no remount —
     `node === document.querySelector(sameSelector)`), (b) the input value
     reflects typed text, (c) NoteCard key/id is stable.
   - This catches the remount/key-instability root cause. Reuse the
     `renderer-smoke.test.js` mount scaffold (jsdom globals already solved:
     requestAnimationFrame, getComputedStyle).
2. Honest limit: if the real freeze is an Electron focus-stealing issue rather
   than a React remount, jsdom will NOT reproduce it. Backstop = ONE live
   preview-tool / Playwright test driving the actual renderer to type into a
   saved note and assert subsequent keystrokes land. Only add this if step 1
   passes yet the bug still reproduces live.
3. When reproduced: capture console + `document.activeElement` at freeze time
   BEFORE patching (memory `bug_note_card_input_lock` says do not blind-patch).

Effort: medium (needs the command-center open path mounted in jsdom).
Risk: low (additive test).

## Gap 3 — dark fixture tests (5 AMH dumps missing)

`extract` + `contacts` run; these SKIP until their dumps are committed to
`test/fixtures/`:

| Test | Missing dump(s) |
|---|---|
| full-flow / wo9718400 | wo-dump-AMH-1779986509675, 1779987193120, 1779987211685, 1779987228527, 1779987247270 |
| expand-static | wo-dump-AMH-1779978895264 |
| contacts (case B only) | wo-dump-AMH-1779982058902 |

Fill plan: re-capture those WOs through the app's existing dump mechanism (the
same capture that produced the dumps already in `test/fixtures/`), drop the JSON
into `test/fixtures/`. Tests auto-light — they already self-SKIP when absent, no
code change. Pure data capture.

Note: dumps are ~0.8-1.5 MB HTML each. If repo size matters, consider trimming
the captured HTML to the relevant subtree, or git-lfs. Not required for function.

Effort: trivial (data capture). Risk: none.
