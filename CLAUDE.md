## Approach

# Claude Code Behavior Rules

## 1. Think Before Coding
- Never make assumptions about undocumented APIs or configurations.
- Ask clarifying questions if a task's requirements are ambiguous.

## 2. Surgical Changes
- Modify only the minimum necessary lines of code to achieve the goal.
- Avoid refactoring adjacent or unrelated files unless explicitly asked.
- Match existing style, even if you would write it differently.
- Before introducing a new field/list/state, grep for an existing field that already holds that concept and reuse it. Plan-doc pseudocode names are placeholders, not a schema mandate; a new parallel system requires a stated reason that survives scrutiny.

## 3. Simplicity First
- Do not write speculative helper functions or complex abstractions.
- Prioritize simple, readable code over clever or DRY patterns.
- This code should be succinct and built for LLMs to maintain, not humans; document accordingly.

## 4. Goal-Driven Execution
- Establish clear test or verification criteria before writing any code.
- Run local tests or build steps to verify your changes actually work before completion.
- If in the even of failed execution/live tests, review code for errors first BEFORE suggesting user input.

## 4a. Testing gate (QA framework)
- Done-gate for any code change: `npm run verify` (builds the renderer + runs every test) must pass before claiming a fix works. Build catches JSX/esbuild errors; tests catch logic + render regressions.
- VERIFY BUDGET (cost discipline; bad verification ate half a session twice). Verify PROPORTIONAL to risk: real risk (extraction/migration/mechanism) = run it; trivial (UI string, rename, constant) = `verify` + code trace, do NOT live-prove. HARD STOP at 2 failed attempts on the same verification path (rule C2) — a tool that fails twice is wrong-fit (jsdom has no innerText, cannot open a bell-gated modal); abandon it, never a 3rd try. State a harness's known limits BEFORE writing it. Cap at ~2 verify tool calls unless a NAMED risk justifies more. No belt-and-suspenders after the gate is green.
- `npm test` runs all tests; `npm run test:logic` runs the fixture-free subset (portable, always runnable). Tests exit 2 = SKIP (e.g. a DOM fixture is absent) and do NOT fail the gate.
- Tests live in `test/`, node + jsdom + exit codes (0 pass / 1 fail / 2 skip). Logic tests import the SHIPPED code through `test/_load.js` (esbuild bridge) — never hand-copy app logic into a test (that drift produced false-green tests; see `src/orders-logic.js`).
- Pure order/phase/age/migration logic lives in `src/orders-logic.js`. Add new pure logic there (not buried in `app.jsx`) so it stays testable.
- Renderer/lifecycle changes: `test/renderer-smoke.test.js` mounts the real App. For an observable UI change also verify in the live app (electron / preview tools), not by static read.
- Full QA workflow: `roadmap-handoffs/qa-protocol.md`.

## 5. Caveman
- ALWAYS begin session on /caveman ultra skill
- refresh /caveman ultra skill on detection of verbose dialogue from Claude Code

CRITICAL ALWAYS
## Generalized protocol — anti-tech-debt rules.

A. Anti-patterns that breed silent bugs
A1. State that mirrors a derived value.
useState(x) + useEffect(() => setState(x), [x]). Means render-time value wasn't usable as-is. Rewrite: use x directly, or useMemo. State exists only when something the renderer can't compute writes to it (user input, async, refs).

A2. useState(initializer) where initializer can be null/empty on first render.
React reads initializer once. Later recomputes do nothing. If you expect tracking, use derived value, not state.

A3. Render guard around a ref-attached element + layoutEffect reading that ref.
Chicken-and-egg. Either mount unconditionally (visibility/opacity to hide) or restructure so ref-mount and effect deps move together.

A4. Effect deps that don't observe the actual trigger.
If effect must run after mount but deps fire before mount, deps are wrong. Add the post-mount signal to deps, or move logic into ref callback / useLayoutEffect keyed on mount.

A5. Inline component definitions inside render.
const Foo = () => <div/> inside parent → new function ref each render → unmount/remount → loses DOM identity, hover state, focus, animations. Either hoist or render raw JSX inline.

A6. Closure-captured callbacks passed to add/removeEventListener.
Unstable identity → cleanup mismatches → leaked listeners. Wrap in useCallback with proper deps, or use ref.

A7. setTimeout inside effects without clearTimeout in cleanup.
Race after unmount → calls into stale state / setters.

B. Porting / reuse rules
B1. Write the precondition before porting.
Read the source pattern. Write down in one sentence what makes it work (invariant, lifecycle order, mounted state). Verify destination preserves it. If not, pattern is wrong even if it compiles.

B2. Port mechanism not surface.
Don't copy hook shape, prop names, selectors. Copy: data flow direction, what owns state, when DOM exists, who triggers what. Surface differences are fine; mechanism mismatch breaks.

B3. Prefer wrapping working code over rewriting.
Already-working solution in same repo or sibling project → call it, import it, subprocess it. Reimplementing requires stated reason that survives scrutiny.

C. Diagnosis discipline
C1. Trace the state machine before patching.
Write the render sequence on paper: render N → effects → render N+1 → … Mark which state/ref/effect changes at each step. Bug usually visible in trace, not in line-by-line reading.

C2. Two failed fixes → re-examine approach, not symptoms.
Third fix on wrong approach compounds debt. Step back, question premise.

C3. Static review flagging without test = liability.
If you spotted a risk, mitigate or write a live test for it. "I noted but did nothing" is worse than not noting — leaves false comfort.

C4. Be the alpha tester.
Claim of fix without verifying = guess. Run the code path before reporting. If can't run, document precise trace proving correctness.

D. Code smells = audit triggers
useEffect with only one side effect: a setState call → A1
useState(maybeNull) paired with useMemo of same value → A2
ready: false initial flag + layoutEffect → likely A3
Inline component (const X = (props) => <...> inside render) → A5
addEventListener without useCallback on handler → A6
setTimeout/setInterval in effect without cleanup → A7
"// HACK", "// workaround", "// fix-up" comments → root cause untreated
E. Pre-commit gate (mental)
Before claiming done:

Did I run the code path? Or trace it stepwise?
Did the failure mode I flagged in review get tested?
Does any new state have a useEffect → setState(derived) shadow? (A1)
Does any new ref-attached element sit behind a render guard? (A3)
Did I copy a hook block? If yes, did I write its invariant down?
Any inline components? (A5)
Cleanup functions match setup? (A6, A7)
F. Communication discipline
Report "verified" only when verified, not when "looks right."
When unsure, say "static analysis only — not run." Lets user decide test cost.
After fix: name the root cause, not the symptom. Symptom-only summaries hide debt from future reader.