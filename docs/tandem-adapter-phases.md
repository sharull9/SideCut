# Tandem adapter subphases

Status: group 108 is verified. Group 118 has verified subphases 118.01–118.09 within the recorded import/rendering limits. Group 120 has verified status/timeline/media subphases 120.01–120.03; clips acceptance remains pending. Groups 121-125 have all 21 HTTP adapters. Groups 126-130 now have 20 baseline adapters and a host-backed CLI, with remaining acceptance listed in [the verification report](verification/phases-126-130.md). Groups 131-135 have baseline MCP/client, export-queue, interaction and compact-layout coverage; see [their verification report](verification/phases-131-135.md). Final browser/delivery/inventory work is recorded in [phases 136-140](verification/phases-136-140.md); native macOS/Linux and full parity gates remain open. These subphases expand the numbered groups in [the parity roadmap](tandem-parity-roadmap.md). They are individual units of work, not parallel assignments.

Each checkbox has exactly two tasks: implement that single adapter or interaction using the existing service, then verify one success and one relevant failure/cancellation/conflict case against the pinned reference. Record the test and runtime beside the checkbox before completing it. Do not add a second edit coordinator.

Service subphases require their underlying feature phase and phase 119. Each CLI or MCP operation requires its matching verified service subphase. Provider subphases require phases 103-107. UI interaction subphases require the corresponding implemented core command.

## Group 108: Provider adapters

Acceptance per provider: preserve source IDs, attribution, setup status, and normalized resources. Use recorded/mock network responses for ordinary checks. Real credentials or paid generation require opt-in tests. The two upstream stubs only need truthful unavailable status, not new provider implementations.

- [x] 108.01: Shared library.
- [x] 108.02: Import folders.
- [x] 108.03: Pixabay.
- [x] 108.04: Pexels.
- [x] 108.05: Freesound.
- [x] 108.06: Iconify.
- [x] 108.07: SVGL.
- [x] 108.08: Noto Emoji.
- [x] 108.09: Fontsource.
- [x] 108.10: ElevenLabs.
- [x] 108.11: Epidemic Sound stub status.
- [x] 108.12: Lordicon stub status.

Each adapter passed its separate test suite on 2026-10-24. Test files are `packages/assets/src/{provider,import-folders,pixabay,pexels,freesound,iconify,svgl,noto,fontsource,elevenlabs,epidemic,lordicon}.test.ts`, in checkbox order. They cover successful mapping and relevant failures or unavailable status. Browser runtime additionally verifies shared folder import, Iconify normalization and mock ElevenLabs result storage. See [verification and limits](verification/phases-106-110.md). Live paid generation acceptance remains pending.

## Group 118: Filmora mapping follow-ups

The WFP importer now reads ZIPs and selected folders, with the five mapping
families below verified in Chromium, Firefox and Windows Electron. Reports retain
unsupported and missing-source information. See the [original container evidence](verification/phases-116-120.md)
and [118.03–118.07 verification and limits](verification/filmora-118-03-07.md).

- [x] 118.01: Safe zipped WFP container decoding.
- [x] 118.02: Basic media clips, inclusive ticks and uniform speed.
- [x] 118.03: Unpacked folders and extra.json markers. Core folder/marker cases, host path/cancellation checks and editor directory selection pass.
- [x] 118.04: Source classification, track naming, linked picture/sound and overlap lanes. Core naming/link/lane cases and runtime timeline/save checks pass.
- [x] 118.05: Transforms, opacity, crop, cutout and keyframes. Core source-clock/interpolation/crop cases and runtime field preservation pass; model and pixel fidelity remain separate acceptance.
- [x] 118.06: Colour, shadow, border and shared media looks. Core shared/differing grades, LUT metadata and unsupported effects pass; runtime round trips retain looks and clip effects.
- [x] 118.07: Audio gain, normalization and fades. Core levels/fades/failure cases, CLI keep-levels and runtime save/reload pass; imported mix metering remains unverified.
- [x] 118.08: Transition mapping and approximation reports. Core type/direction, edge/cut, handle-fit, malformed input and approximation cases pass; runtime imports retain the cut transition across reload.
- [x] 118.09: Titles and nested template timelines. Core title styling/animation, visible windows, transforms, recursion bounds and sound deduplication pass; Chromium/Firefox/Electron imports retain nested layers and sound. Unsupported rendering settings emit warnings.

See [118.08–120.03 evidence and limits](verification/filmora-queries.md). These
checks follow the pinned Swift rules using synthetic fixtures; native reference
render/audio comparisons remain separate acceptance.

## Group 120: Project queries

