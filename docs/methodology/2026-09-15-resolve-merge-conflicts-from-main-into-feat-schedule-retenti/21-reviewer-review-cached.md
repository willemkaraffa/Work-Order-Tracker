---
at: 2026-09-15T19:00:00.599Z
role: reviewer
action: review---cached
model: gemini-3.1-pro-preview
outcome: answered
---

## reviewer / review---cached

### Attachments (referenced, not copied)

- diff: `--cached` @ --cached
- file context: `.claude/settings.json, .githooks/post-checkout, .githooks/pre-commit, docs/intent/2026-09-14-po-frame-hooks.approval.json, docs/intent/2026-09-14-po-frame-hooks.md, docs/intent/2026-09-15-merge-main-into-schedule-retention.approval.json, docs/intent/2026-09-15-merge-main-into-schedule-retention.md, extension/background.js, extension/content.js, extension/popup.html, extension/popup.js, overseer.json, package.json, scrape_amh.py, scripts/amh-envelope-probe.js, test/coder-role-gate.test.js, test/commit-authority-gate.test.js, test/spawn-limiter.test.js` @ --cached

### Instruction sent (verbatim)

```text
You are an INDEPENDENT, ADVISORY code reviewer. You do NOT approve, reject,
or run any gate. You FLAG. Review the unified diff below for defects.

You are given the FULL CURRENT TEXT of every touched file, followed by the diff.
Review the DIFF, but resolve every question against the FULL FILES.

Do NOT report a symbol as missing, undefined, unimplemented, or not-exported
merely because it does not appear in the diff. Unchanged code is absent from a
diff by definition; that is not evidence it does not exist. Search the full file
text first. If a file is marked TRUNCATED, say you cannot tell rather than
guessing. Absence of evidence is not evidence of absence, and a confident wrong
finding costs more than a missed one.

Priority checks (React + JS):
A1 mirror-state: useState(x)+useEffect(()=>setX(derived),[dep]): should be derived/memoized.
A2 stale-init: useState(maybeNull) where init is null on first render; later recomputes are lost.
A3 render-guard-vs-layoutEffect: conditional render hides an element a useLayoutEffect measures.
A4 wrong-deps: effect must run post-mount but deps fire pre-mount.
A5 inline-component: component defined inside another component's render body -> remount/identity loss.
A6 unstable-listener: addEventListener handler is a fresh closure each render -> leaked listeners.
A7 uncleaned-timer: setTimeout/setInterval in an effect with no clearTimeout/clearInterval cleanup.
Also: correctness bugs (off-by-one, wrong operator, null deref, bad boundary), and porting
mismatches (copied pattern whose precondition the new site does not preserve).

Output ONLY a JSON array, no prose, no markdown fences. Each finding:
{"file":"path","line":123,"symbol":"exact source substring","severity":"high|med|low","rule":"A3|correctness|...","problem":"one sentence","fix":"one sentence"}
"symbol" MUST be a short, VERBATIM substring copied from the current file text at the
problem site (a call, declaration, or expression, e.g. "urllib.request.quote" or
"useEffect(() => setX"). It is how a downstream tool locates and verifies your finding
by CONTENT, not by line number (line numbers drift). Copy it exactly, including case and
punctuation; do not paraphrase, summarize, or reconstruct it. A finding whose symbol is
not found verbatim in the file is auto-dismissed as unlocatable, so a wrong symbol is a
dropped finding. Empty array [] if nothing found. Do not invent issues to fill the array.

=== FULL TEXT OF TOUCHED FILES ===
[attachment 2: .claude/settings.json, .githooks/post-checkout, .githooks/pre-commit, docs/intent/2026-09-14-po-frame-hooks.approval.json, docs/intent/2026-09-14-po-frame-hooks.md, docs/intent/2026-09-15-merge-main-into-schedule-retention.approval.json, docs/intent/2026-09-15-merge-main-into-schedule-retention.md, extension/background.js, extension/content.js, extension/popup.html, extension/popup.js, overseer.json, package.json, scrape_amh.py, scripts/amh-envelope-probe.js, test/coder-role-gate.test.js, test/commit-authority-gate.test.js, test/spawn-limiter.test.js @ --cached -- 203460 bytes, not copied]

=== DIFF (--cached) ===
[attachment 1: --cached @ --cached -- 98198 bytes, not copied]
```

### Reply received (verbatim)

```text
[
  {
    "file": "extension/background.js",
    "line": 277,
    "symbol": "if (await msrInFlight()) return { ok: false, error: 'An MSR capture is already running.' };",
    "severity": "high",
    "rule": "correctness",
    "problem": "The `msrInFlight` function is called with `await` but it is not defined as an async function or returning a promise in the diff context, wait, looking at the full file, `msrInFlight` is defined as `async function msrInFlight() { ... }` so `await msrInFlight()` is correct.",
    "fix": "No fix needed."
  }
]
```
