# LV035 local support diagnostics

Continued the approved release phase on 2026-11-01. LV035 remains in progress.

## Use

With a desktop project open, run:

```sh
node scripts/sidecut-cli.mjs diagnostics --output sidecut-support.json --json
```

The installed CLI also accepts `diagnostics --output sidecut-support.json --json`. The SDK exposes `client.diagnostics({ output: "sidecut-support.json" })`; the authenticated local service exposes `POST /v1/diagnostics`. Omitting `output` returns the report without writing a file. Service schema discovery lists the accepted field. No additional listener, provider account, upload or telemetry is involved.

The output is a versioned JSON support report in the project's `exports` folder. Existing files are never overwritten. Traversal and unsafe output folders use the existing output guard. Cancellation stops collection or output, and the normal output writer removes a partially written file. The operation does not edit the project, start/stop capture or inspect devices.

Share the generated JSON file. The command response also includes the local output location when a file is requested; that response wrapper is not the support report.

## Report boundary

The report is constructed from selected technical fields:

- Platform/architecture, Node/Electron/Chromium versions and process memory totals.
- Renderer readiness and whether native media processing is configured. Configuration does not prove an executable or device works.
- Project schema/revision, save state, a save-error boolean, canvas/frame-rate numbers and media/track/clip counts.
- Validation error/warning totals, without messages or object IDs.
- Current-project recording counts by state, or an unavailable marker if journals cannot be read.

It excludes project/media/recording IDs, titles, paths, source bytes, clip/text/caption content, comments, metadata, device names, URLs, credentials, discovery tokens, environment variables and logs. Unknown metadata on retained schema objects is not copied. Raw save/journal errors are reduced to booleans or availability. Counts and timestamps remain technical project information; the user chooses whether to share the file.

This is a compact support report, not a log archive, media repair operation, integrity scan or automatic support upload. No free-space/device performance/signing result is inferred from it.

## Acceptance and remaining release work

Four focused fixtures cover the real host/HTTP/SDK/CLI path, hostile project/media/settings metadata, discovery-token exclusion, selected-project recording summaries, raw error exclusion, output traversal/overwrite refusal, cancellation and unchanged project state.

The packaged verifier now requests a support file from the real local service, reads it from the guarded exports folder, checks its format/counts and confirms the profile path, discovery token, title and media filename are absent. Existing recording, codec, SQLite, archive and restart checks remain in that journey.

The [Windows directory-package result](lawn-videorc-release-diagnostics-windows.json) passes and includes the generated support report under `support.report`. Production renderer, desktop and SDK builds pass. Lint and all workspace typechecks pass. The full suite passes 716 tests in 149 files with `vp test run --maxWorkers=1 --testTimeout=30000` in 141 seconds. The four focused support tests pass again after the final escaped-path checks.

The default four-worker `vp run check` passed formatting, lint and typechecks but hit 11 existing CLI, MCP and streaming failures under load. The one-worker run passed without changing assertions. This runner budget does not establish performance acceptance. Logs are `logs/lv035-check.log`, `logs/lv035-tests-serial.log`, `logs/lv035-support-tests.log`, `logs/lv035-lint.log`, `logs/lv035-types.log`, `logs/lv035-build-desktop.log`, `logs/lv035-build-client.log`, `logs/lv035-package-windows.log` and `logs/lv035-packaged.log`.

The initial diagnostics slice verified the Windows directory package. The later recovery slice also passes the [refreshed Windows NSIS installed journey](lawn-videorc-recording-repair-installed-windows.json), including support-report checks and uninstall cleanup. Its default workspace check passes 718 tests in 149 files. Refreshed Linux [unpacked](lawn-videorc-recording-repair-linux.json) and [installed Debian](lawn-videorc-recording-repair-installed-linux.json) journeys also pass support-report and recovery checks in the offline container. Linux lint, typechecks and all 718 tests pass with the existing one-worker, 30-second test budget. See the [recovery report](lawn-videorc-recording-repair.md) for runtime conditions, logs and limits. Native macOS remains unverified.

Signing/notarization, authenticated updates/rollback, physical/native platform gates, complete end-to-end capture/live/review journeys, broader corruption/repair acceptance, recording-library/settings migrations and release certification remain open. The later [desktop support-report UI](lawn-videorc-support-ui.md) passes Windows unpacked/NSIS and Linux container unpacked/deb acceptance, alongside 725 tests on each platform. This change does not certify parity or distribute a release.

The later [recording recovery checks](lawn-videorc-recording-repair.md) add canonical-path guards, restricted repair input and packaged restart/corruption fixtures. Their latest Windows unpacked/NSIS and Linux container unpacked/deb runs also pass matching published-MP4 recovery and support diagnostics, with 719 tests on each platform. Their evidence and limits are recorded separately.

The later [newer SQLite database preservation fix](lawn-videorc-future-database.md) rejects unsupported database versions before enabling WAL. Windows directory-package checks preserve DELETE- and WAL-mode version-2 database bytes across rejected access and restart; 727 workspace tests pass. Refreshed installed Windows and Linux unpacked/deb/AppImage extract-and-run acceptance also pass for that pre-branding snapshot.
