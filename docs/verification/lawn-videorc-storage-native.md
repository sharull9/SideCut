# Recording recovery, large-file storage and native feasibility

Work continued from SideCut `06a1814` on 2026-10-26. LV004 is implemented. LV003 and LV005 have additional working behavior and measurements, with physical acceptance gates still open. Existing unrelated workspace changes were preserved.

## LV003 browser acceptance

The production Chromium and Firefox harness uses real MediaRecorder, SQLite, OPFS and editor operations with synthetic device inputs. It covers camera with microphone, microphone alone and canvas-backed display recording, then download, import, placement, reload and edited VP8/Opus export.

It now accepts navigation during a capture and after Stop. A completed recording can be imported after reload. An active recording retains its committed prefix as an interrupted record. Partial output cannot be imported as if it were complete; it can be streamed to a selected folder for validation or removed.

The recording MIME type now matches actual audio-track presence. Video-only streams use `video/webm;codecs=vp8`; picture with audio uses VP8/Opus. Requesting an Opus encoder without an audio track stalled Firefox finalization. Source liveness also has a one-second track-state check because a stopped source may stop delivering events. Stop waits for the recorder to flush before releasing input tracks.

The styled recording download retains native link semantics. Browser verification exposed that the previous custom button renderer gave it button semantics, making the download unavailable to link navigation. The existing visual style is retained through `buttonVariants`.

Evidence:

- [Chromium production journey](lawn-videorc-capture-runtime.json).
- [Firefox production journey](lawn-videorc-capture-firefox.json).

Real browser screen/window picker interaction, physical camera capture and Safari remain unverified. The native probe below exercises Windows desktop and microphone inputs separately from the browser picker. No claim of complete LV003 platform acceptance is made.

Firefox acceptance uses explicit Stop for its canvas-backed display fixture. A separate synthetic track-ended attempt stalled finalization and required termination of that test's owned browser process. That case is not counted as passing; Chromium source-ended capture passes. The stop watchdog now directs users to retained chunks instead of incorrectly saying they were discarded. Browser test shutdown has a bounded browser-server kill fallback.

## LV004 storage and output

`packages/core/src/recordings.ts` runs against the existing `DurableStorage` and `NativeStorage` interfaces. The SQLite `recordings` collection stores a validated project binding, MIME type, status, byte total and ordered chunk references. Each chunk is at most 8 MiB and closes before a metadata compare-and-swap commit. A failed commit removes the newly written chunk and leaves the prior prefix intact. A failed write does not delete earlier committed data.

The existing `documents` table needs no SQL schema-version change. The new collection is additive. Recording bytes use the existing browser/native resource directories; there is no second project database. Browser Web Locks prevent recovery/export/removal of a recording still owned by another window. Completed captures retain their lease until explicit discard/import or session close.

**Project media → Saved recordings** lists inactive completed and interrupted records. Completed records up to 128 MiB can be downloaded or imported into their original writable project. Interrupted records require export and validation before editing. Both browser and desktop support output-folder selection. Browser folder support depends on File System Access; the desktop uses named preload calls and a main-process folder dialog. Chosen directories are session-local.

Exports read one chunk at a time. Native output writes and flushes an owned temporary file, then links its final UUID-derived name exclusively. Existing files are not overwritten. A failed/cancelled export removes its temporary output and retains source chunks. Native finalization requires a filesystem supporting hard links, as tested on Windows NTFS. Unsupported filesystems fail without deleting the recording. Browser exports use the selected directory handle and refuse names that already exist.

Tests and runtime results:

- A real 260 MiB recording is stored in 65 four-MiB files with SQLite metadata, streamed into a Unicode output folder, and checked at its final byte range. This crosses the old 256 MiB output boundary without constructing a whole-file JS buffer.
- Reopening SQLite after an injected quota/commit failure recovers the previous three-byte prefix. Uncommitted chunks are removed. Partial records cannot be promoted to ready without validation.
- Cancelled output, damaged/truncated chunks and existing destination files fail without replacing source metadata or existing files.
- [Production Electron evidence](lawn-videorc-recording-desktop.json) verifies actual named preload calls, selected-folder output, missing-folder refusal, invalid-ID refusal, overwrite refusal, renderer isolation and untrusted-origin refusal. The dialog is replaced with a synthetic test selection; file I/O and IPC remain real.
- Browser navigation recovery and folder export use the same SQLite/chunk services as normal capture. The browser harness supplies an OPFS directory as a synthetic folder selection, rather than driving an OS folder chooser.

