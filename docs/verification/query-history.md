# Query, history and join verification

Verified on Windows on 2026-10-25 against Tandem revision
`735a9b8e162c1f951044baa892d94993869f2e77`. This batch covers subphases
120.04, 121.05, 121.06, 122.02 and 123.01. It uses the existing host coordinator.

## Behavior

`clips` retains complete listings with `idsOnly` metadata. It accepts track IDs,
names, lane labels and complete display labels. Tests cover top-down video and
then audio order, duplicate media basenames, source IDs and paths, half-open
range boundaries, empty matches and invalid or missing references. Queries do
not change the revision.

`diff` describes movement, ripple trims, slips, playback properties, picture and
sound changes, keyframes and split pieces. It uses the reference 0.5 ms rounding
tolerance. Per-edit records include clip changes and affected times/tracks,
including undo/redo. Revision references accept `r1` and surrounding whitespace.
The durable reviewed revision is also available as `reviewed`. File snapshots
carry descriptive names. They include journal records only when their clips
match the corresponding local revision. Missing, malformed and future baselines
fail explicitly.

`restore` selects baseline clips in a requested range plus clips newly added in
that range. An existing clip moved into the range stays outside that selection.
Same-track clips use merge patches, including timing changes, preserving current
transitions. Missing clips can be inserted without recreating old transitions.
A replaced track can be found by its kind and name. Plans validate on a copy,
report conflicts and apply through the shared coordinator as one undo step.
Stale application fails without committing.

`transcribe` resolves and deduplicates media IDs, clip IDs and paths. It avoids
marking camera sources and sources already on speech tracks. Other sources are
marked once through an undoable host edit. Wait results contain `what`, `done`,
`timedOut`, `elapsed`, `finished` and `pending`. An empty transcript is ready;
a worker failure is finished with a message. A deadline returns pending work
without cancelling it. Cancellation interrupts an owned worker, while the
existing analysis layer keeps shared jobs independent of another waiter's exit.
The host and renderer permit revision changes during transcription while still
rejecting project replacement. Vite prepares Transformers at startup so the
first worker does not trigger dependency optimization and reload the editor.

`join` reads the report from the same core planner that executes the command.
It retains linked pairs in track display order, survivor IDs across consecutive
cuts and all skipped cuts with structured reasons. The command's UI warnings
remain abbreviated. Service previews expose the complete skipped list. Inclusive
point ranges and ranges beyond the timeline are supported. Applying a plan uses
one revision and one undo step.

## Evidence

`vp run check` passes formatting, lint, every TypeScript program and 403 tests in
82 files. The new cases are in `packages/core/src/query-history-join.test.ts`,
`apps/web/src/modules/workspace/service-transcribe.test.ts` and the expanded
`apps/desktop/src/main/service-operations.test.ts`. Existing project-query and
service fixtures remain in `tests/fixtures/tandem`. These are synthetic expected
contracts checked against the pinned Swift source, not outputs captured on macOS.

`vp run build:desktop` passes. The expanded `tests/desktop/verify-service.mjs`
checks the actual Electron HTTP service and renderer. Its
[runtime record](query-history-runtime.json) confirms filtered clip IDs, detailed
diffs, per-edit history, restore/undo, structured join pairs, cached transcription
and a real uncached missing-source failure. It also repeats the existing frame,
audio, video and loudness regression checks.

The additional `--model` run used a fresh temporary profile and distinct audio
bytes with no stored transcript. A zero-second wait returned pending work. The
next wait downloaded and ran `Xenova/whisper-tiny.en` at pinned revision
`79fb389fc764e7c395bd330e9531d9d32ada7049`, producing 16 words in about 53 seconds.
Its [model record](transcribe-model-runtime.json) retains both wait results.
The initial attempt exposed a Vite dependency-optimization reload; the startup
configuration fixed that interruption before the successful run.

To repeat the HTTP checks, build the desktop app, start
`vp dev --host 127.0.0.1 --port 4270 --strictPort` from `apps/web`, unset
`ELECTRON_RUN_AS_NODE`, then run
`vp exec --filter @sidecut/desktop electron ../../tests/desktop/verify-service.mjs`
from the repository root. Add `--model` to download public model files and test
uncached inference. All runtime media/profile data is temporary.

## Limits

Native macOS/Linux and direct Swift-output comparisons remain unverified.
Transcription uses local Whisper rather than Apple's SpeechAnalyzer. The 16-word
result verifies the workflow, not recognition accuracy or cross-engine quality.
The deterministic cancellation tests exercise worker ownership without running
an interrupted network download on every test run.

Baseline files remain restricted to the managed project folder and the same
project ID. Absolute paths, external backups and cross-project restoration are
outside this adapter. Restore does not recreate old transitions or markers;
invalid placement or transition dependencies are reported by dry-run validation.
Older journals without dates retain missing dates. CLI/MCP readable-text parity
and complete history activity events belong to their later adapter subphases.
Existing build directive, route-generator, CommonJS preload and Electron
safeStorage deprecation warnings remain.
