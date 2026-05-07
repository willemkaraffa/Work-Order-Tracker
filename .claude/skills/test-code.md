# Test Code Skill

When the user says "test," "run tests," or "verify this works," execute BOTH phases below in order. Static review alone is not sufficient — live execution is required to catch runtime and integration failures that code-reading cannot surface.

---

## Phase 1 — Static Review

Identify all files changed in this session (or since the last relevant commit). Read each one. Check:

**Logic**
- Async timing: does any operation depend on an async result that hasn't resolved yet?
- Conditional guards: are null/undefined/None checks in place before use?
- Loops and recursion: can any call path re-enter with the same inputs?
- State mutation: is shared state read before a prior write has persisted?

**Integration**
- Do all call sites and their targets agree on function signatures, field names, and key names?
- Are new files registered wherever the build or runtime needs them (package.json, imports, config, etc.)?
- Do all producer/consumer pairs (e.g. IPC sender/handler, API writer/reader, event emitter/listener) match exactly?

**Runtime-specific behaviors**
- Do not assume how a library behaves — verify against its docs or source when the behavior is non-obvious (e.g. what a flag returns for missing data, what an API does on error)
- Flag any place where the code assumes a value that could differ at runtime (cached vs. uncached, sync vs. async, present vs. absent)

**Security**
- User-sourced data rendered into HTML, SQL, shell commands, or file paths must be escaped or parameterized
- Inputs crossing trust boundaries (IPC, API, user input) must be validated before use

Document every finding — confirmed bugs and false positives — before moving to Phase 2.

---

## Phase 2 — Live Execution

Determine the appropriate live tests for the language and project type, then run them. The goal is to observe actual runtime behavior, not reason about it.

**Find and run existing tests first**
Look for a test suite (pytest, jest, go test, rspec, etc.) and run it. Read the output — don't just check the exit code.

**If no test suite exists, construct minimal live tests**

For each piece of changed logic, execute it against real or realistic inputs:

- Scripts and CLI tools: run them with the actual input files or data they will encounter in production. Capture full stdout/stderr. Verify the output is correct, not just that the process exited 0.
- Web/UI: launch the app, interact with every changed surface, and observe actual rendered output. Use available browser or screenshot tools — do not reason about what the UI "should" show.
- APIs and services: make real requests to the running service. Check response bodies, not just status codes.
- Data pipelines: run the pipeline end-to-end and inspect the output data. Spot-check specific rows or fields that the changed logic touches.

**For each live test, record:**
- What was run (exact command or action)
- What was observed (actual output, not expected)
- Pass or fail

Do not mark a test passed without observing the actual result.

---

## Reporting

After both phases, report:

- **Static findings**: each issue with file, function, severity, and whether it is a confirmed bug or false positive
- **Live findings**: each test with the actual observed behavior; clearly mark failures
- **Overall verdict**: all clear, or list what must be fixed before the code is releasable

Do not report "tests passed" based on static review alone. If live tests cannot be run (missing credentials, dependencies, environment), say so explicitly and list what was skipped.
