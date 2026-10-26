# CLI asset library, segments and compatibility launcher

Phases 130.42–130.53 are verified as SideCut adapters against Tandem revision
`735a9b8e162c1f951044baa892d94993869f2e77`. The
[pinned text fixture](../../tests/fixtures/tandem/cli-library.json) and
[Electron evidence](cli-library-runtime.json) record the supported behavior.

Asset providers, search, fetch, show, use, credits, generation and starter commands
now map native positionals and options. Search joins positional words and forwards
kind/provider/online/limit filters. Fetch/show/use take an asset ID. Use forwards
time, duration, anchor, pop, label and author to one shared edit. Credits maps
`--optional`; generate accepts kind and quoted prompt with duration/variations.
Readable results preserve IDs, states, licences, credit lines and failures;
`--json` keeps service results. Unsupported options and excess positionals fail
before dispatch, and aliases/input extensions retain their existing service rules.

Electron enumerates 12 providers, searches a local imported icon, fetches its
normalized PNG, reads prompt/model metadata, places it visibly with the CLI author
and undoes it. Credits use the current recorded licence. Starter installation
reports 43 stickers, 32 icons and 15 logos, remains metadata-only and is idempotent.
Unknown kinds/providers/IDs fail without editing.

Generation retains the explicit `confirmedPaid` guard. The CLI defaults it to
false; `--confirmed-paid true` remains an extension rather than an implicit opt-in.
Runtime acceptance replaces only the provider request boundary with a fixture,
then runs the actual generation/normalization/storage path through the CLI.
Two requested variations return one normalized asset and one HTTP-500 failure.
No credentials or paid network request are used. Unconfirmed and unsupported-kind
requests fail before generation.

`segments`, `segments list`, `segments save NAME` and `segments insert NAME` now
validate native command syntax before discovery. Save requires exact clips or a
time range and forwards repeated fields/replace. Insert requires time and forwards
values, mode, label, author and expected revision. Electron saves a two-track
image/title segment with two copied resources, lists it, refuses an accidental
replacement, explicitly replaces it and inserts a filled title with one shared
edit. Undo restores the full project. Saving and listing do not change project
revision. Invalid clip selections, missing segments and missing time fail.

`install-compat --bin-dir FOLDER` is the explicit opt-in compatibility command.
It scans PATH for existing `tandem` commands, refuses foreign files and writes a
wrapper exclusively; it never changes PATH. An identical wrapper is idempotent.
Windows uses a `.cmd` wrapper with the current runtime and adjacent CLI entry;
POSIX uses an executable shell wrapper. Tests create temporary bins, verify
collision refusal and byte preservation, invoke the wrapper and verify repeat
installation. Windows unpacked acceptance also installs in a temporary folder,
prints `sidecut 0.0.1` through the packaged executable and repeats idempotently.
No user/global compatibility command is installed by this acceptance run.

All 494 tests in 104 files pass with four workers. Lint, TypeScript, the production
desktop build and unpacked Windows packaging pass. The new CLI modules are shipped
with the existing runtime dependencies. Reproduction for library acceptance:

```powershell
vp run build:desktop
vp exec --filter @sidecut/web vp dev --host 127.0.0.1 --port 4270 --strictPort
# In another terminal:
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
vp exec --filter @sidecut/desktop electron ../../tests/desktop/verify-cli-library.mjs
```

The library still belongs to the attached browser profile and requires its owner;
native standalone/headless shared-library operation is not added. File metadata
uses managed resource names, and credits retain the service's `Credits` heading.
No live online-provider search ran in this batch. Native macOS/Linux wrappers,
installed application upgrades and upstream native asset/render comparison remain
unverified. Paid live acceptance is separate. The aggregate formatting gate still
fails on pre-existing workspace CSS formatting.
