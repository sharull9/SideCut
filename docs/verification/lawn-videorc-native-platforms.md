# LV034 native platform acceptance

Continued the approved phase plan on 2026-11-01. LV034 remains in progress.

## Packaged recording acceptance

The existing packaged verifier now runs the production `NativeRecorder` with a synthetic 320 × 180, 30 fps video input and a 48 kHz tone. It uses the packaged FFmpeg and FFprobe directly, without development binary overrides. No physical device, permission dialog or streaming provider is used.

The fixture checks a guarded recording stop, H.264/AAC MKV-to-MP4 finalization, positive track durations, the journal's byte count and saved-recording access. The sandboxed renderer then uses the existing named native-media bridge to probe the MP4 and transcode its video/audio to VP8/Opus. A second application process loads the saved journal, checks the same MP4 SHA-256 and repeats the probe/transcode. The normal production recorder and library retain their own separate directory; fixture inputs are never enabled for ordinary capture.

This extends the existing installed/unpacked journey: Unicode/space paths, renderer isolation, credential encryption or secure keyring refusal, exclusive project locks, SQLite legacy migration, PCM import/edit/export, archive creation, CLI and project reopen. The Windows, macOS and Debian install scripts all invoke this verifier, so future runs exercise the same acceptance gates.

## Findings

Windows x64 passes both the [unpacked package](lawn-videorc-platform-windows-unpacked.json) and [NSIS-installed application](lawn-videorc-platform-windows-installed.json). The installed run also passes the bundled CLI launcher and removes its disposable Unicode/space installation and registration afterward. Both reports record synthetic H.264/AAC output, VP8/Opus transcoding and the hash-checked process restart.

Debian 12 x64 under Docker Desktop/WSL also passes the [unpacked package](lawn-videorc-platform-linux-unpacked.json) and [installed Debian package](lawn-videorc-platform-linux-installed.json). The session runs as the container's `node` user with no host mounts or network, using Xvfb, disposable D-Bus/keyring, UTF-8 locale and the sandbox allowances from the earlier Linux harness. Both applications verify recording/transcoding and hash-checked restart. The runner removes the Debian package afterward, and the test container is removed after copying evidence. AppImage creation passes; AppImage execution is not tested.

The Linux test run exposed a timing assumption in the multistream fixture. An opening failure on one destination sets aggregate status to `failed`, even while another destination remains requested. That failure can arrive before `start()` resolves. The fixture now waits for the refused target, asserts aggregate failure and healthy-target status, and allows enough media before stopping for its existing duration/decode assertions. Production stream behavior is unchanged.

The Linux build context now excludes local execution logs. They are ignored workspace outputs and are unnecessary for a reproducible container build.

The clean Linux package build also exposed a stale Docker command: it built the desktop without building the SDK now bundled by the packaging script. The harness now invokes the existing `package:desktop` task, which builds both before packaging.

The container suite uses one worker and a 30-second test budget to bound resource contention on this shared Windows/WSL host. A one-worker run with the default five-second budget passed 711 tests but timed out in a multi-process CLI integration. Earlier four-worker attempts also hit CLI/large-file timeouts. Assertions remain intact; this runner budget is not a performance acceptance threshold. One earlier Linux run passed all 712 tests with the default budget before the stale package-build command was corrected.

## Validation results

- Windows: formatting, lint and all workspace typechecks pass. The default `vp run check` reaches test timeouts under shared-host load; a separate `vp test run --maxWorkers=1` passes all 712 tests in 148 files with unchanged timeouts (232 seconds). Logs: `logs/lv034-check-final.log`, `logs/lv034-windows-tests-serial.log` and `logs/lv034-format-final.log`.
- Windows: production renderer/desktop and SDK builds, NSIS packaging, unpacked verification and install/verify/uninstall all pass. Logs: `logs/lv034-build-desktop.log`, `logs/lv034-client-build.log`, `logs/lv034-package-windows.log`, `logs/lv034-windows-unpacked.log` and `logs/lv034-windows-installed.log`.
- Linux: lint, workspace typechecks, all 712 tests in 148 files, production builds, AppImage/deb packaging and offline unpacked/installed runtime checks pass. Tests use the documented one-worker/30-second budget. Logs: `logs/lv034-linux-build-budgeted.log` and `logs/lv034-linux-runtime.log`. Minimal-session D-Bus, hostname and desktop-association warnings do not fail the journeys.

## Remaining acceptance

The later [LV035 recovery and diagnostics checks](lawn-videorc-recording-repair.md) refresh Windows unpacked/NSIS and Debian-container unpacked/installed acceptance with interrupted-journal repair, matching published-MP4 recovery and support reports. The subsequent [remux cleanup checks](lawn-videorc-remux-cleanup.md) pass the same platform journeys and 720 tests in 149 files on each platform. The LV034 artifacts and counts above remain historical evidence for that earlier slice.

The [journal version checks](lawn-videorc-journal-versions.md) pass Windows unpacked/NSIS and Linux container unpacked/deb journeys with version-1 writes, legacy recovery and future-version preservation. Both platforms pass 722 tests in 149 files. The latest [saved layout preservation checks](lawn-videorc-layout-preferences.md) also pass those four journeys, with 723 tests per platform and production renderer checks for temporary layouts, reset and persistence across reloads. These results retain the same synthetic-input and container limits.

Production device enumeration and input assembly explicitly support Windows only. Synthetic input injection verifies the engine and codec/storage portability; it does not add macOS AVFoundation/ScreenCaptureKit or Linux PipeWire/portal/device adapters.

The later [AppImage execution check](lawn-videorc-appimage.md) passes the same production journey through the AppImage artifact in extract-and-run mode, including restart and its bundled CLI. FUSE mounting and physical Linux desktop acceptance remain unverified.

Native macOS build/install/capture has not run on this Windows machine. Linux container/Xvfb acceptance does not establish a physical GNOME/KDE/Wayland desktop, portals, real camera/microphone permission revocation or hardware acceleration. Windows still needs physical A/V calibration, sustained resource/cadence measurements and the remaining device-loss checks recorded in LV005. Signing, updates and certification remain LV035.

## Reproduction

```powershell
vp run check
vp run build:desktop
vp run --filter @sidecut/client build
vp exec node scripts/package-desktop.mjs
vp run verify:packaged
vp run verify:windows-install
docker build -f tests/linux/Dockerfile -t sidecut-linux-verification:lv034 .
```

Run the Linux image with the locale, D-Bus and sandbox conditions documented in [Linux container verification](linux-container.md). The Windows installer refuses to replace an existing registered SideCut installation and removes its disposable installation afterward. Artifacts remain local and are not published.
