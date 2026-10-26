# CLI section cards

Phase 130.18 is verified on Windows against Tandem revision
`735a9b8e162c1f951044baa892d94993869f2e77`. The
[contract fixture](../../tests/fixtures/tandem/cli-cards.json) derives flag mappings
and readable examples from the pinned CLI and `SectionCards.swift` source.

`cards` and `project cards` now print readable plans by default. `--json` preserves
the service result. Repeated `--marker ID` options select markers; `--no-sounds`
maps to `sounds: false`. Duration, kicker, track, insert mode, label, author and
expected revision reach the existing service. Preview remains the default;
`--apply` commits through the shared host. Existing `--markers` JSON and `--sounds`
extensions remain available, with conflicting aliases rejected.

Readable output includes card numbers, titles, subtitles, marker times, coverage,
shifted take cuts, existing-card renumbering, sound status, warnings and undo
instructions. Excess positionals and unsupported command options fail before
project discovery. Generic parser errors retain the existing JSON error envelope.

## Verification

`cli-helpers.test.ts` compares pinned text, native flag mappings, conflicting
aliases, preview defaults and the unavailable-editor failure without mutation.
Lint, TypeScript and the production desktop build pass.

The [Electron acceptance script](../../tests/desktop/verify-cli-cards.mjs) runs the
actual CLI against an authenticated desktop host and attached editor in a fresh
temporary profile. It verifies two-card previews without changes, repeated marker
selection, duration/kicker/track mapping and insertion beside cached speech. The
selected marker at 2 seconds moves its take cut to the pause at 1.8 seconds.

Applying two cards creates revision 1 with the requested author and label, and both
cards appear on Graphics in the editor. A stale expected revision returns exit 4
without changing that project. Querying again reports the existing card. One undo
restores the complete original project. Insert mode applies at revision 3 and also
undoes in one step. Invalid duration, missing marker, audio-track destination,
unsupported option and extra positional cases leave project data and revision
unchanged. Exact results are recorded in [runtime evidence](cli-cards-runtime.json).

Reproduction uses the repository's Electron acceptance workflow:

```powershell
vp run build:desktop
vp exec --filter @sidecut/web vp dev --host 127.0.0.1 --port 4270 --strictPort
# In another terminal:
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
vp exec --filter @sidecut/desktop electron ../../tests/desktop/verify-cli-cards.mjs
```

## Limits

Cards require an attached editor. Cached speech supplies the pause calculation;
this run does not download models or acquire whoosh assets. Sound-library behavior
retains the [existing service verification](render-review.md). Native macOS/Linux
CLI execution and native Tandem output comparisons remain unverified.

Transport exit codes retain SideCut's conventions: invalid duration and missing
marker errors from the renderer return unavailable (3), while the invalid track
returns not found (5). Unsupported options and excess positionals return 2. These
codes differ from native reference errors and are not claimed as exact parity.

The aggregate `vp run check` stops on pre-existing formatting in
`apps/web/src/modules/workspace/workspace.css`. The first full test run passed
469 of 470 tests; the existing CLI query subprocess test exceeded its five-second
deadline and its cleanup encountered a Windows file lock. That test passed alone.
The full-suite retry with `vp test run --maxWorkers=4` passes all 470 tests in
97 files.
