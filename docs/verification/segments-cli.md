# Segments and CLI project-command acceptance

Subphases 129.09–129.11 and 130.01–130.07 are implemented and accepted within
the Windows bounds below. Work was divided between `codex` and
`codex_codex_personal` workers using GPT-6.1 Sol, medium reasoning and priority
service. The personal-account interruption was recovered, and its acceptance
work resumed after the account limit reset.

The detailed source contracts and unit evidence are in
[segments and CLI foundations](segments-cli-foundation.md) and
[project commands](cli-project-commands.md). Their fixtures cite pinned Tandem
revision `735a9b8e162c1f951044baa892d94993869f2e77` and distinguish synthetic
expectations from captured reference responses.

Combined validation on Windows on 2026-10-25:

- `vp run check`: formatting, lint, workspace type checks and 461 tests in 95 files pass.
- `vp run build:desktop`: passes.
- `vp exec --filter @sidecut/desktop electron ../../tests/desktop/verify-segments-cli.mjs`: passes against the real editor, authenticated HTTP and CLI subprocesses.
- `git diff --check`: passes.

The Electron journey creates a portrait project with eight tracks and verifies
its snapshot and visible editor name. It minimizes the window and confirms
`app` restores it. It reads the offline edit schema and authenticated service
schema, saves a title as a parameterized segment without changing the revision,
lists it as JSON and readable text, inserts an override as one revision, opens
the actual text inspector and checks its value, then undoes the insertion.
Unknown save clips return 404 and stale inserts return 409 without editing.

It also imports separate EDL/recipe files and the synthetic Filmora ZIP through
native positional commands. Both write exclusive project snapshots and appear
in the editor. The renamed Filmora project survives page reload with valid
history. Runtime results are in [segments-cli-runtime.json](segments-cli-runtime.json)
and the final editor image is [segments-cli-editor.png](segments-cli-editor.png).
The missing camera source in that image belongs to the synthetic import fixture;
no personal footage was used.

To reproduce, run the desktop build, start `vp dev --host 127.0.0.1 --port 4270
--strictPort` from `apps/web`, unset `ELECTRON_RUN_AS_NODE`, then run the Electron
command above. It uses a disposable profile. The initial visual assertion looked
for title text in timeline labels; labels show clip names/IDs. Acceptance now
selects the inserted clip and checks its text inspector value. No product change
was needed for that assertion.

The CLI merge uses the shared parser once, then passes parsed words/options to
the project-command normalizer. This preserves short aliases, global options,
negative numbers and the option terminator. Offline schema remains independent
of discovery; `schema --service` retains service discovery. Packaging copies
both helpers and the generated schema.

The CLI requires the running shared host for edits. Headless ownership, native
macOS/Linux and installed-launcher execution remain unverified. Segment storage
uses virtual paths in SideCut's durable library. Import recipe catalogues,
comparison imports, arbitrary search/path rewrites, native import directory
layout and exact Swift text formatting remain outside this acceptance. The
reports above record detailed media, staging and resource limits. No PR, push,
provider network call or paid generation was performed.

Electron exited after verification. Cleanup of its two disposable profiles was
incomplete; a subsequent bounded PowerShell removal was rejected by automatic
approval review with "blocked by policy". The profiles remain in the Windows
temporary directory with names `sidecut-segments-cli-jRGw7W` and
`sidecut-segments-cli-ZoAci2`. Normal user profiles were not used.
