# CLI watch, effects, archive, relink and check

Phases 130.30–130.34 are verified against pinned Tandem revision
`735a9b8e162c1f951044baa892d94993869f2e77` within the adapter limits below.
[Pinned examples](../../tests/fixtures/tandem/cli-resources.json) cover readable
results; [runtime evidence](cli-resources-runtime.json) records Windows Electron
acceptance through actual CLI subprocesses.

`watch` now follows revision events until interrupted. Text includes timestamps,
revision, kind, label and author; JSON emits one event per line. `--once` retains
the complete long-poll result, including the readable no-change message. The
existing revision/generation/follow extensions remain. Native timeout clamping
is retained. Empty polls are throttled, and disconnecting the CLI cancels the
host waiter. Tests and Electron observe a real edit and cancel the follower.
This transport reports revision events rather than native SSE job/export events;
there is no automatic retry after a network error.

`effects [TYPE]` reads a shipped catalogue without project discovery or a running
host. Type filtering is case-insensitive; unknown types return 5. The catalogue
is compared with the authoritative core definitions on every test run. Readable
output includes effect parameters, defaults, ranges, transitions, layouts and
animation paths. The pinned inventory contains 15 effects. To intentionally
regenerate the file, run the CLI-resource tests with
`SIDECUT_UPDATE_EFFECTS_CATALOG=1`; normal tests never rewrite it.

`archive [PROJECT]` maps its optional positional project to discovery. Native
`--to`, `--with-cache`, `--dry-run` and `--label` flags use the existing folder
copy/consolidation service; `--with-cache` requires a destination. The existing
ZIP `--output` extension remains. Electron verifies a preview that writes
nothing, an actual standalone copy with manifest and resources, refusal to
replace the copy, and consolidation that undoes in one shared edit. Implicit
discovery now excludes the generated `archive-<12 hex digits>-project.tandem`
recovery snapshot, so consolidation does not redirect subsequent CLI commands
to that snapshot. Explicit path selection retains its existing owner checks.

`relink` forwards repeated `--search`, dry-run, label, author and expected-revision
options. Readable plans report matches, remaining/ambiguous files, scanned
folders and the next action. Electron creates an actual WAV in a search folder,
previews its match, applies the new media path at revision 2, observes it in the
editor, rejects a stale revision and restores the original project with undo.
The preview and missing-directory failures do not change the project.

`check` maps native range, changed/quick/cuts and width flags. Readable output
includes checked ranges, frame/cut counts, problems, notes, warnings and available
fix batches. `--quick --cuts` fails before discovery. Findings return exit 1 when
`ok` is false in text and JSON, while notes alone do not fail the command.
Electron verifies quick checks, six rendered frames, invalid width/options and a
black-picture problem after removing the fixture's video clip. Checks are
read-only; the fixture edit is undone afterward.

All 486 tests in 101 files pass with four test workers; TypeScript passes.
The harness follows the established workflow:

```powershell
vp run build:desktop
vp exec --filter @sidecut/web vp dev --host 127.0.0.1 --port 4270 --strictPort
# In another terminal:
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
vp exec --filter @sidecut/desktop electron ../../tests/desktop/verify-cli-resources.mjs
```

Archive collection retains its managed-resource bounds rather than copying host
profiles, credentials, native recorder sidecars or every system font. Human byte
sizes use decimal units, with platform formatting differences from macOS's
ByteCountFormatter. Relink copies remain bounded by the existing scanner/resource
limits. Readable archive text exposes these warnings; JSON preserves the service
result. Native transport error codes, SSE progress, native macOS/Linux and upstream
filesystem/render comparisons remain unverified. The repository-wide formatting
gate still fails on pre-existing workspace CSS formatting.
