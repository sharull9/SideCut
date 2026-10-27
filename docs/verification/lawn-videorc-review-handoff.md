# LV011 review player and handoff acceptance

Production Windows Electron acceptance **passes**. On 2026-10-27, `vp run build:desktop` and `vp run verify:review-handoff` passed using a 30000/1001 fps nonzero-range synthetic export. Frame stepping, scoped shuttle, selected playback rate, theater, feedback filters and formula-safe CSV passed.

Explicit marker creation maps version time to source time and is undoable. A subsequent stale conversion is rejected. Original review threads and artifact hashes remain unchanged; revision A/B isolation and decoded playback after process restart pass. The [machine-readable report](lawn-videorc-review-handoff.json) records all checks as passing. The fixture uses a temporary Electron profile. The original LV010 fixture also passes after its resolved-feedback selector was updated for the status filter.

The first run exposed a false stale-project rejection: the frozen desktop export retained host journal metadata that the marker handler's reconstructed envelope omitted. Comparison now checks the project content and revision while excluding envelope metadata. A focused regression test reproduces that failure and passes with the fix; changed project content, project identity, revision and invalid time mapping remain rejected.

Reverse shuttle uses timed seeks rather than reverse decoding. These checks use synthetic media on Windows; physical capture and other platform acceptance belong to separate phases.

Repository verification: `vp run check` passed formatting, lint, all type checks and 630 tests across 132 files. `git diff --check` passed.
