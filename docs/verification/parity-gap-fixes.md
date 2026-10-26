# Tandem parity gap fixes

Reference: `mikecann/tandem@735a9b8e162c1f951044baa892d94993869f2e77`. Verification date: 2026-10-26. These changes address the follow-up audit after phase 140. They do not establish full Tandem parity.

## Implemented changes

| Area                | Result                                                                                                                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overwrite moves     | Destination overlaps split or trim through the same range-clearing implementation used by timeline edits. Undo restores the original clips.                                                                                                                                     |
| Filmora             | Reverse clips remain as forward media with a warning. Standalone freeze clips retain a frozen source frame. Internal freezes remain a warned approximation.                                                                                                                     |
| Keyboard            | The complete pinned Premiere keymap imports, including command aliases and both Delete names. Custom bindings persist, can disable a chord, and can reset. Transport, tools, marked-range edits, layouts, review navigation, dialogs, proxy and display controls have handlers. |
| Keyframes           | Option-K starts position and scale together, or audio gain. Existing animation parameters toggle together. Removing the last key preserves its value.                                                                                                                           |
| Selection           | Marquee spans tracks, respects linked selection, and restores selection and partial In/Out marks when canceled.                                                                                                                                                                 |
| Headless access     | CLI, MCP and Node SDK can host a closed portable project with a hidden Electron renderer. Clients share one locked project owner. Leases preserve other clients and background jobs. Edits and the undo journal survive reopening.                                              |
| Scripts and library | Trusted local SDK scripts support TypeScript files, inline code and stdin. Standalone library calls no longer require an open GUI project. Packaged CLI files include the runner and bundled SDK.                                                                               |
| Events              | Authenticated SSE carries project, job and export progress, bounded replay, cancellation and slow-client limits. SDK callers can resume with the last event ID.                                                                                                                 |
| Transcription       | A multilingual model and persisted language selector replace English-only inference. Each language has a separate cache.                                                                                                                                                        |
| Cutout and proxies  | Frames are written to local storage as they are produced. The fixed 60-second and cumulative frame-memory limits are removed. Canceled work removes its frame files. RVM is available alongside MediaPipe.                                                                      |
| Audio sync          | Long sources use coarse downsampling and distributed fine matches with drift estimation. The fixed 60-second rejection is removed.                                                                                                                                              |
| Export              | Export plans accept durations above five minutes and frame rates above 60. Long WebM output uses OPFS with backpressure. Long audio mastering uses bounded passes and a streaming limiter. Native codec timeouts scale with duration.                                           |

## Runtime evidence

- [Production headless results](headless-runtime.json): two clients share one process, durable edit and undo across reopen, a rendered PNG, WebM export progress, standalone SDK execution in three modes, and standalone library access.
- [Model and media results](model-media-runtime.json): official RVM inference produces foreground, background and soft alpha. A 301-second video decodes to 301 frames, with 301 disk-backed proxy frames and 301 recurrent matte frames. A one-second 120 fps export decodes to 120 frames. Large output has the WebM MIME type and is file-backed.
- [Editor interactions](editor-interactions-runtime.json): actual Electron keyboard and pointer input covers navigation, clipboard, context menus, marquee, snapping, scroll, zoom, trims, slip, shortcuts and persistence. The follow-up extends coverage to cross-track selection without links and native keymap import, dispatch, reload and reset.

Reproduction commands:

```powershell
vp run build:desktop
vp run --filter @sidecut/client build
vp exec node tests/desktop/verify-headless.mjs
# Run a local dev server on port 4270 for the source-module harnesses:
vp dev --host 127.0.0.1 --port 4270 --strictPort
# Execute the previous command from apps/web. Execute these from the repo root:
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
vp exec --filter @sidecut/desktop electron ../../tests/desktop/verify-editor-interactions.mjs
vp exec --filter @sidecut/desktop electron ../../tests/desktop/verify-model-media.mjs
```

The model harness requires the official ONNX file at `~/.cache/sidecut-models/rvm_mobilenetv3_fp32.onnx`, or the path in `SIDECUT_RVM_MODEL`. The application itself downloads the pinned release on first use. No model weights are committed.

## Final checks

`vp run check` passes all 16 tasks, including formatting, lint, TypeScript checks and 536 tests across 115 files. The test configuration limits concurrency to four workers because CLI integration tests spawn additional processes.

`vp run package:desktop` builds the Windows x64 installer. `vp run verify:packaged` passes isolation, encrypted credential storage, exclusive project locking, archive, media decode and encode, SQLite migration and reopen, CLI, and Unicode profile checks. The headless workflow also passes with `SIDECUT_APP_EXECUTABLE` pointing to the packaged `SideCut.exe`.

## Remaining limits

- Native macOS and real Linux session acceptance, Safari media execution, public hosted deployment, paid provider acceptance, and projects reopened in Tandem still require their recorded external environments.
- Native render and audio golden comparisons remain pending. RVM uses FP32 WASM rather than CoreML. RNNoise does not reproduce Apple's sound isolation. See [model provenance and limits](../media-models.md).
- Multilingual recognition quality is not verified across 99 languages. The supported selector, model configuration and cache separation are verified.
- Non-unit shuttle playback currently provides picture transport without shuttle audio. It does not establish native acoustic transport parity.
- File-backed WebM removes the browser heap output limit. Native codec and API transfers still enforce 256 MiB. Processed audio, archive materialization and FFT work retain explicit memory budgets. These are resource limits, not claims of unlimited source capacity.
- Filmora reverse playback and internal freeze mapping remain approximations with warnings. Full application round trips remain pending.
- Cache eviction does not yet reclaim every detached frame file. Cancellation removes files from the canceled operation. SSE supports explicit resume, without automatic reconnect.

Earlier phase evidence remains historical. This report supersedes earlier claims that user keymap files, cross-track marquee, closed-project hosting, or all long-source processing are absent.
