# Cost-reduction levers (from S1a service-library slice, 2026-07-28)

Brainstorm, ranked by savings. Not measured; estimated from this slice's spends
(architect 2x ~168k, builder ~100k, whole-file reads, 3 question rounds).

1. **Verify source facts BEFORE spawning the architect.** Architect ran twice
   (~168k) only because it was fed the doc's stale "AMH E=Labor Price". Opening
   the xlsx/PDF first = one architect pass. Front-loading fact-checks is the
   biggest single lever.
2. **Bounded reads, not whole-file.** Whole-file PDF (85k) + whole-file memory
   reads tripped the read-budget hooks. Use Grep + Read offset/limit; ask Gemini
   (scripts/ask.js) for file Q&A instead of slurping.
3. **Batch clarifying questions.** 3 separate AskUserQuestion rounds this slice
   (one dismissed). Front-load into 1 modal up front.
4. **Skip the external reviewer on small diffs.** Gemini truncated the core files
   -> I re-read the hunks manually anyway. For a small diff, read it directly; the
   external pass added little.

Net: front-load fact-verification before any spawn -> kills the most expensive
waste (redundant architect pass).
