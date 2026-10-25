# Segments and CLI foundation verification

Scope: phases 129.09, 129.10, 129.11, 130.01, and 130.02. Baseline: `5e29ace`. Worktree: `C:/Users/Arafa/.t3/worktrees/side-cut/t3-99e0dcc5`.

## Pinned contract

Reference checkout: `C:/Users/Arafa/.cache/sidecut-tandem-reference`, commit `735a9b8e162c1f951044baa892d94993869f2e77`.

The contract fixture is `tests/fixtures/tandem/segments-cli-foundation.json`. Its assertions come from actual `SegmentCalls.swift`, `Segments.swift`, `Arguments.swift`, `SegmentsCommand.swift`, and `ProjectClient.swift`. Swift was not executed on Windows. The fixture records source-derived expectations rather than a captured upstream run.

## Implemented behavior

- `segments` returns summaries with folder, duration, clip count, tracks, fields, files, missing files, and provenance. Damaged entries produce `problems` without hiding healthy entries. Lookup accepts folder ID, exact name, or an unambiguous case-insensitive name.
- `save-segment` requires explicit clip IDs or a range. It rejects a mixture of known and unknown IDs without saving a partial selection. Selection is exact: linked partners and transition sounds are included only when explicitly selected. Whole-clip range filtering, duplicate-ID elimination, track/time ordering, omitted-transition notes, title fields, placeholder fields, copied-resource results, and opt-in replacement follow the inspected source. Saving changes no project revision or undo entry.
- Segment media receives fresh IDs on insertion. Replacement receives a new internal storage ID so new resources cannot replace files already used by an earlier insertion. The library commits its record with a compare-and-swap check.
- `insert-segment` defaults to `place`, validates field values and resources, and returns the segment summary, insertion time, and `applied` result. The top-level `revision` remains a SideCut compatibility extension. Insertion and credit metadata use one authoritative batch, one revision, and one undo step. Optional label, author, and expected revision reach the shared coordinator. Cancellation is checked before committing.
- Unknown clips/resources return typed `notFound`; malformed selection/fields return `badRequest`. Renderer transport preserves `EditError` validation and stale-revision codes. The host checks explicit stale insert revisions before renderer dispatch; guards remain in place.
- CLI foundation supports `--name=value`, short `-h`/`-v`/`-o`, negative numeric arguments, `--`, repeated field/value options, positional segment names, default `segments list`, clock times, and `--expect`. Segment commands print readable output by default and JSON with `--json`. Existing `--endpoint-file`, `SIDECUT_API_FILE`, `--request`, `--input`, schema field arguments, and JSON clip-ID arrays remain supported.
- Project selection follows explicit `--project`, `SIDECUT_PROJECT`/`TANDEM_PROJECT`, and the nearest parent with one project. Render snapshots are excluded; ambiguous folders fail. Explicit SQLite-backed logical project paths use their existing owner lock. Discovery validates port/token/PID, rejects a dead owner, and checks the authenticated status path before sending an operation. A mismatched profile cannot receive the edit. No token is written to diagnostics.

## Checks

Executed on Windows PowerShell with the pinned Node 24 runtime:

- `vp install`: passed; lockfile unchanged.
- Focused tests covering core segments, CLI parser/discovery, authenticated CLI requests, browser session/library operations, and renderer error encoding: 31 tests passed in five files.
- `vp run check`: passed, including formatting, lint, all workspace type checks, and 453 tests in 93 files.
- `vp run build:desktop`: passed. Existing bundler directive and dependency notices remain.
- `git diff --check`: passed.

Session tests execute the real segment maker, library codec, service handlers, and coordinator against in-memory storage and a mocked project storage boundary. They assert exact selection, result shapes, unchanged revisions on save/failure, field defaults/overrides, missing selections/resources, corrupt library entries, stale revisions, conflict atomicity, copied bytes under committed media IDs, replacement isolation, and undo/redo. CLI tests spawn the real executable against the authenticated HTTP host; a renderer stub captures decoded segment requests. Discovery tests cover profile mismatch, dead/invalid endpoints, explicit/environment/parent selection, snapshot exclusions, and ambiguity.

## Integration

`scripts/cli-foundation.mjs` exports `parseArguments`, `discoverEndpoint`, `verifyProjectOwner`, `commandHelp`, and `segmentText`. It has a declaration file for TypeScript consumers. `scripts/package-desktop.mjs` copies the runtime helper beside the CLI.

When merging the sibling CLI dispatch, call its `prepareProjectCommand` before `parseArguments`. Preserve its native guarded revision handling and text formatter; use `segmentText` for segment results unless `--json`. Preserve `schema --service` for obtaining operation fields. The service schema adds `segmentFields` and `stringMap` kinds for segment fields and values; the CLI handles both.

The existing browser segment fixture now selects all three clips explicitly. Existing desktop adapter scripts request `--json` before parsing segment output. README, roadmap trackers, and `docs/verification/phases-126-130.md` were not edited.

## Limits

Parent owns the combined Electron/browser acceptance, visible editor check, packaging execution, and final build after integration. No new Electron runtime or screenshot is claimed here. The attempted normal dev wrapper required unavailable OpenSSL; a direct Vite+ server started on 4281 and was stopped before handoff.

This remains a host-backed CLI. Closed-project/headless editing is explicitly unsupported, and imported source paths do not select SideCut's managed SQLite project automatically. Choose that running profile's endpoint. macOS/Linux native ownership and installed-package behavior were not run.

Segment folders/resources use virtual library paths backed by SideCut storage; `exists` describes the initialized virtual library. Filesystem folder names, Trash replacement, and CLI text layout are not byte-identical to macOS Tandem. Live Photo companions, missing-LUT recovery, and every native media format are not newly verified. Failed or cancelled insertion can leave unused staged resource bytes, while the project and its undo history remain unchanged. No provider calls, credentials, personal media, paid requests, pushes, or PRs were used.
