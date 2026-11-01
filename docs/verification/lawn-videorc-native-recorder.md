# LV007: Native FFmpeg recorder

The Windows desktop app now offers **Project media → Native recording** for full-desktop, camera or microphone capture. This host-managed recorder writes incrementally to disk and does not use the short recorder's five-minute/128 MiB buffer. The existing short recorder remains available. Native library/import/reveal/delete work belongs to LV008, and long-duration delivery acceptance belongs to LV009.

## Engine and retention

One host owns one native recording operation at a time. Device IDs resolve against a fresh DirectShow listing. Microphone inputs precede picture, with explicit stream maps and queue sizes of 32 audio packets and four video packets. Only Windows inputs are implemented. Friendly-name fallback cannot distinguish a replacement device with the same name when DirectShow supplies no usable alternative identifier.

The host confirms the selected sources before starting. Full-desktop capture includes the entire desktop, rather than a selected screen/window; system audio is excluded. Trusted main-frame checks, owner revocation on navigation/renderer loss, and awaited app shutdown surround the process. Stop remains available when editing becomes read-only or busy. The renderer receives metadata, never file paths or executable arguments.

Automatic encoding tests NVIDIA NVENC, Intel QSV and AMD AMF with synthetic media before opening capture devices. It chooses the first usable encoder, falling back to software H.264. Software encoding is also selectable explicitly. A hardware failure after capture starts preserves the incident rather than silently restarting and losing part of the source. Startup waits for media progress with a 20-second deadline; process spawn alone does not report recording success.

Each UUID directory under the desktop profile's `native-recordings` folder contains an atomically replaced `metadata.json` journal and `recording.mkv`. The MKV uses short clusters and packet flushing; the encoder requests a 60-frame keyframe interval. Stop requests FFmpeg finalization, with a ten-second termination fallback. MP4 remux copies the H.264/AAC streams into a temporary file, inspects streams and timestamps with FFprobe, and publishes through a no-overwrite link. The MKV is retained, including when finalization fails. Retry can remux an interrupted source. Missing/corrupt journals are skipped, and journal IDs must match their folder.

After a host restart, journals left recording/stopping become interrupted. Recovery preserves the recorded prefix; it cannot restore unwritten or incomplete packets. Existing MP4 destinations are never replaced. An existing output after a crash between publication and journal commit requires later library/reconciliation work; retry currently refuses that destination safely.

The implementation follows the official [FFmpeg device documentation](https://ffmpeg.org/ffmpeg-devices.html) and [Matroska/muxer documentation](https://ffmpeg.org/ffmpeg-formats.html).

## Acceptance

The [production Electron report](lawn-videorc-native-recorder.json) uses the built app, real sandboxed preload/IPC, controls, encoder, storage, remux and FFprobe. Only device enumeration, capture inputs and confirmation are substituted in the fixture; no physical pictures or audio are captured.

- Automatic mode probed NVENC, QSV and AMF and selected **H.264 AMF** on this machine. The UI recording produced an MP4 with H.264 video and AAC audio, nonzero packet counts, and per-track timing metadata.
- Microphone-only recording produced an AAC MP4.
- A second screen-source recording was interrupted by terminating the fixture's owned encoder. A fresh Electron host recovered the retained MKV and successfully retried finalization into a playable H.264 MP4.
- Recovery explicitly removes the disposable project's stale lock after its prior host exits. This is fixture setup, not an automatic stale-project-lock recovery feature.

Focused tests use real FFmpeg/FFprobe to cover encode/remux, overwrite refusal, retained source after failed finalization, retry, early exit, malformed journals, device selection and IPC ownership. An accelerated synthetic output of **305 seconds** passes remux and stream validation. This proves duration beyond the short-recorder limit; it does not measure five minutes of wall-clock capture.

`vp run check` passes formatting, lint, TypeScript and **579 tests across 121 files**. `vp run build:desktop` passes. The prior desktop permission and saved-recording output verifiers also pass with the integrated build. Dependency-directive/CommonJS build warnings, the route-generator warning and Electron safeStorage deprecation remain. No dependencies were added.

## Remaining acceptance

Physical camera/screen/microphone startup and unplug behavior, calibrated A/V sync, sustained frame cadence, memory/disk growth, and extended hardware runs remain unverified. A 128×128 encoder preflight cannot guarantee hardware support at every capture resolution. The one-hour remux deadline, queues and software profile require long-run resource validation. LV005's physical calibration gate, LV009's 60-minute journey and LV034's macOS/Linux acceptance remain open.

Native recordings currently use one selected picture source with optional microphone in a combined container. Source-isolated camera/screen sessions, studio composition, direct editor handoff and user-facing file management require later phases. The LV006 short recorder's earlier Electron VP8 failure is separate from this FFmpeg H.264 path.

```powershell
vp run check
vp run build:desktop
vp run verify:native-recording
vp run verify:capture-desktop
vp run verify:recording-desktop
```

The native verifier uses a disposable profile, bounded child processes and scoped cleanup, retaining only measurement metadata in the repository.
