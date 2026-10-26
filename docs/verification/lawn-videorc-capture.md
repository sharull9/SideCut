# Browser recording into SideCut

Verified on 2026-10-26 on Windows with production Chromium 156.0.8078.4. This implements LV001/LV002 of the [integration phases](../lawn-videorc-phases.md). LV003 platform acceptance is in progress.

## Implemented behavior

Project media has a **Record** section. Choose screen/window, camera or microphone, optionally include microphone with picture, then start. Screen selection is requested in the Start click before awaiting disk access. Capture requests no system audio. Desktop capture remains disabled because the Electron host still denies device permissions.

MediaRecorder writes ordered chunks to an owned file in OPFS. The controller limits capture to a five-minute timer, 128 MiB total and 8 MiB of queued writes. Overflow, disk-write errors and recorder failure stop capture and discard the incomplete output. Stop/source-ended waits for the final data event and queued writes before closing the file. A ten-second recorder-stop watchdog rejects incomplete output. Browser scheduling can delay timers; these are bounded short-recording controls, not a sustained native recording engine.

The editor session owns capture independently of side-panel mounting. Switching Media to Comments and back preserves the recording/result. The project that started capture remains its import destination. Project replacement or loss of write ownership stops capture; a completed file remains downloadable and cannot be added to a replacement project. A cancelled permission request releases any stream granted later and cannot change a newer recording.

Finished recordings remain available for download, import or explicit discard. Import reuses the existing media probing, resource store, command coordinator and save queue. A failed project save preserves the finished file. Retrying saves the pending revision before deduplicating/retrying import. Imported sources use normal placement, undo and reload behavior. Closing the session releases tracks and schedules staging cleanup. Unimported captures are not a durable recording library.

## Checks

- `vp run check` passes formatting, lint, workspace TypeScript and **552 tests in 116 files**.
- `vp run build:desktop` passes the production browser and Electron builds. Existing dependency-directive/circular-dependency and CommonJS preload build warnings remain.
- `vp run verify:recording` passes a production loopback journey using Chromium's synthetic camera/microphone and a canvas-backed synthetic display stream. It uses the real MediaRecorder, OPFS, SQLite, project import and timeline placement paths. FFprobe reads actual encoded packets from downloaded files.
- `git diff --check` passes.

The [runtime evidence](lawn-videorc-capture-runtime.json) records these artifacts:

| Source                 | Encoded tracks | Dimensions | Packet counts      |
| ---------------------- | -------------- | ---------- | ------------------ |
| Camera with microphone | VP8 and Opus   | 640×480    | 42 video, 36 audio |
| Microphone             | Opus           | Audio only | 34 audio           |
| Synthetic display      | VP8            | 320×180    | 60 video           |

The browser journey verifies read-only start blocking, recording across panel switches, source-ended finalization, download, import, placement and persistence after reload. The reopened timeline exports a 193,158-byte WebM with actual VP8 and Opus packets. It verifies cancellation adds no media, a replacement project cannot import the prior recording, permission errors return a retryable state, and completed/discarded staging files are removed. No page errors were recorded.

Twelve controller tests cover ordered final chunks, source-ended stop, late permission cancellation, secondary microphone denial, storage-open/write failure, queued-write bounds, cancellation, the duration timer, stale request isolation, unsupported context and cancellation during finalization. Four session tests cover project binding/replacement, write ownership before permission, retained output and deduplicated retry after a failed save, and stale-project import refusal. Existing media/persistence tests remain in the full gate.

## Reproduction

```powershell
vp install
vp run check
vp run build:desktop
vp run verify:recording
```

The recording script serves the built browser files on an ephemeral loopback port and closes its browser/server afterward. Encoded fixture files use an owned temporary directory and are deleted after probing. Only JSON metadata is retained as evidence.

## Remaining acceptance

- Real camera/microphone hardware, actual screen/window picker permission and display-share cancellation have not been exercised. Synthetic streams prove encoding/import integration, not OS capture behavior or A/V drift on real devices.
- Capture runtime verification covers Chromium only. Firefox/Safari, storage pressure, hidden-tab throttling and accepted-navigation cleanup need separate evidence.
- Reload/quit warns about active or retained output. Session-close cleanup is best effort during document teardown. Crash-resumable partial files and recovery of orphaned staging files are not implemented; they belong to LV004.
- Five-minute real-device recording, native capture, long-form files, system audio, live preview/countdown, scenes, streaming and the recording library remain later phases. Input selection is browser-managed in this slice.
- Video placement follows existing editor semantics: place embedded sound on an audio track as needed. Capture adds source media; it does not automatically create a timeline edit or change the project format.
