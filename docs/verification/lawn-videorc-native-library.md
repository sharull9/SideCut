# LV008: Recording library and editor handoff

Verified on Windows on 2026-10-27 with the production desktop build. Changes are uncommitted.

Project media now includes a Native recording library with recording status, size, source timing and lazy posters. Ready recordings support Add to project and Edit in new project. Reveal opens the retained file's location. Delete recording requires a host confirmation and removes only the selected recording folder.

Imports copy media into the existing project resource store. The original recording remains in the library until deletion. A new project places camera video on the camera track, screen video on the screen track, and audio on the audio track. Clips share a link group. The earliest track starts at timeline zero, later tracks retain their relative delay, and source positions retain the MP4 timestamps. Clip duration is bounded by the measured media end because older probe versions can include an initial timestamp gap in stream duration. Original recording metadata remains attached to the media item.

Host operations share the recorder's operation guard. IDs, sender frames, journals and filesystem paths are validated. Active recordings block file operations. Delete confirmations expire after navigation, renderer loss or closure. Concurrent lazy poster requests retry when the operation guard is busy.

## Checks

`vp run check` passes formatting, lint, TypeScript and 588 tests across 123 files. `vp run build:desktop` passes. The focused library, IPC and session suites pass 30 tests. No dependencies were added.

`vp run verify:native-library` passes against the built app with a disposable profile. The [machine-readable report](lawn-videorc-native-library.json) records:

- Real FFmpeg H.264 and AAC fixtures with different nonzero track timestamps.
- Bounded 320-by-180 JPEG generation, two lazy poster rows, named preload reads and a scoped reveal path.
- Import into the current project, persistent copied bytes and decodable playback after renderer reload.
- New-project creation with linked clips, relative offsets, original source positions and bounded durations. The project and playable resource survive reload.
- Cancelled deletion retains the original. Confirmed deletion removes its folder while imported resources in both projects remain playable.

Filesystem tests cover audio-only assets, cached posters, size limits, malformed IDs, mismatched journals, active operations and unsafe directory links. IPC tests cover trusted main frames, headless rejection, cancellation and confirmation expiry. Session tests cover save retry without duplicate media, failed resource staging and session closure during a pending read.

## Limits

The fixture uses synthetic media and substitutes confirmation responses and the shell reveal callback. It verifies the resolved reveal path, not a visible File Explorer window. Physical capture, calibrated sync, long-run resource use and other native platforms remain in LV005, LV009 and LV034. This phase does not add isolated simultaneous screen and camera capture.

Imports remain limited to 128 MiB and transfer a bounded whole-file copy through the bridge. Larger native recordings stay on disk and can be revealed or deleted. Long-form delivery remains LV009.

Existing dependency-directive and CommonJS build warnings, the route-generator warning and Electron safeStorage deprecation remain. The fixture also logs expected IPC errors for cancelled deletion and poster contention before retry.

```powershell
vp run check
vp run build:desktop
vp run verify:native-library
```
