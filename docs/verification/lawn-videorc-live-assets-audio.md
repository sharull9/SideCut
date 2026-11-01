# LV017–LV018 verification

Implemented on 2026-10-30 as the next two phases of the approved plan. Both remain in progress: this slice extends the reusable scene renderer and adds a real browser audio mixer; studio controls and native capture integration are still outstanding.

## LV017 — Live assets

`@sidecut/core/live-assets` validates saved background looks/motion and up to 20 uniquely named overlays. `withLiveAssets` stores these settings inside the editor project snapshot; saving/switching/restoring a `LiveStudio` retains them with the scene revision. Invalid colors, nonfinite settings, duplicate IDs, oversized text and out-of-bounds normalized overlay rectangles fail validation.

The SideCut-owned procedural background styles are waves, grid, orbits, rings, particles, rays, stripes, checker, aurora and mesh, plus a static solid color. They depend on frame time and saved speed/colors, with no random state, timers, remote media or third-party artwork. They are functional equivalents, not copies of upstream assets. Saved motion can be disabled; the renderer also freezes decorative motion when `prefers-reduced-motion` is active.

Backgrounds render beneath editor picture layers through an optional background callback on the existing compositor. Existing editor/export callers retain their default black background. Banners, takeovers and highlights render above picture layers in explicit back-to-front array order. They support saved colors/opacity, normalized bounds, scheduled visibility, clipped text and optional slide/pulse motion. A takeover covers the output; a highlight draws a border. Text uses the browser's sans-serif rather than claiming installed-font identity.

The entire composition is painted offscreen before the LV016 publication guard copies it to the one preview/record canvas. Asset updates become active only through a scene save/switch, and a superseded render is discarded. There is no separate preview-only asset pass.

Core tests verify the ten-style inventory, persistence/order and validation. The real Chromium harness hashes every animated style at two timestamps, verifies that all ten change, and verifies identical frames for reduced motion. Reordering overlapping takeovers changes the top pixel. A real VP8/Opus recording contains the timed takeover, and the video is decoded to identify its appearance.

Still open: studio asset controls, preset browsing, richer static-image/asset-library selection, font/platform comparisons, native compositor integration, sustained-load and production-UI acceptance. No claim of complete visual equivalence to upstream styles is made.

## LV018 — Live audio

`@sidecut/core/live-audio` validates gain from −96 to +12 dB, mute/monitor flags, zero to 2,000 ms input delay, and off/rumble cleanup. Negative offsets are rejected: a live delay cannot advance audio; video delay/native clock alignment is separate work. `liveMeter` reports peak/RMS, dBFS and clipping.

`@sidecut/platform-browser/live-audio` provides:

- A Web Audio input graph with gain/mute, sync delay, 80 Hz rumble cleanup and independent monitor routing. Cleanup reuses the existing voice-cleanup high-pass frequency and Butterworth Q; it does not claim neural isolation, noise gating or equivalence to the offline DSP chain.
- Post-fader metering of left/right separately, reporting the larger peak/RMS so opposite-polarity stereo does not cancel the displayed meter. These are sample peaks, not true peaks or integrated loudness. Surround inputs are outside this initial mono/stereo scope.
- A mixed `MediaStreamAudioDestinationNode` output and monitoring off by default. Gain/mute changes use a 5 ms exponential smoothing constant. The mix has no master limiter; multiple inputs can clip and callers must observe levels.
- Up to 32 distinct inputs. Device streams must have exactly one selected live audio track. Device-ended events detach that channel. Removal disconnects owned graph edges without stopping caller-owned input tracks.
- Soundboard playback from supplied decoded `AudioBuffer` assets, bounded to 30 seconds/32 MiB per clip and scheduling within ten seconds. Natural completion, explicit stop and mixer close release owned graph nodes. The caller supplies asset lookup/decoding and owns the `AudioContext` lifecycle.

`LiveStudioOutput.recordingStream(mixer.stream)` attaches a clone of the mixed audio track to the canvas video stream before starting a recorder. Closing the studio output stops its clones; the original mix and device tracks remain owned by their callers. The mixer does not request devices or resume an audio context implicitly; callers must start it through a user action and keep rendering video frames after recorder start.

The Chromium harness exercises actual `OfflineAudioContext`, `AudioContext`, input loopback, meters, canvas recording, `MediaRecorder`, audio decode and video seek/decode. It verifies unity/−6 dB gain, mute, a 100 ms impulse delay at exactly 4,800 samples/48 kHz, strong attenuation of a 20 Hz rumble fixture, separate monitor outputs, live gain/mute updates, rejected negative delay without state mutation, retained borrowed tracks, stereo anti-phase metering, soundboard delivery and owned-track cleanup.

For A/V evidence, a scheduled takeover and soundboard cue share an audio-context-driven frame clock, with 100 ms audio delay configured. The recording is decoded and the first green video sample is compared with the audio onset. The harness uses 25 ms video sampling and allows 150 ms error around the configured delay; this is a synthetic scheduling/encoding check, not a device calibration threshold. The latest measured values and runtime are in [the evidence JSON](lawn-videorc-assets-audio.json); the actual [VP8/Opus recording](lawn-videorc-assets-audio.webm) is retained. A muted active clock source keeps the synthetic audio fixture running before the cue.

Still open: audio controls and device selection UI, soundboard-library wiring, physical microphone/speaker loopback, feedback/echo behavior, device latency compensation, signed/negative A/V offset handling, true-peak protection, neural cleanup, native FFmpeg routing, streaming and sustained device acceptance. No physical devices or external streams were used.

## Reproduce

Run `vp run verify:live-assets-audio` for the real Chromium development-module harness. It writes the JSON and WebM evidence. The fixture imports the actual workspace modules through Vite; it is not a production build/browser-UI acceptance run. Generated JSON may need `vp fmt docs/verification/lawn-videorc-assets-audio.json` before the format gate. Run `vp run check` and `vp run build:cloudflare` for repository validation.

Final validation: `vp run check` passed formatting, lint, all workspace typechecks and 655 tests across 139 files. `vp run build:cloudflare` passed. The real Chromium assets/audio harness passed after the stereo meter update, including a stereo signal whose channels have opposite polarity. Local logs are `logs/lv017-lv018-check.log` and `logs/lv017-lv018-build.log`. The harness evidence is synthetic; both phases retain the outstanding acceptance work listed above.
