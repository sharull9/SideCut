# CLI comments, sync, jobs and revision helpers

Phases 130.35–130.41 are verified against Tandem revision
`735a9b8e162c1f951044baa892d94993869f2e77` within the limits below.
[Pinned examples](../../tests/fixtures/tandem/cli-analysis.json) cover the readable
forms. [Electron evidence](cli-analysis-runtime.json) records actual CLI requests
through the shared host and editor.

`comments` prints chronological comments, nearby cached speech and affected clips.
`comments resolve ID ...` and `comments resolve --all` validate the current comment
IDs and remove them through one revision-guarded apply batch, with the requested
label and CLI author. Unknown IDs and ambiguous selection modes fail without
editing. Electron resolves a comment, observes its removal and undoes it; the
listing includes `Before | After` speech context. Text uses SideCut/editor names
rather than the reference author's personal name.

`sync` accepts picture delay positionals in seconds or milliseconds, including
signed numeric seconds, or file positionals for sound matching. Native media,
default, reference, no-place, dry-run and revision flags reach the existing
service. Sync now preserves the CLI author on its shared edit. Electron verifies
an 80 ms camera delay and default, a sound preview, a recovered 250 ms offset and
one-step undo. Camera defaults are independent settings and remain after undo,
as in the service's existing behavior. Sound source spans retain their bounds.

`wait [TARGET]` defaults to jobs and supports native media/timeout flags.
`transcribe MEDIA ...` supports wait/no-wait, timeout and label options, defaulting
to asynchronous work with an attached editor. Both now return exit 1 when the
actual result's `ok` is false. Wait, export-wait and transcription service results
now expose `ok`, including failed work and expired deadlines. Transcription
marking edits preserve the CLI author. Source tests verify pending and failed
results; Electron observes a cached two-word transcript and failure on an
unavailable local source without acquiring a model. A failed transcription can
retain its explicit request-marking edit, which is independently undoable.

`diff BASELINE` and `diff --since BASELINE` print aggregate/per-edit clip changes,
quiet edit groups and grouped ripple shifts. `restore --from BASELINE` previews
the selected clips or time/track range by default, and applies only with `--apply`.
Its labels, author and expected revision reach the same coordinator. Electron
moves a clip, verifies a diff, previews restoration without editing, applies the
original placement and undoes it. Invalid baselines fail without mutation.

`clips` supports native track, range, media and IDs-only selectors. Readable rows
include ID, displayed track, range, content and disabled state. Electron verifies
the camera track and source media's IDs, and rejects an unknown track. The query
does not change project data or revision.

All 489 tests in 102 files pass with four test workers. Lint, TypeScript and the
production desktop build pass. Reproduction follows the repository's workflow:

```powershell
vp run build:desktop
vp exec --filter @sidecut/web vp dev --host 127.0.0.1 --port 4270 --strictPort
# In another terminal:
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
vp exec --filter @sidecut/desktop electron ../../tests/desktop/verify-cli-analysis.mjs
```

These commands require a running project owner. Wait text reports the final
result rather than streaming native SSE progress. Headless routing and native
path expansion are not added; file references retain the managed service's path
rules. Native macOS/Linux, uncached speech inference and upstream render/audio
comparisons remain unverified. Transport errors retain SideCut codes and stderr
output; findings and job outcomes use their own success/failure exit distinction.
The aggregate format gate retains pre-existing workspace CSS formatting failures.
