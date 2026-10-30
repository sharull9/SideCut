# LV019 recent clips and source recovery

Implemented on 2026-10-30 under the approved Lawn/Videorc phase plan. LV019 remains in progress because studio controls and native integration are outstanding.

## Buffer and saved clips

`@sidecut/core/recent-clips` retains complete segments within 60 seconds, 64 MiB and 120 entries. It evicts the oldest segments when a limit is exceeded. A 30-second or 60-second snapshot selects complete segments inside that window. It validates monotonic segment bounds, byte counts and marker data. It retains up to 500 markers, including clip-start and clip-end marks, and returns their times relative to the selected clip.

`@sidecut/platform-browser/recent-clips` records a selected live video track and an optional, explicitly selected audio track. Audio may come from a separate stream, including the LV018 mix. The recorder uses owned clones and leaves borrowed source tracks running. Arming does not request device permissions, write to disk or start the main recording.

The browser recorder closes each five-second segment and starts another. Each segment has its own container header and keyframe. Saving closes the current segment, immediately starts its replacement, then remuxes the selected segments into one VP8/Opus WebM `File` through Mediabunny. It preserves recorder-relative audio/video offsets and the wall-clock offsets between segments. It does not concatenate arbitrary MediaRecorder fragments. The save result includes the selected start/end times and relative marks. Marks are returned as metadata, not embedded into the WebM.

The retained encoded buffer and active segment share a 64 MiB acceptance limit. Exceeding that limit stops buffering with an explicit failure. One save may run at a time. A save pins a bounded snapshot while capture continues, so peak application memory also includes that snapshot, the output buffer and muxer/container overhead. Browser encoder allocations and a single delivered MediaRecorder event are outside the retained-byte accounting.

## Source recovery

Each arm creates a fresh run and failure state. Source callbacks check their run identity. Stopping or failing removes listeners, stops owned clones and preserves previously completed segments for saving. A new arm starts an empty buffer. Source-ended events stop the buffer, and a 250 ms check detects borrowed tracks whose `stop()` call changes `readyState` without an event. Separate-source configuration does not require audio on the video stream.

Cancellation before or during remux rejects the save and leaves the buffer available. A successful save keeps buffering. The caller owns the returned file and decides whether to download it or import it into an editor project.

## Recorded checks

Three core tests cover 30/60-second retention over 500 seconds of simulated segments, byte eviction, invalid and overlapping bounds, oversized segments, marker retention, relative times and snapshot mutation isolation.

`vp run verify:recent-clips` runs the actual browser module through Vite with Chromium, synthetic canvas video and a separately supplied Web Audio tone. It records across multiple real five-second segments, saves a clip, decodes it, and checks the early red and later green picture samples. Decoded audio has nonzero signal on both sides of the segment boundaries, and its duration agrees with the recorded wall-clock span within 0.5 seconds. It also checks retained marks, continued capture after save, video-only save, borrowed-track ownership, source failure, rearm, stale events from an old audio source, aborted save and tracks stopped without an event.

The generated [JSON evidence](lawn-videorc-recent-clips.json) records the measured duration, decoded pixels, audio levels and browser version. The [WebM fixture](lawn-videorc-recent-clips.webm) retains the actual saved clip. This is a development-module check with synthetic sources, not production UI or physical-device acceptance. The browser check uses an approximately eleven-second recording; full-window eviction is covered by the core tests.

Final validation passed `vp run check`, including formatting, lint, all workspace typechecks and 658 tests across 140 files. `vp run build:cloudflare` passed. The local logs are `logs/lv019-check.log` and `logs/lv019-build.log`.

## Remaining limits

Five-second segments make the selected window up to one segment shorter than requested. Recorder restart gaps remain possible; preserving timestamps does not fill those gaps. Hidden-tab suspension can delay timers and shorten the retained window. The output is not sample-accurate or gapless native replay. A stopped renderer loses this buffer because it is intentionally memory-only.

Studio buttons, marker controls, editor import, durable clip metadata, native FFmpeg replay, physical source-loss testing, sustained resource measurements and production browser acceptance remain open. No external stream or physical device was used.
