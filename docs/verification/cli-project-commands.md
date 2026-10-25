# CLI project commands

This implements subphases 130.03–130.07 on the Windows desktop host. The pinned
reference is `735a9b8e162c1f951044baa892d94993869f2e77`; the synthetic contract is
`tests/fixtures/tandem/cli-project-commands.json`. It records source expectations,
not responses captured from Swift.

`new <path>` accepts `--name`, `--portrait`, `--size WIDTHxHEIGHT` and `--json`.
The default canvas is 3840×2160 with the editor's eight standard tracks. Paths
gain `.tandem`; an existing directory uses `<directory>/<directory>.tandem`.
Outputs use exclusive creation and must remain within the managed project
folder. Existing files, reserved names, traversal, invalid sizes and stale
revisions fail before project replacement. Positional invocations obtain the
current revision and send it as the replacement guard; explicit `--expect`
overrides it. Low-level service calls continue to require expectedRevision.

`app` focuses and restores the running native editor without editing. With no
discovery file, it launches `SIDECUT_APP_EXECUTABLE`, or the packaged SideCut
executable when the CLI is running under it. It clears ELECTRON_RUN_AS_NODE and
uses a detached hidden process. The executable must be an existing absolute
path. Opening an arbitrary second project/window is explicitly unsupported;
guarded `project open --path` remains available. No personal installed app was
launched during unit acceptance; Electron acceptance checks actual focus.

`schema` works without a server and prints the generated edit-batch document,
including every typed edit command. Its checked-in copy is tested against the
contracts. `schema --service` retains the authenticated service schema extension.
Packaging includes both the command helper and schema snapshot.

`import edl <edl.json> --recipe <recipe.json>` and
`import filmora <source.wfp> [--keep-levels]` use the existing importers and the
shared host. Optional `--name` and `--out` set the imported name and write an
exclusive snapshot. Renaming preserves replayable history. EDL and recipes are
bounded at 20 MiB; Filmora retains the existing folder/ZIP metadata limits.
Malformed input leaves the active editor unchanged. Import reports are returned
with JSON and included in readable output. Legacy wrapper imports still work.

Focused acceptance covers real authenticated HTTP and CLI subprocesses: new
project defaults and portrait settings, directory naming, overwrite/traversal
failures, stale revision, EDL and Filmora import, replayable renamed history,
malformed-input nonmutation, app activation and offline schema. Full branch
`vp run check` passed 448 tests in 94 files before integration.

Bounds: these commands use the running host rather than a second headless
project authority. New media discovery remains explicit (`media --refresh`).
Built-in EDL recipes, compare imports, native import directory/report conventions,
arbitrary search roots and path rewrites are not implemented here. Native
macOS/Linux launch, installed launcher and reference-runtime comparisons remain
unverified. The parent records combined build and Electron acceptance separately.
