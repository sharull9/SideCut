# CLI editing helpers

Phases 130.13 through 130.17 are verified on Windows against Tandem revision
`735a9b8e162c1f951044baa892d94993869f2e77`. The
[contract fixture](../../tests/fixtures/tandem/cli-helpers.json) records defaults
and readable result examples from the pinned CLI and service source.

## Supported behavior

`pauses`, `tighten`, `join`, `captions` and `short` print readable results by
default; `--json` preserves service results. Their help describes supported flags.
Excess positionals and unsupported flags fail before project discovery. Existing
SideCut endpoint-file, request/input and `project COMMAND` extensions remain.
Editing helpers preview by default. `--apply` commits through the shared host;
`--expect`, `--label` and `--author` reach that edit. Default author comes from
`SIDECUT_AUTHOR`, then `TANDEM_AUTHOR`, then `cli`.

`pauses` accepts minimum duration and a timeline range. Readable results report
each pause, context, total time and missing transcripts. It never edits.

`tighten` accepts the shared minimum/keep rules, sentence/comma/mid-sentence keeps,
`--mid-min`, `--mike`, repeated/comma-separated `--protect`, `--widen` and ranges.
Readable previews include exact planned cuts, widening, protected pauses, warnings
and before/after duration. JSON exposes the underlying plan. Applied edits use one
coordinator batch and undo together.

`join` reports joinable through-edits and skips whose joining would change
playback. A preview is read-only; apply merges the planned pairs as one edit.
Warnings and undo instructions appear in readable output.

`captions` maps native `--max-words` to the service's `words` field and accepts
position, track, range and edit options. Readable output lists up to 40 planned
captions, remaining count, installed fonts and warnings when present. Apply adds
all caption lines in one edit; undo removes them.

`short` previews or applies the shared portrait layout. Readable output reports
slot counts, format and warnings. `--copy -o NAME` produces an independent project
when combined with `--apply`; a missing `.tandem` suffix is added. The existing
`--copy-path` extension also works. Outputs remain confined to the managed
project's exports folder and existing files are never replaced.

Copy previews include the adopt-format command and do not claim that a file was
written. Applied copies receive a new project ID, the requested name and the
source revision, with fresh history. When an editor is attached, registered media,
LUT, font and licence resources are copied to the new project ID before the file
is published. A project change during preparation prevents publication. The
source project remains unchanged. Reopening the copied file in the same profile
restores available media and its 1080x1920 canvas.

## Verification

`vp run check` passes formatting, lint, TypeScript and all 467 tests in 97 files.
`vp run build:desktop` passes. New tests compare pinned readable examples, native
flag mappings and preview defaults. Real host/subprocess tests cover join apply,
author/label/revision forwarding, stale rejection, undo, short-copy previews,
exclusive output, copied dimensions/name/revision/fresh history and cancellation
of publication after a concurrent edit.

The [Electron acceptance script](../../tests/desktop/verify-cli-helpers.mjs) uses
temporary profiles, real PNG/WAV resources and a cached three-word transcript.
It invokes every command through the CLI against the authenticated desktop host.
It finds two pauses, protects both with repeated flags, and exercises explicit
punctuation rules, widening and the reference preset. Tightening plans two cuts
removing about 2.933 seconds. Apply creates revision 1; one undo restores the
complete source project.

Joining finds one through-edit and applies revision 3. Captions create three
lines on the requested track at revision 5. Portrait layout assigns camera to
the bottom and screen to the top at revision 7. Each operation undoes in one step
and restores the original project data. Stale edits and an invalid caption
position fail. A copied short preserves source revision 8 and its own name/ID,
refuses overwrite, leaves the source unchanged and reopens with all three media
resources available.

Observed values are in the [JSON evidence](cli-helpers-runtime.json) and the
[reopened short screenshot](cli-helpers-editor.png). Reproduction follows the
repository's Electron workflow:

```powershell
vp run build:desktop
vp exec --filter @sidecut/web vp dev --host 127.0.0.1 --port 4270 --strictPort
# In another terminal:
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
vp exec --filter @sidecut/desktop electron ../../tests/desktop/verify-cli-helpers.mjs
```

## Compatibility limits

- These commands require a running owner. Native macOS/Linux and installed CLI
  launchers remain unverified. SideCut names, transport error codes and managed
  output locations retain the existing adapter conventions.
- Speech acceptance uses cached words. Fresh model inference and long-recording
  quality retain the previously documented transcription bounds. Caption font
  installation retains the existing service behavior; this batch does not
  download fonts or compare native glyph rendering.
- Short resources are copied within the same browser profile, up to 256 MiB.
  Moving the `.tandem` file alone does not transfer those resources to another
  machine; archive the opened copy for portability. A missing editor produces
  an explicit resource-copy warning. Interrupted or refused publication can
  leave unused resource copies. Native sibling-folder copies are not added.
- Acceptance profiles remain in Windows temp; the script does not recursively
  remove files while Chromium may hold them open.
