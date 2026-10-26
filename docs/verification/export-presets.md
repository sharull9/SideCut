# Export preset follow-up: phase 133

The UI and service exports now share `serviceExportPlan` for format resolution, even-pixel dimensions, preset bitrate and upscaling warnings. This removes the UI's separate rounding rules and silent portrait fallback. A missing portrait format produces an actionable issue and disables Queue. The portrait canvas tolerance also matches the pinned native planner (`0.005`).

WebM exports render the planned full resolution instead of fitting every output inside 1920x1080. The encoder receives the planned video bitrate. Desktop UI WebM downloads keep that encoded output directly, avoiding a second fixed-4-Mbit encode that discarded the preset quality setting. Native MP4/HEVC export remains available through the desktop services.

The dialog shows actual dimensions and upscaling warnings, labels its preset/format selectors, and calls itself “Export video or audio.” Portrait uses the portrait format; WAV ignores visual output formats. Audio-only validation no longer requires a renderable video track or available video fonts/mattes. A sequence with unsupported graphics can still produce its WAV.

The dialog also exports marked timeline ranges. Jobs capture the bounds when queued;
WebM and WAV filenames identify the range. Clearing a selected range disables Queue.
Preflight and source loading cover that span, including overlapping transition handles.
Unrelated missing media and unsupported graphics do not block it. The five-minute
limit applies to the exported range. WAV jobs guard edits and participate in the
same cancellable job system as video. See the [follow-up regressions and quality evidence](continuation-2026-10-25-followup.md).

`tests/desktop/verify-export-presets.mjs` runs the real Electron UI and probes actual downloaded files with FFprobe. [Runtime evidence](export-presets-runtime.json) records:

| Output               | Codec | Frame size | Duration         |
| -------------------- | ----- | ---------- | ---------------- |
| Main WebM            | VP8   | 320x180    | 0.1 s            |
| Review WebM          | VP8   | 1280x720   | 0.1 s            |
| 1080p WebM           | VP8   | 1920x1080  | 0.1 s            |
| Portrait WebM        | VP8   | 1080x1920  | 0.1 s            |
| Square format WebM   | VP8   | 640x640    | 0.1 s            |
| 4K main canvas WebM  | VP8   | 3840x2160  | 0.1 s            |
| Desktop review MP4   | H.264 | 1280x720   | 0.1 s / 3 frames |
| Desktop 1080p MP4    | H.264 | 1920x1080  | 0.1 s / 3 frames |
| Desktop portrait MP4 | H.264 | 1080x1920  | 0.1 s / 3 frames |
| Desktop 4K MP4       | HEVC  | 3840x2160  | 0.1 s / 3 frames |
| Desktop final MP4    | H.264 | 3840x2160  | 0.1 s / 3 frames |

The missing-portrait state disables Queue without crashing the editor. Unsupported video still produces a 48 kHz stereo PCM WAV (19,244 bytes for this 0.1-second silent fixture). The open export dialog passes eighteen automated WCAG checks with zero violations. Unit tests cover native rounding, full-resolution planning, bitrate/upscaling metadata, missing formats, portrait tolerance, and unchanged project settings. Existing queue tests cover serialized jobs, cancellation, retained downloads and failures. Earlier [CLI rendering evidence](cli-render.md) covers nonzero sound, loudness and gain-lane measurements.

Run with the built desktop and web dev server at `127.0.0.1:4270`:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
vp exec --filter @sidecut/desktop electron ../../tests/desktop/verify-export-presets.mjs
```

These preset fixtures use three-frame solids and a half-second marked range.
Separate [hidden-window stress checks](export-stress.md) pass five minutes at
320x180 and thirty seconds at 4K with synthetic content. File sizes do not
establish delivered bitrate or reference visual fidelity. UI downloads remain
WebM/WAV, the queue remains in memory with five-entry/256-MiB limits, and browser
export retains five-minute-range/60-fps/16-million-pixel bounds. Native macOS/Linux
and upstream render/audio golden comparisons remain unverified. The aggregate
phase 133 parity gate stays open for those broader requirements.
