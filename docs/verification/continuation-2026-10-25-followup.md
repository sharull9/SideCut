# Browser, keyboard and range export follow-up

This continuation started at 2026-10-25 17:01:42 UTC after the previous
[checkpoint](continuation-2026-10-25.md). The user requested another continuation
until the five-hour limit. Provider quota status is unavailable; elapsed time
does not establish quota exhaustion. Existing uncommitted work is preserved.

## Browser hydration and read-only keyboard access

The production Firefox shell reproducibly reported React error 418 on initial
load and reload. A focused production-server harness identified the mismatch:
the editor's `main` element was rendered against the empty SPA Suspense boundary.
The browser-backed editor session now sits inside TanStack's existing
`ClientOnly` boundary. The focused harness passed after the change and was removed.
This follows the framework's documented
[client-only hydration strategy](https://tanstack.com/start/latest/docs/framework/react/guide/hydration-errors).

The production browser acceptance now rejects page errors as well as failed
exports. Chromium and Firefox pass import, clipboard edit, saved reload, source
import, project download, VP8/Opus WebM, WAV and archive reopen without page errors.
The same test opens a second, read-only tab. Frame navigation and selection work;
Delete cannot change the project. The previous shortcut guard blocked navigation
along with mutations. It now guards only project-editing shortcuts.

[Browser runtime evidence](continuation-2026-10-25-followup-browsers.json) retains
the Windows WebKit failure: OPFS storage cannot open, and the port lacks required
audio/video encoding APIs. Public hosting and native Safari are unverified.

## Extended keyboard coverage

The Premiere subset adds marker navigation, select-forward, mark the targeted
clip, link/unlink, modifier zoom, fit-to-view, and Alt/Option nudge/delete aliases.
Marker and video/audio track creation share actions with their existing buttons.
Previous/next edit navigation follows targeted tracks, using all tracks when none
are targeted. Unmapped shifted letters remain available to other controls.

Ctrl/Cmd+S flushes the current project to device storage; Ctrl/Cmd+O dispatches the
existing project picker; Ctrl/Cmd+E opens Export. The export dialog explicitly
focuses its range selector when opened. Application shortcuts stay blocked while
a dialog is open, including the interval before its focus trap settles. A real
Electron regression verifies that Delete cannot edit behind the dialog.

Real Electron input verifies the new commands, same-group link/unlink, target
navigation, fit aliases and input protection. See
[interaction evidence](editor-interactions-runtime.json). Custom keymap files,
all upstream commands, native gestures and screen-reader sessions remain open.

Q/W ripple-trim the selected or targeted clip to the playhead, with one-step
undo and no edit at an existing cut. Q moves the playhead to the original clip
start; W keeps it in place. Slip dragging now reverses the source offset and
scales it with clip speed. A real two-times-speed pointer fixture verifies this.
The chosen keyboard layout survives a renderer reload through device storage.

S and the toolbar snapping button share the same view state. Disabling snapping
also affects unmodified pointer drags. The production browser journey verifies
that a read-only tab can toggle snapping without changing the project.

## Range exports and renderer regressions

The export dialog can queue the entire sequence or its marked timeline range.
Jobs copy the range bounds when queued and reject stale project revisions.
Clearing the range disables a selected range export. WebM and WAV filenames
include the bounds. Audio export uses the existing cancellable job system and
guards edits until it completes, fails or is cancelled.

Preflight, audio detection and source/LUT loading now cover the selected range.
Video and audio transition handles that overlap it remain dependencies. The
five-minute limit applies to the exported range. Unrelated missing media and
unsupported graphics elsewhere do not block that range.

The frame service previously capped video decoding at 1920 pixels, even when
returning a 4K PNG. A lossless 4K stripe fixture failed with zero adjacent-pixel
contrast before the fix and passes with contrast 255 afterward. The encoded
4K VP8 output retains contrast above 249.

Mastering a 29.97-fps range starting between audio samples previously threw
`RangeError: offset is out of bounds`. The mixer now emits the same requested
sample count as the mastering buffer. A second regression verifies a short
mastered range late in a long source and direct decoder seeking to that span.

`tests/desktop/verify-render-quality.mjs` exercises actual Chromium decoders,
canvas rendering and encoders, then inspects output with FFmpeg/FFprobe.
[Runtime evidence](render-quality-runtime.json) records:

- 3840x2160 PNG and WebM source detail.
- A 5.005-second range with 150 frames at 30000/1001 fps and 48 kHz stereo audio.
  Its Opus container duration is 5.020 seconds, within the asserted 50 ms tolerance.
- Rendered loudness within 1 LU of -14 LUFS.
- Independent FFmpeg measurement of decoded Opus at -14 LUFS and -13.2 dBTP.
- Cancellation after rendering starts, followed by successful later exports.
- A fractional-frame range with exactly 50 frames.
- A non-silent one-second WAV at timeline seconds 600–601.
- No unrelated source reads, while an overlapping missing transition source fails.

The export-dialog harness verifies marked WebM/WAV output, stale-range handling,
and automated accessibility. See [preset evidence](export-presets-runtime.json).

## Hidden-window rendering

The first long stress run stalled while its renderer used little CPU. A focused
one-second hidden-window export took 22.9 seconds with normal Electron background
throttling and 2.1 seconds with throttling disabled. This isolates the scheduling
effect from the codec work. Chromium documents
[timer throttling in hidden pages](https://developer.chrome.com/blog/timer-throttling-in-chrome-88/).

The export, audio mixing/mastering and audio analysis loops now yield through
short-lived `MessageChannel` tasks instead of chained zero-delay timers. Both
ports close after each yield. Cancellation checks remain at the surrounding
checkpoints. See the [channel messaging API](https://developer.mozilla.org/en-US/docs/Web/API/Channel_Messaging_API).
The same hidden-window fixture completes in about 2.7 seconds with normal
throttling retained. The repeated long run passes: 9,000 frames over five minutes
at 320x180 and 900 frames over thirty seconds at 3840x2160. Encode times are
251.7 and 20.9 seconds. Sampled peak app working sets are 1,140.7 and 1,102.4 MiB.
See [stress acceptance and limits](export-stress.md). The interrupted first run
is not an acceptance pass.

The native HTTP export path separately encodes thirty seconds at 3840x2160:
900 H.264 frames in 29.2 seconds and 900 HEVC frames in 109.7 seconds.
See [native stress evidence](export-native-stress-runtime.json). These fixtures
contain a static solid picture without audio. A real FFmpeg cancellation test
also verifies removal of its temporary export directory after encoding starts.

These synthetic fixtures do not establish capacity for complex long-form edits
or upstream visual/audio golden parity. The queue remains in memory with five-entry and
256 MiB completed-output limits. Native macOS/Linux acceptance remains open.

## Earlier stalled check

The older `verify-cli-render.mjs` repeat passes on this continuation, including
contact sheets, screenshots, non-silent audio, H.264 export, loudness and guarded
failure cases. Its earlier silent stall was not reproduced. No cause is claimed.

## Validation checkpoint

On 2026-10-26, Windows lint, TypeScript and all 521 tests in 109 files pass.
The refreshed production Chromium/Firefox journeys pass, including the read-only
snapping check. WebKit acceptance remains blocked by its missing browser APIs.
Linux packaging and installation are checked separately in a disposable Debian
container; see the [container phase report](linux-container.md) for its result
and the remaining native desktop gates.
The rebuilt Windows directory package passes import/edit/export, SQLite migration
and reopen, encrypted credentials, locking and bundled CLI checks. See
[refreshed Windows package evidence](continuation-2026-10-26-windows.json).
