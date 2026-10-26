# CLI history, validation and frame

Phases 130.20–130.24 are verified on Windows against Tandem revision
`735a9b8e162c1f951044baa892d94993869f2e77`. The
[contract fixture](../../tests/fixtures/tandem/cli-history-review.json) records
native defaults and readable examples derived from the pinned Swift source.
All five commands support `project COMMAND` and `--json`; readable output is the
default. Unsupported options and excess positionals fail before discovery.

## 130.20: Undo

`undo` reverses one shared edit by default. `--count` requests multiple edits;
`--expect` forwards the expected revision. Readable output names the edit and
author, or every edit in a counted result, followed by the new revision.
Requesting more steps than exist reverses only the available steps.

Host subprocess tests and Electron both verify counted and single-step undo,
revision conflicts, invalid counts and the empty-history error. Electron undoes
two edits at revision 2 and observes the complete original project at revision 4.
Stale and invalid requests leave project data and revision unchanged.

## 130.21: Redo

`redo` reapplies one shared edit by default, with the same `--count` and `--expect`
options. Its text reports the original labels and authors. Host and Electron
checks verify empty redo, stale and invalid requests, single redo and a request
for ten steps when only two exist. The latter replays both available edits and
reaches revision 6; the editor observes the restored clip, track and project name.
Single undo and redo then reach revisions 7 and 8.

## 130.22: History

`history` prints the current revision, undo entries newest first, the next redo
label and durable edits. `--limit` reaches the service, whose default remains 20.
Readable formatting handles local timestamps, undo/redo labels, history openings,
consecutive media-scan summaries, optional placement/summary fields and fallback
events. `--json` preserves the available service fields.

Pinned fixtures cover readable history, locations, openings, scan coalescing and
fallback events. Real host and Electron checks verify `--limit 1`, newest-first
order, readable listing and read-only behavior. An invalid limit fails without
changing the project. The service retains its existing durable journal.

## 130.23: Validate

`validate` reports every issue and returns exit 0 when `ok` is true. Projects with
errors return exit 1 in both text and JSON modes. Warning-only validation succeeds.
Neither result changes the project or revision.

The live host and Electron validate a valid project. Host tests also validate a
warning-only single-member link group. The authoritative coordinator refuses
invalid projects, so the invalid-exit test uses an HTTP boundary responder that
runs the real core validator on a fixture with a missing media reference. Both
text and JSON return exit 1 and preserve that fixture. This is not an invalid
project accepted into the running editor. Unsupported command flags fail with 2.

## 130.24: Frame

`frame TIME` accepts seconds, seconds with `s`, or a clock time. Native `--width`
and `--height` map to `maxWidth` and `maxHeight`; the existing `--time`,
`--max-width`, `--max-height`, request and input extensions remain. Duplicate
times and conflicting size aliases fail explicitly.

Frame writes `frame-MM.SS.mmm.png` by default. `-o`/`--output` selects another
filename in the managed exports folder. Readable output reports the path, bytes,
time and warnings; JSON retains the service metadata. Files are created
exclusively, so an existing frame is never overwritten.

The Electron CLI exports the solid clip at 1 second, bounds it to 160×90 and checks
the PNG signature, header dimensions and byte count. Decoding the file gives the
expected centre pixel `[204, 51, 26, 255]`. A second frame verifies a seconds suffix,
explicit filename with spaces and readable output. Repeated output, time outside
the timeline, zero width, escaping output path, malformed clock time and unknown
format all fail while preserving the project, revision and original PNG bytes.

Runtime acceptance found that unknown image formats silently used the main canvas.
Image rendering now shares the checked format resolver with sequence exports.
The resolver supports the main canvas, registered alternates and an already
portrait canvas requested as `portrait`; unknown names fail. Core tests cover
those branches, and Electron verifies the unknown-format failure.

## Verification and reproduction

The [Electron harness](../../tests/desktop/verify-cli-history-review.mjs) records
the five journeys and failure codes in [runtime evidence](cli-history-review-runtime.json).
It uses a temporary profile and solid colour clip, without source downloads or
model inference. `cli-history-review.test.ts` supplies host/subprocess and pinned
contract coverage; `finishing-review.test.ts` verifies the shared format resolver.
The generic scalar-conversion test now uses a schema-only `probe` command because
`validate` correctly rejects its former artificial `--count`/`--enabled` fields.

All 478 tests in 99 files pass with `vp test run --maxWorkers=4`. Lint, TypeScript,
the production desktop build and Windows unpacked packaging pass. The unpacked
`resources/cli/sidecut.cmd` successfully displays help for all five commands using
the packaged executable. Changed files pass formatting and `git diff --check`;
the aggregate formatting gate still fails only on pre-existing
`apps/web/src/modules/workspace/workspace.css` formatting.

```powershell
vp run build:desktop
vp exec --filter @sidecut/web vp dev --host 127.0.0.1 --port 4270 --strictPort
# In another terminal:
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
vp exec --filter @sidecut/desktop electron ../../tests/desktop/verify-cli-history-review.mjs
```

## Compatibility limits

The commands require a running authenticated owner; frame also requires an
attached renderer. Native macOS/Linux, installed launchers and native Tandem
render comparisons remain unverified. Windows unpacked CLI help is checked
separately from installation acceptance.

SideCut restricts image outputs to managed exports filenames and frame times to
the timeline. Native absolute output paths and replacement behavior are not
added. History text renders placement metadata when present, but the current
service supplies labels, authors and journal dates without native placement or
summary enrichment. Its existing count and limit bounds remain.

Transport errors retain SideCut's codes and stderr convention: empty history and
bad requests return 2, stale revisions return 4 and unknown formats return 5.
Native service error code 1 is not claimed. Validation findings now use their
native success/error exit distinction, independently of transport errors.
