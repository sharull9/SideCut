# CLI apply

Phase 130.19 is verified on Windows against Tandem revision
`735a9b8e162c1f951044baa892d94993869f2e77`. The
[contract fixture](../../tests/fixtures/tandem/cli-apply.json) records readable
results derived from the pinned CLI, service types and readable-result source.

`apply FILE`, `apply 'JSON'` and `apply -` accept a batch object, command list or
single command. `-` reads stdin to EOF. Paths resolve from the working directory,
including names containing spaces. `project apply` is an equivalent invocation.
Existing `--input FILE`, `--request JSON` and `--commands JSON` extensions remain;
exactly one source is allowed.

Apply commits by default. `--dry-run` checks the batch on a copy without changing
project data, revision or undo history. Native `--label`, `--author`, `--expect`
and `--key` flags override their JSON batch fields. `--key` maps to the existing
idempotency key; `--idempotency-key` remains available. Conflicting key aliases,
multiple sources, excess positionals and unsupported flags fail before discovery.
Malformed JSON and scalar inputs fail before any host request.

The author defaults to `SIDECUT_AUTHOR`, then `TANDEM_AUTHOR`, then `cli`, when the
batch and flags supply no author. Readable output is the default; `--json` retains
the service result. Text includes dry-run or repeated status, label, author,
revision, up to twelve created IDs, clip changes, timeline duration and warnings.
JSON includes every created ID.

## Verification

`cli-apply.test.ts` compares pinned text and the created-ID display limit. Actual
CLI subprocesses use the real authenticated host and project store to verify file,
inline, stdin and extension inputs, field overrides, dry-run nonmutation, stale
rejection, idempotent retries, atomic failures and one-step undo. Invalid JSON,
scalar values, mixed-operation commands and a batch whose second operation fails
leave the committed project unchanged.

The [Electron acceptance script](../../tests/desktop/verify-cli-apply.mjs) starts a
fresh profile and attached editor. A file preview creates no edit. A stdin batch
creates a track and three-second solid clip and renames the project at revision 1.
The editor observes the new name and clip. Retrying the key changes nothing; stale
and failing requests also leave the project unchanged. One undo restores the
complete original project. An inline single command then applies at revision 3
with the environment author and undoes at revision 4. See the
[runtime evidence](cli-apply-runtime.json).

Reproduction follows the repository's Electron workflow:

```powershell
vp run build:desktop
vp exec --filter @sidecut/web vp dev --host 127.0.0.1 --port 4270 --strictPort
# In another terminal:
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
vp exec --filter @sidecut/desktop electron ../../tests/desktop/verify-cli-apply.mjs
```

Lint, TypeScript, the production desktop build and all 473 tests in 98 files pass.
Windows unpacked packaging passes with `scripts/package-desktop.mjs --dir`; the
bundled `resources/cli/sidecut.cmd apply --help` runs with the packaged executable
and loads the new adapter successfully.
The full test run uses `vp test run --maxWorkers=4`. Changed files pass formatting;
the repository formatting check still fails on pre-existing
`apps/web/src/modules/workspace/workspace.css` formatting.

## Limits

Apply requires a running authenticated project owner. This phase does not add
headless editing or a second coordinator. The packaged CLI file list now includes
the new apply adapter. Installed launcher execution and native macOS/Linux
acceptance remain unverified in this phase.

Service defaults retain the `Agent edit` label when none is supplied, rather than
inferring a label from the command catalogue. SideCut's single-operation command
schema remains strict; combined-operation shorthand is not expanded. Error output
and exit codes retain adapter conventions: bad requests return 2 and stale
revisions return 4, rather than native service error code 1. JSON errors go to
stderr. Native Tandem execution and complete command/render parity remain open.
