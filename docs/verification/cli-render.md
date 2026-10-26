# CLI images, exports and loudness

Phases 130.25–130.29 are verified on Windows against Tandem revision
`735a9b8e162c1f951044baa892d94993869f2e77`. The
[contract fixture](../../tests/fixtures/tandem/cli-render.json) records readable
examples from the pinned CLI, readable-result and sound-text source. All five
commands support `project COMMAND`, readable output by default and `--json` for
the complete service result. They use the existing authenticated host services.

## 130.25: Frames

`frames TIME ...` accepts seconds or clock times. `--every`, `--from`, `--to`,
`--width` and `--format` reach the contact-sheet service. Native positional times
map to the existing `times` array, with conflicting sources rejected. At least
one time or an interval is required. The existing JSON request, input and
`--times` extensions remain.

Default filenames include the earliest and latest explicit times, or the interval
and optional range. For example, `frames 1 0 1` writes
`frames-00.00.000-00.01.000.png`; the service sorts and deduplicates the times.
`frames --every 0.5 --from 0 --to 1` writes
`frames-every-0.5s-00.00.000-00.01.000.png`. `-o` selects another managed filename.
Readable results list the written path, byte count and actual frame times.

Electron verifies both examples, the PNG signature and dimensions, explicit
readable output and nonmutating failures for missing/out-of-range times and an
escaping path. The explicit 96-pixel tiles produce a 216×98 sheet with two frames.

## 130.26: Screenshot

`screenshot` writes `sidecut-window.png` in the managed exports folder by default.
`-o` selects another filename; positional arguments and unsupported flags fail.
Readable output reports the file and bytes. The default name uses SideCut branding.

Electron captures the actual editor window as a valid 1424×835 PNG, verifies a
second explicit output and checks that repeating the default output fails without
overwriting it. These captures do not change the project or revision.

## 130.27: Clip

`clip START END` maps native positionals to the service range. `--preset`,
`--audio-only`, `--tracks` and `-o` reach the existing export path. Track lists split
on commas, trim whitespace and discard empty entries. Existing `--start`, `--end`,
request and input forms remain available. Duplicate or incomplete ranges fail.

Readable output includes the path, preset, duration, elapsed time, sound-only
status, selected tracks and available measurement/encoding metadata. Native
optional fields are displayed when the service supplies them; JSON stays intact.

Electron clips a local sine wave from 0.25 to 1.25 seconds through the selected
audio track. FFprobe confirms one second of stereo 48 kHz PCM, and the output
samples are nonzero. A second clip verifies readable sound-only and track output.
Reversed ranges and missing tracks fail without changing the project.

## 130.28: Export

`export` accepts native preset, range, format and output flags. It rejects excess
positionals and unsupported flags before discovery. Requests use the existing
render/export queue and native encoder; no second exporter is added. Readable
results share clip formatting and include warnings and available loudness data.

Electron exports half a second of the 320×180 solid/sine fixture using `final`.
FFprobe confirms H.264, the expected dimensions and duration. The `.mp4.tandem`
companion snapshot retains project revision 1. A WebM export also passes through
readable CLI output. Unknown presets, an out-of-range end and an existing output
fail; the original movie bytes remain unchanged.

## 130.29: Loudness

`loudness MEDIA_ID` selects a source; `--from`, `--to`, `--step`, `--tracks`,
`--gains` and `--over` map to the existing mix analysis. The existing `--media-id`
and JSON input forms remain. Repeated/comma-separated track selections are
normalized before dispatch. Excess positionals, duplicate media IDs and unknown
flags fail explicitly.

Readable metadata includes speech/master targets, measured or pending sources,
clip normalization/gain groups and limiter/peak warnings. Curve output includes
integrated and peak levels, loudest time, a bounded sparkline and per-window rows.
Peak mode reports stretches; gains mode reports lane agreement, timing offsets
and mismatches. Large tables and stretch lists retain the native readable limits;
JSON preserves every returned entry.

Electron measures the source sine at about -18.236 LUFS and -14.746 dBTP. A
one-second selected-track query returns six 0.2-second curve points, six windows
over -30 dBFS and one second of gain-lane comparison with no mismatch. Both metadata
and curve text pass. Missing media/tracks and a zero step fail without project or
revision changes. Analysis may populate caches independently of project history.

## Verification and reproduction

[Runtime evidence](cli-render-runtime.json) records the values and failure codes.
The [Electron harness](../../tests/desktop/verify-cli-render.mjs) uses a temporary
profile, local two-second sine wave and solid clip. No provider or model request
is needed. Unit/subprocess tests in `cli-render.test.ts` compare pinned text,
native mappings, default filenames, display limits and unavailable-renderer
errors without mutating the host.

```powershell
vp run build:desktop
vp exec --filter @sidecut/web vp dev --host 127.0.0.1 --port 4270 --strictPort
# In another terminal:
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
vp exec --filter @sidecut/desktop electron ../../tests/desktop/verify-cli-render.mjs
```

All 482 tests in 100 files pass with `vp test run --maxWorkers=4`. Lint, TypeScript
and the production desktop build pass. The new CLI module is included in the
desktop packaging file list. The full formatting gate retains the pre-existing
`apps/web/src/modules/workspace/workspace.css` failure.

Windows unpacked packaging passes with `scripts/package-desktop.mjs --dir`.
The bundled `resources/cli/sidecut.cmd` displays help for all five commands using
the packaged executable, confirming that the new module and its dependencies load.

## Compatibility limits

Rendering requires an attached editor. Outputs remain exclusive managed exports
filenames; native absolute paths, file replacement and native clip naming are not
added. Export preset/encoding and loudness measurements retain the existing service
bounds. Optional native export bitrate/format/mastering fields are printed when
present, but this batch does not add missing metadata to older service results.

Contact sheets retain the service's 48-frame/32-million-pixel bounds, and browser
exports remain capped at five minutes. This short fixture does not verify long
renders, 4K encoding performance, cancellation during native encoding or every
audio effect. Loudness uses the current browser meter; cross-decoder or native
reference measurement identity is not claimed.

SideCut transport errors go to stderr and retain their existing codes. Runtime
bad-request/output conflicts return 2, unknown media/tracks/presets return 5 and
the renderer's out-of-range sequence export returns 3. Native error code 1 is not
claimed. Native macOS/Linux, installed launchers and upstream render/audio
comparisons remain unverified in this phase.
