# Hidden-window export acceptance

The Windows Electron exporter completes both synthetic stress fixtures with its
normal background throttling enabled and the editor window hidden.
[Runtime evidence](export-stress-runtime.json) records the results.

| Picture       | Timeline length | Decoded video frames | Encode time   | Peak app working set |
| ------------- | --------------- | -------------------- | ------------- | -------------------- |
| 320x180 VP8   | 300 seconds     | 9,000                | 251.7 seconds | 1,140.7 MiB          |
| 3840x2160 VP8 | 30 seconds      | 900                  | 20.9 seconds  | 1,102.4 MiB          |

Both outputs contain 48 kHz stereo Opus. Their container durations include about
20 ms of audio padding. Export progress reaches one without moving backward.
FFprobe counts actual decoded frames. The test samples the sum of this Electron
app's process working sets once per second. The cases run sequentially in one
app; these numbers are observations, not isolated memory budgets or guarantees.

The fixtures use a static solid picture and a one-second mono tone followed by
silence. They exercise sustained composition/encoding, mastering of a long range,
and muxing. They do not stress long source-video decoding, complex effects,
every audio processor, or five minutes at 4K. They do not establish native Tandem
golden parity. The separate [quality checks](render-quality-runtime.json) cover
4K source detail, fractional-frame ranges, measured loudness, and cancellation.

The initial stress attempt was interrupted after it stalled. A smaller hidden
one-second fixture isolated chained zero-delay timers: it took 22.9 seconds with
normal throttling and 2.1 seconds with throttling disabled. Export/audio loops
now yield through closed-after-use message channels. The same fixture takes
about 2.7 seconds with normal throttling and asserts completion within ten seconds.
See [the hidden-window regression](export-hidden-probe-runtime.json).

Run after `vp run build:desktop`, with the dev server at `127.0.0.1:4270`:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
vp exec --filter @sidecut/desktop electron ../../tests/desktop/verify-export-stress.mjs --hidden-probe
vp exec --filter @sidecut/desktop electron ../../tests/desktop/verify-export-stress.mjs --hidden
```

The optional `--unthrottled` flag is diagnostic. Acceptance above retains default
throttling. Browser freezing/discarding, mobile background execution and other
desktop platforms remain unverified.

The native Windows HTTP path separately passes thirty-second 4K H.264 and HEVC
exports, with 900 decoded frames each. Encode times are 29.2 and 109.7 seconds.
These are static solid fixtures without audio. See
[native stress results](export-native-stress-runtime.json). A real FFmpeg unit
test cancels HEVC encoding after progress begins and checks temporary-directory
cleanup; this does not establish process cleanup on other operating systems.
