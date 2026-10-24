# Cards, rendering and review verification

Verified on Windows on 2026-10-25 against Tandem revision
`735a9b8e162c1f951044baa892d94993869f2e77`. This batch covers subphases
123.04, 125.02, 125.03, 126.01 and 126.02 within the limits below.

## Cards

The cards adapter reads actual cached transcripts. Insert planning moves a cut
into a nearby pause, snaps to a frame and reuses nearby take edges when that
avoids a sliver. It warns when a transcript or safe pause is unavailable.
Existing cards retain their words and sounds while numbering is updated.

The two pinned section-card asset IDs are resolved only from the local library.
Previews do not copy them or mutate the project. Applying stages their files,
adds media/provenance and inserts cards/sounds in a single host command batch.
Cancellation or stale revision cannot partially commit that batch. Missing
library files produce the reference's silent fallback, without a network call.
Existing available project resources are retained. Sound gains follow the
length-weighted median of normalized speech levels, including imported speech.

The runtime uses two explicitly synthetic local WAV assets under those IDs;
it does not download, generate or claim access to the original proprietary
whooshes. Speech at -28.7 LUFS produces gains of -14.1 and -17 dB. Both sounds
appear in the project through one undo step. Reapplying keeps their sounds.

## Export

Export defaults to the frame's 1080p or 4K class. The four reference presets and
normalized full-name aliases resolve to even pixel sizes and area/frame-rate
scaled bitrates. A short uses the portrait format, or a canvas already at 9:16.
Missing formats fail rather than silently inventing a portrait composition.
SideCut's existing `final` and `webm` options remain available.

The service compositor can render the requested full size. Ordinary UI browser
exports retain their existing size limit. The desktop converts the intermediate
to H.264/AAC or HEVC/AAC using bounded, fixed FFmpeg arguments, with the planned
video bitrate, 320 kbps AAC and Rec.709 tags. HEVC uses the hvc1 tag. Export results
include measured PCM mix loudness and total service elapsed time. Output and
snapshot writes retain exclusive creation, cancellation and rollback behavior.

FFprobe confirms the runtime's one-frame 4K export is HEVC at 3840x2160. The
existing regression run also confirms 1280x720 H.264, VP8 WebM, AAC, a precise
stereo WAV stem and a portrait 1080x1920 export. Pixel assertions still confirm
the blue synthetic image survives rendering and encoding.

## Loudness

Mix measurement reads up to 1.5 seconds around the requested interval, so
centered 400 ms and 3 second windows include surrounding sound. Steps use the
reference's 100 ms block spacing. Integrated loudness still covers the requested
interval. Missing source measurements stay explicit. Clip levels include speech
classification and limiter ceilings. Reported speech loudness follows normalized
speech rather than always returning the project default.

`gains:true` renders each selected audio track with its normal gain lane and with
flat gain. It compares energy ratios in 10 ms blocks against the expected
normalization, gain keyframes and fades. Silence and overlapping segments are
excluded. Results include compared seconds, worst error, delayed-lane alignment
and merged mismatch stretches. The runtime compares 1.7 seconds of a gain ramp:
worst error is 0.034413 dB, no delay and no mismatches at the 1 dB tolerance.
Separate synthetic tests deliberately delay a lane and verify mismatch reports.

## Validate and check

`validate` returns revision, reference `ok`, issues and the retained SideCut
`valid` alias. Warnings do not fail validation. Missing source references and
malformed requests are covered without editing the project.

Quick checks report structural gaps, softness and subframe clips/gaps using the
reference problem kinds and start/end/clip IDs. Rendered checks measure tiles on
every frame to find black output, flat green, short white blocks and flickers.
They preserve range boundaries and intentional fades. Unambiguous flickers can
return a valid, undoable hold-frame command.

`cuts:true` reads mono sound at 32 kHz and measures full-band and twice-filtered
4 kHz high-band RMS in 10 ms blocks. It checks non-through speech edges using
noise/speech thresholds, pause lengths, dip/release rules and nearby pauses.
Suggested ripple trims must fit the source and preserve at least one frame.
Missing sound produces a warning instead of pretending its edges were checked.

`changed:true` checks pending agent edit regions with a half-second margin. Human
edits are excluded; the durable review acknowledgment clears those regions.
Conflicting range/mode fields fail before rendering. Results remain read-only.

Dead-air notes combine transcript words, other sound, music arrivals/swells,
section cards, gaps, picture motion and camera masks. Missing transcripts protect
unknown speech. Page notes use a plain isolated-screen scan, settled frames,
independent scanline bands to reject scrolling, visibility and transitions.
Low-frame-rate notes compare visible motion with the source's encoded packet
timestamps mapped through clip speed. Static low-rate pages do not trigger them.

The actual editor detects a deliberately green frame, cancels an in-progress
scan, finds two still/silent stretches and reports a generated moving source as
5 fps on a 30 fps timeline. Page changes, scrolling, occlusion, held-frame fixes,
missing transcripts and stationary low-frame-rate sources have core fixtures.

## Evidence and reproduction

`vp run check` passes formatting, lint, every TypeScript program and 418 tests in
84 files. New coverage is in `finishing-review.test.ts`, `quality-notes.test.ts`
and the expanded host review/native-media tests. The pinned expected request and
result matrix is `tests/fixtures/tandem/render-review.json`. These are synthetic
contracts derived from inspected Swift source, not captured macOS output.

`vp run build:desktop` passes. The expanded `tests/desktop/verify-service.mjs`
produces the [runtime results](render-review-runtime.json) and
[editor capture](render-review-editor.png). It uses and removes a temporary
profile, local media and synthetic library entries.

To repeat, build the desktop app, start
`vp dev --host 127.0.0.1 --port 4270 --strictPort` from `apps/web`, unset
`ELECTRON_RUN_AS_NODE`, then run
`vp exec --filter @sidecut/desktop electron ../../tests/desktop/verify-service.mjs`
from the repository root. The existing optional `--model` switch also repeats
the earlier uncached Whisper check; this batch did not need another model run.

## Limits

Native macOS/Linux and direct Swift output comparisons remain unverified.
Browser rendering still supports 1-60 fps and timelines up to five minutes;
service export is bounded to 8192 pixels per side and 16 million pixels.
Native inputs and outputs retain the 256 MiB cap.
The software H.264/HEVC path uses a lossy VP8/Opus intermediate and does not claim
VideoToolbox hardware-encoder or pixel/sample identity. Final encoded AAC peaks
can differ from the PCM mix measurement.

Quality checks are bounded to 18000 frames, 8 million pixels per scan image and
40 million retained statistics values. Shorter ranges or smaller scan widths
are required beyond those limits. Source timestamp tables allow one million
entries. Speech-cut analysis requires known-duration audio of at most ten
minutes; it estimates thresholds from the complete decoded source rather than
only the reference's merged two-second edge neighborhoods. Detector messages,
confidence on real footage and threshold agreement need corpus comparisons.
Frame statistics use a 16x9 tile grid; camera masks ignore rotation as the
reference does and use tile centers for occlusion. Cross-decoder numeric identity
and complete effect-heavy gain comparisons are not certified by these fixtures.

The existing build directive, CommonJS preload, route-generator and Electron
safeStorage deprecation warnings remain.
