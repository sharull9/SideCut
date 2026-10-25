# CLI query commands

Phases 130.08 through 130.12 are verified on Windows against Tandem revision
`735a9b8e162c1f951044baa892d94993869f2e77`. The
[contract fixture](../../tests/fixtures/tandem/cli-queries.json) records pinned
defaults and readable transcript/search examples. The adapters use the existing
authenticated host and shared project services.

## Supported behavior

`status`, `media`, `timeline`, `transcript` and `search` now print readable text
by default. `--json` preserves the service result. Automation that previously
parsed default CLI output must add `--json`. The `project COMMAND` wrapper and
existing endpoint-file, input and request extensions remain available.

`status` reports revision, save state, duration, format, counts, running owner,
undo/redo, recovery, pending review, analysis/export jobs and warnings.
`--revision` prints only the revision number; with `--json` it retains the full
JSON result. App names and review wording use SideCut terminology.

`media` reports IDs, paths, roles, durations, sizes, codec names, Live Photo/take
metadata, picture delays, clip counts, missing files and ordered analysis state.
`--refresh` uses the existing watched-folder import service. Without a selected
folder it fails; with a folder it imports new files through the shared host.

`timeline` defaults to the existing text dump, including `--from`, `--to`,
`--words` and `--summary`. `--json` defaults to the encoded project result.
The existing explicit `--format` extension remains available.

`transcript [ID]` accepts a positional media or clip ID. Without an ID it reports
timeline speech. Ranges retain source times for media and timeline times for
clips. Text groups words at pauses or about twelve words, and reports missing
transcripts. `--make` requires an ID, calls transcribe with `wait:true`, then
queries the transcript after success. `--timeout` forwards its configured wait.
Failed, cancelled or pending transcription returns exit 1 without a subsequent
transcript query. JSON failure output retains the transcription service report.

`search PHRASE` joins positional words with spaces. Existing `--phrase` requests
remain supported. Readable results include context, clip IDs, partial cut hits,
unused source matches and missing transcripts. `--limit 0` returns no hits;
a negative limit leaves the results unbounded, as in the reference service.
Unknown options, excess positionals and missing required arguments fail. Readable
query failures print an error on stderr; `--json` keeps structured errors. Existing
SideCut transport exit codes remain 2 for invalid input, 3 unavailable, 4 stale,
5 not found and 6 unsupported. A failed transcription uses exit 1.

## Verification

`vp run check` passes formatting, lint, TypeScript and all 464 tests in 96 files.
`vp run build:desktop` passes. New tests compare exact pinned transcript/search
text, hour/signed clocks, missing media/analysis, native positional/default
handling, revision-only output and the make-before-query sequence. A loopback
fixture verifies timeout forwarding, failed-make exit 1, no follow-up query after
failure, signed limits and text/JSON usage errors.

The [Electron script](../../tests/desktop/verify-cli-queries.mjs) uses a temporary
profile, a real WAV and a four-word cached transcript. It invokes the CLI as
subprocesses against the authenticated running app and checks all five commands.
Source transcript has four words, the placed clip has two starting at 1.2 seconds,
and a source range selects the two unused words. Search reports one timeline hit,
one unused-source hit and the placed source without a transcript. Cached `--make`
does not change the revision. Text, JSON, invalid ranges, missing IDs, missing
phrases and zero/negative limits pass. Finally, a fixture folder selection and
`media --refresh` add a real WAV as revision 1. Earlier inspection stays at
revision 0.

Observed results are in the [JSON evidence](cli-queries-runtime.json) and the
[editor screenshot](cli-queries-editor.png). Reproduction follows the repository's
Electron acceptance workflow:

```powershell
vp run build:desktop
vp exec --filter @sidecut/web vp dev --host 127.0.0.1 --port 4270 --strictPort
# In another terminal:
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
vp exec --filter @sidecut/desktop electron ../../tests/desktop/verify-cli-queries.mjs
```

## Compatibility limits

- These commands require a running SideCut owner. Headless reference editing and
  native macOS/Linux behavior remain unverified. Installed CLI launchers are not
  retested in this batch.
- Readable output follows the reference structure with SideCut names and existing
  service warnings. Errors retain SideCut's documented transport exit mapping.
  Malformed global parser input can still use the legacy structured error form.
- Runtime uses cached speech. New model downloads, fresh inference and long
  recordings retain the earlier transcription implementation's documented bounds.
  Failure/timeout dispatch is tested with fixture transport.
- The acceptance script retains its disposable profile in Windows temp. It does
  not recursively delete the profile while Chromium may hold files open.