Acceptance per operation: compare request defaults, result shape, revision, warnings, and a failure with a pinned contract fixture. Mutations also need atomicity and undo coverage; streams need close/cancellation coverage.

- [x] 120.01: status. Shared revision/save state, owner, live renderer jobs/exports, font warnings and durable agent reviews pass host and HTTP runtime checks; stale/malformed renderer snapshots reject.
- [x] 120.02: timeline. Reference text/summary structure, settings, transitions, words, range JSON and malformed requests pass core and HTTP runtime checks without changing project revision.
- [x] 120.03: media. Real renderer resource/cache/job states and host metadata are merged at a checked revision. Existing atomic refresh/undo/failure tests pass; HTTP runtime sees copied audio, cached words and loudness.
- [x] 120.04: clips. Track display order, IDs/names/full labels, media aliases, half-open ranges, empty results and malformed/missing references pass core tests and live Electron HTTP checks.

The original query fixtures and HTTP refresh/undo checks remain in
`project-queries.test.ts` and `http-service.test.ts`. `timeline-dump.test.ts`,
`query-state.test.ts` and `verify-finishing.mjs` extend acceptance for the first
three queries. See [current evidence and compatibility limits](verification/filmora-queries.md).
The [query/history follow-up report](verification/query-history.md) records clips and the next four service subphases. Cross-platform reference output comparisons are not implied by these Windows checks.

## Group 121: Edits and history

Acceptance per operation: compare request defaults, result shape, revision, warnings, and a failure with a pinned contract fixture. Mutations also need atomicity and undo coverage; streams need close/cancellation coverage.

- [x] 121.01: apply.
- [x] 121.02: undo.
- [x] 121.03: redo.
- [x] 121.04: history.
- [x] 121.05: diff. Shift/trim/property/cut descriptions, per-edit records and places, revision aliases, reviewed baselines and snapshot comparisons pass core/host and Electron HTTP checks.
- [x] 121.06: restore. Baseline-range selection, same-track patches, transition preservation, replacement-track lookup, dry-run validation and stale apply/undo pass core/host and Electron HTTP checks.

## Group 122: Speech

Acceptance per operation: compare request defaults, result shape, revision, warnings, and a failure with a pinned contract fixture. Mutations also need atomicity and undo coverage; streams need close/cancellation coverage.

- [x] 122.01: transcript.
- [x] 122.02: transcribe. Shared marking, media resolution, cached/uncached results, finished/pending wait fields, deadline and cancellation cases pass. Windows Electron downloaded the pinned local model and produced 16 words after a zero-second wait returned pending work.
- [x] 122.03: search.
- [x] 122.04: pauses.
- [x] 122.05: tighten.

## Group 123: Helpers

Acceptance per operation: compare request defaults, result shape, revision, warnings, and a failure with a pinned contract fixture. Mutations also need atomicity and undo coverage; streams need close/cancellation coverage.

- [x] 123.01: join. Core planner reports linked pairs, chained survivor IDs and every skipped cut with a reason. Inclusive point ranges, preview/apply/undo and failures pass core/host and Electron HTTP checks.
- [x] 123.02: captions.
- [x] 123.03: short.
- [x] 123.04: cards. Speech-aware insertion, existing-card text, optional local whooshes, speech-relative sound levels, provenance and atomic apply/undo pass core and Electron HTTP checks. Silent fallback performs no download.

## Group 124: Frame inspection

Acceptance per operation: compare request defaults, result shape, revision, warnings, and a failure with a pinned contract fixture. Mutations also need atomicity and undo coverage; streams need close/cancellation coverage.

- [x] 124.01: frame.
- [x] 124.02: frames.
- [x] 124.03: screenshot.

## Group 125: Rendering

Acceptance per operation: compare request defaults, result shape, revision, warnings, and a failure with a pinned contract fixture. Mutations also need atomicity and undo coverage; streams need close/cancellation coverage.

- [x] 125.01: clip.
- [x] 125.02: export. Reference default/preset aliases, even sizing, area/frame-rate bitrate planning, 4K HEVC, Rec.709 tags, output metrics and safe sidecars pass core/native and live Electron checks within the recorded browser bounds.
- [x] 125.03: loudness. Centered mix windows, source/missing states, speech levels, limiter metadata and gain-lane comparisons pass fixtures and actual audio rendering. The runtime gain ramp stays within 0.035 dB of its lane.