Short browser capture remains capped at five minutes/128 MiB. Large-file storage does not bypass editor import, export duration or codec limits. The stored byte counter validates up to 1 TiB, but only the 260 MiB fixture is accepted here. It is not a capacity claim for terabyte recordings.

An interruption between writing a chunk and committing its reference can leave an orphan file. The last committed prefix remains recoverable. Orphan-file collection, partial-container repair and source-isolated recording are not implemented in this phase. A recovered prefix is not guaranteed to be a complete playable media file.

## LV005 Windows capture experiment

The probe uses the installed FFmpeg/FFprobe binaries, private temporary directories and bounded child processes. Screen and microphone capture run only with explicit `--screen`/`--microphone` flags. No captured pictures, audio or device identifiers remain in the repository; the output is measurement metadata.

The [native probe results](lawn-videorc-native-probe.json) record five-second runs on this Windows 1920×1080 desktop:

| Profile                                             | Video frames | P95 frame interval | Initial container A/V timestamp skew |
| --------------------------------------------------- | ------------ | ------------------ | ------------------------------------ |
| Host-managed synthetic 1080p30 plus tone            | 150          | 34 ms              | 21 ms                                |
| Windows desktop plus synthetic tone                 | 137          | 67 ms              | 21 ms                                |
| Windows desktop first, live DirectShow audio second | 35           | 800 ms             | 23 ms                                |
| Live DirectShow audio first, bounded input queues   | 146          | 34 ms              | 23 ms                                |

The synthetic host run encoded 150 frames in 654 ms. The private Node process supervising the same FFmpeg encoder took 569 ms for encoding and 640 ms including worker startup. These are single runs with different startup/cache conditions; they do not establish that process isolation improves encoding speed. No Rust or GPU worker was built or measured.

The input-order experiment improves frame delivery substantially, but does not establish strict 30-fps delivery under load. The probe uses the first enumerated DirectShow audio input; enumeration alone does not certify physical versus virtual hardware. AAC priming and frame quantization contribute to container timestamp offsets. Those offsets are not a physical sound/picture synchronization calibration. Preview latency, long-duration drift, sustained resource use, device loss and a calibrated physical A/V fixture remain open.

The queued probe uses 512 input queue slots and a 128 MiB DirectShow buffer. This bounds the experiment but is not an accepted production memory budget, particularly for raw video frames. LV007 must measure and reduce queue sizes against its resource targets rather than copy these probe flags as shipping defaults.

Keep a supervised FFmpeg subprocess as the initial Windows encoding candidate. Start/settle audio before arming picture and use bounded input queues. Gate native recording acceptance on device startup, cadence and physical A/V calibration before LV007. A private wrapper alone does not solve device timing, and these results do not justify choosing a Rust/GPU engine yet. LV005 remains in progress for its physical calibration requirement.

## Reproduction and checks

```powershell
vp run check
vp run build:desktop
vp run verify:recording
$env:SIDECUT_RECORDING_ENGINE = 'firefox'
vp run verify:recording
Remove-Item Env:SIDECUT_RECORDING_ENGINE
vp run verify:recording-desktop
vp exec node scripts/probe-native-capture.mjs --screen --microphone
```

`vp run check` passes formatting, lint, TypeScript and 557 tests in 117 files. `vp run build:desktop` passes. Existing build warnings about dependency directives, route-generator circular imports and CommonJS preload remain. The Electron negative cases intentionally produce rejected-handler messages. No new package dependency was added.

A full-suite repeat run concurrently with browser jobs hit the existing five-second timeouts in two CLI tests and one resulting temporary-directory cleanup error. Both test files then passed separately, with all ten tests. That concurrent run is not recorded as an acceptance pass.
