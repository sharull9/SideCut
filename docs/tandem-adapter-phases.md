# Tandem adapter subphases

Status: all pending. These subphases expand the numbered groups in [the parity roadmap](tandem-parity-roadmap.md). They are individual units of work, not parallel assignments.

Each checkbox has exactly two tasks: implement that single adapter or interaction using the existing service, then verify one success and one relevant failure/cancellation/conflict case against the pinned reference. Record the test and runtime beside the checkbox before completing it. Do not add a second edit coordinator.

Service subphases require their underlying feature phase and phase 119. Each CLI or MCP operation requires its matching verified service subphase. Provider subphases require phases 103-107. UI interaction subphases require the corresponding implemented core command.

## Group 108: Provider adapters

Acceptance per provider: preserve source IDs, attribution, setup status, and normalized resources. Use recorded/mock network responses for ordinary checks. Real credentials or paid generation require opt-in tests. The two upstream stubs only need truthful unavailable status, not new provider implementations.

- [ ] 108.01: Shared library.
- [ ] 108.02: Import folders.
- [ ] 108.03: Pixabay.
- [ ] 108.04: Pexels.
- [ ] 108.05: Freesound.
- [ ] 108.06: Iconify.
- [ ] 108.07: SVGL.
- [ ] 108.08: Noto Emoji.
- [ ] 108.09: Fontsource.
- [ ] 108.10: ElevenLabs.
- [ ] 108.11: Epidemic Sound stub status.
- [ ] 108.12: Lordicon stub status.

## Group 120: Project queries

Acceptance per operation: compare request defaults, result shape, revision, warnings, and a failure with a pinned contract fixture. Mutations also need atomicity and undo coverage; streams need close/cancellation coverage.

- [ ] 120.01: status.
- [ ] 120.02: timeline.
- [ ] 120.03: media.
- [ ] 120.04: clips.

## Group 121: Edits and history

Acceptance per operation: compare request defaults, result shape, revision, warnings, and a failure with a pinned contract fixture. Mutations also need atomicity and undo coverage; streams need close/cancellation coverage.

- [ ] 121.01: apply.
- [ ] 121.02: undo.
- [ ] 121.03: redo.
- [ ] 121.04: history.
- [ ] 121.05: diff.
- [ ] 121.06: restore.

## Group 122: Speech

Acceptance per operation: compare request defaults, result shape, revision, warnings, and a failure with a pinned contract fixture. Mutations also need atomicity and undo coverage; streams need close/cancellation coverage.

- [ ] 122.01: transcript.
- [ ] 122.02: transcribe.
- [ ] 122.03: search.
- [ ] 122.04: pauses.
- [ ] 122.05: tighten.

## Group 123: Helpers

Acceptance per operation: compare request defaults, result shape, revision, warnings, and a failure with a pinned contract fixture. Mutations also need atomicity and undo coverage; streams need close/cancellation coverage.

- [ ] 123.01: join.
- [ ] 123.02: captions.
- [ ] 123.03: short.
- [ ] 123.04: cards.

## Group 124: Frame inspection

Acceptance per operation: compare request defaults, result shape, revision, warnings, and a failure with a pinned contract fixture. Mutations also need atomicity and undo coverage; streams need close/cancellation coverage.

- [ ] 124.01: frame.
- [ ] 124.02: frames.
- [ ] 124.03: screenshot.

## Group 125: Rendering

Acceptance per operation: compare request defaults, result shape, revision, warnings, and a failure with a pinned contract fixture. Mutations also need atomicity and undo coverage; streams need close/cancellation coverage.

- [ ] 125.01: clip.
- [ ] 125.02: export.
- [ ] 125.03: loudness.

## Group 126: Review

Acceptance per operation: compare request defaults, result shape, revision, warnings, and a failure with a pinned contract fixture. Mutations also need atomicity and undo coverage; streams need close/cancellation coverage.

- [ ] 126.01: validate.
- [ ] 126.02: check.
- [ ] 126.03: comments.

## Group 127: Jobs and streams

Acceptance per operation: compare request defaults, result shape, revision, warnings, and a failure with a pinned contract fixture. Mutations also need atomicity and undo coverage; streams need close/cancellation coverage.

- [ ] 127.01: sync.
- [ ] 127.02: watch.
- [ ] 127.03: wait.

## Group 128: Resources

Acceptance per operation: compare request defaults, result shape, revision, warnings, and a failure with a pinned contract fixture. Mutations also need atomicity and undo coverage; streams need close/cancellation coverage.

- [ ] 128.01: archive.
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

- [ ] 134.01: Shortcut dispatch and input focus.
- [ ] 134.02: Keymap selection.
- [ ] 134.03: Context menus.
- [ ] 134.04: Copy and paste with ID remapping.
- [ ] 134.05: Timeline range selection.
- [ ] 134.06: Marquee selection.
- [ ] 134.07: Snapping modifiers.
- [ ] 134.08: Track height resize.
- [ ] 134.09: Timeline scroll and zoom.
- [ ] 134.10: Drag autoscroll.
- [ ] 134.11: Keyboard clip navigation.
- [ ] 134.12: Keyboard trim and move.