Implementation/acceptance evidence for all 21 operations is recorded in [phases 121-125](verification/phases-121-125.md). `service-operations.json` pins success and malformed request shapes; core/host tests cover shared revisions, history, dry runs and atomic failures. `verify-service.mjs` exercises every operation over actual HTTP, including helper apply/undo, frame dimensions, an actual UI screenshot, H.264/AAC/WAV/WebM outputs and source/mix loudness. Checked items have that baseline acceptance. The [query/history follow-up report](verification/query-history.md) supersedes the diff/restore, transcription and join gaps in the original report. The [render/review follow-up](verification/render-review.md) supersedes the card sounds/section cuts, export-preset and gain-verification gaps. Native reference comparisons and the documented bounds remain open.

## Group 126: Review

Groups 126–130 have baseline implementation coverage. Unchecked items retain
full compatibility acceptance; the [verification report](verification/phases-126-130.md)
records the supported behavior and the gaps, including comment context, event replay,
native resource semantics and exact CLI/MCP spelling. The [render/review follow-up](verification/render-review.md) supersedes its original quick-scan limits.

Acceptance per operation: compare request defaults, result shape, revision, warnings, and a failure with a pinned contract fixture. Mutations also need atomicity and undo coverage; streams need close/cancellation coverage.

- [x] 126.01: validate. Reference ok/revision/issues fields, error/warning behavior, malformed inputs and read-only host results pass core/HTTP checks. The existing valid alias is retained.
- [x] 126.02: check. Model checks, composite frame scans, speech cuts, pending-agent ranges, hold fixes, dead air, isolated-screen page changes and source-frame-rate notes pass core and Windows Electron checks. Cancellation, memory bounds and known detector differences are recorded in the render/review report.
- [x] 126.03: comments. Four-second cached speech context, comment boundary, top-first clip context and read-only listing pass core/HTTP checks. Shared resolution and watch activity are verified in Electron.

## Group 127: Jobs and streams

Acceptance per operation: compare request defaults, result shape, revision, warnings, and a failure with a pinned contract fixture. Mutations also need atomicity and undo coverage; streams need close/cancellation coverage.

- [x] 127.01: sync. Picture-delay defaults, correction exclusions, signed delays and sound-based take/placement plans pass tests. Electron recovers a 250 ms offset and verifies dry-run/apply/undo and stale failure within the 60-second source limit.
- [x] 127.02: watch. Revision replay of edit/undo/redo/reload events, labels/authors, generation/resync behavior, timeout and cancellation pass host and Electron checks. SSE progress streaming remains separate.
- [x] 127.03: wait. Per-media analysis selection/scheduling, cached/failure/pending states, zero/24-hour deadlines and waiter-only cancellation pass tests. Electron observes cached speech and an API export through completion.

See [comments/jobs/archive evidence and limits](verification/jobs-archive.md) for
these checked adapters and the following archive subphase.

## Group 128: Resources

Acceptance per operation: compare request defaults, result shape, revision, warnings, and a failure with a pinned contract fixture. Mutations also need atomicity and undo coverage; streams need close/cancellation coverage.

- [x] 128.01: archive. Folder dry runs, standalone copies, registered resources/caches, missing-media reports, safe publication, consolidation through one edit and undo pass core/host and Electron checks. Native folder collection differences are recorded in the follow-up report.
- [ ] 128.02: relink.
- [ ] 128.03: effects.

## Group 129: Assets and segments

Acceptance per operation: compare request defaults, result shape, revision, warnings, and a failure with a pinned contract fixture. Mutations also need atomicity and undo coverage; streams need close/cancellation coverage.

- [ ] 129.01: providers.
- [ ] 129.02: search.
- [ ] 129.03: fetch.
- [ ] 129.04: show.
- [ ] 129.05: use.
- [ ] 129.06: credits.
- [ ] 129.07: generate.
- [ ] 129.08: install-starter.
- [ ] 129.09: segments.
- [ ] 129.10: save-segment.
- [ ] 129.11: insert-segment.

## Group 130: CLI

Acceptance per command: match flags/defaults, JSON and text output, exit code, and failure behavior. Mutation commands must be visible immediately in the editor. Match the upstream CLI spelling rather than assuming every service name is its command spelling.

- [ ] 130.01: Argument parser and help.
- [ ] 130.02: Project discovery.
- [ ] 130.03: New project.
- [ ] 130.04: Open application.
- [ ] 130.05: Command schema output.
- [ ] 130.06: EDL import command.
- [ ] 130.07: Filmora import command.
- [ ] 130.08: Project command status.
- [ ] 130.09: Project command media.
- [ ] 130.10: Project command timeline.
- [ ] 130.11: Project command transcript.
- [ ] 130.12: Project command search.
- [ ] 130.13: Project command pauses.
- [ ] 130.14: Project command tighten.
- [ ] 130.15: Project command join.
- [ ] 130.16: Project command captions.
- [ ] 130.17: Project command short.
- [ ] 130.18: Project command cards.
- [ ] 130.19: Project command apply.
- [ ] 130.20: Project command undo.
- [ ] 130.21: Project command redo.
- [ ] 130.22: Project command history.
- [ ] 130.23: Project command validate.
- [ ] 130.24: Project command frame.
- [ ] 130.25: Project command frames.
- [ ] 130.26: Project command screenshot.
- [ ] 130.27: Project command clip.
- [ ] 130.28: Project command export.
- [ ] 130.29: Project command loudness.
- [ ] 130.30: Project command watch.
- [ ] 130.31: Project command effects.
- [ ] 130.32: Project command archive.
- [ ] 130.33: Project command relink.
- [ ] 130.34: Project command check.
- [ ] 130.35: Project command comments.
- [ ] 130.36: Project command sync.
- [ ] 130.37: Project command wait.
- [ ] 130.38: Project command transcribe.
- [ ] 130.39: Project command diff.
- [ ] 130.40: Project command restore.
- [ ] 130.41: Project command clips.
- [ ] 130.42: Library command providers.
- [ ] 130.43: Library command search.
- [ ] 130.44: Library command fetch.
- [ ] 130.45: Library command show.
- [ ] 130.46: Library command use.
- [ ] 130.47: Library command credits.
- [ ] 130.48: Library command generate.
- [ ] 130.49: Library command install-starter.
- [ ] 130.50: Library command segments.
- [ ] 130.51: Library command save-segment.
- [ ] 130.52: Library command insert-segment.
- [ ] 130.53: Compatibility launcher and collision handling.

## Group 131: MCP

All 43 tool names now have baseline stdio adapters generated from the host field
schemas. A real MCP SDK client verifies discovery, edits/undo, errors and a frame
against the running editor. Full tool-by-tool upstream input/result acceptance
remains open; see [phases 131–135](verification/phases-131-135.md).

Acceptance per tool: match the reference input schema and text/image/error result blocks through an actual MCP client. Mutations must use the same revisions and undo history as the UI. Read-only tools must not mutate the project.

- [ ] 131.01: status.
- [ ] 131.02: timeline.
- [ ] 131.03: media.
- [ ] 131.04: transcript.
- [ ] 131.05: transcribe.
- [ ] 131.06: search.
- [ ] 131.07: pauses.
- [ ] 131.08: tighten.
- [ ] 131.09: join.
- [ ] 131.10: captions.
- [ ] 131.11: short.
- [ ] 131.12: cards.
- [ ] 131.13: apply.
- [ ] 131.14: undo.
- [ ] 131.15: redo.
- [ ] 131.16: history.
- [ ] 131.17: diff.
- [ ] 131.18: restore.
- [ ] 131.19: clips.
- [ ] 131.20: validate.
- [ ] 131.21: check.
- [ ] 131.22: sync.
- [ ] 131.23: comments.
- [ ] 131.24: frame.
- [ ] 131.25: frames.
- [ ] 131.26: screenshot.
- [ ] 131.27: clip.
- [ ] 131.28: export.
- [ ] 131.29: archive.
- [ ] 131.30: relink.
- [ ] 131.31: loudness.
- [ ] 131.32: watch.
- [ ] 131.33: wait.
- [ ] 131.34: assets_search.
- [ ] 131.35: assets_use.
- [ ] 131.36: assets_show.
- [ ] 131.37: assets_credits.
- [ ] 131.38: assets_generate.
- [ ] 131.39: segments_list.
- [ ] 131.40: segments_save.
- [ ] 131.41: segments_insert.
- [ ] 131.42: assets_providers.
- [ ] 131.43: effects.

## Group 134: Interactions

Acceptance per interaction: exercise it in the running editor with keyboard or pointer input, confirm the resulting project/selection/focus, and verify cancellation or an input-focus boundary.

- [x] 134.01: Shortcut dispatch and input focus. Baseline subset verified with real keyboard events and input-focus protection.
- [ ] 134.02: Keymap selection.
- [ ] 134.03: Context menus.
- [ ] 134.04: Copy and paste with ID remapping.
- [x] 134.05: Timeline range selection. Shift-drag and I/O use the shared range controls.
- [ ] 134.06: Marquee selection.
- [ ] 134.07: Snapping modifiers.
- [x] 134.08: Track height resize. Pointer/keyboard separator reuses the existing accessible resize control.
- [ ] 134.09: Timeline scroll and zoom.
- [ ] 134.10: Drag autoscroll.
- [ ] 134.11: Keyboard clip navigation.
- [ ] 134.12: Keyboard trim and move.
