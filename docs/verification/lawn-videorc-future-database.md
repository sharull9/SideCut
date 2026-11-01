# LV035 newer SQLite database preservation

Continued the approved release phase on 2026-11-01. LV035 remains in progress.

## Compatibility fix

The shared repository already rejects SQLite databases whose `user_version` is neither 0 nor 1. The native connection previously enabled WAL before constructing that repository. A refused version-2 database in DELETE journal mode therefore had its persistent journal format changed before the error was reported. A disposable probe confirmed its header changed from DELETE to WAL even though the schema and data were retained; see `logs/lv035-future-db-probe.log`.

Native connections now set their connection-local busy timeout, construct the repository to validate the version, and only then enable WAL and full synchronous writes. Unsupported versions are refused before those persistent pragmas run. Supported databases retain the existing schema initialization, timeout, WAL and synchronous settings. Both the native library and host project store use this connection function.

This does not migrate an unsupported schema or make newer settings readable. The refusal asks the user to use a newer version. The subsequent raE.E branding update changes the displayed product name in that message without changing the refusal behavior.

## Verification

Two regression fixtures seed version-2 databases in DELETE and WAL modes, each with a newer table and sentinel data. They exercise direct connection, library construction and host project loading, confirm refusal, compare complete database bytes and check the retained version, journal mode, table names and data. Direct/library refusals also leave directory contents unchanged. The DELETE fixture failed before the fix; see `logs/lv035-future-sqlite-red.log`.

The focused SQLite/project/review suites pass 20 tests. The full workspace suite passes 727 tests in 150 files in 50.46 seconds. Lint, all workspace typechecks and production renderer, desktop and client builds pass. The full `vp run check` stops on the previously recorded formatting issues in unrelated `apps/web/src/modules/cloud/config.test.ts` and `scripts/verify-cloud-teams.mjs`; those files were left unchanged by this task. Targeted formatting passes.

The packaged verifier seeds both journal modes in its disposable profile, refuses access through the native connection, library and project store, then compares database bytes. It repeats those checks in the second application process and compares database SHA-256 values across processes. Project-store lock bookkeeping remains separate from the preserved database. Normal application migration, save and restart continue through the existing journey.

The [Windows directory-package evidence](lawn-videorc-future-database-windows.json) passes. It records `futureDatabase.cases: 2`, `refused`, `bytesPreserved`, `filesPreserved` and matching hashes across restart. Existing support-report privacy/download cleanup, recording/recovery/journal/layout, codec, SQLite, archive and bundled CLI checks also pass.

## Refreshed installed and Linux acceptance

The refreshed [Windows NSIS installed evidence](lawn-videorc-future-database-installed-windows.json) passes both journal-mode cases and unchanged hashes across restart, alongside the existing packaged journey. The harness verifies its bundled CLI launcher and Unicode/space installation path, uninstalls the test package and confirms registration cleanup. The installer remains unsigned. Logs are `logs/lv035-future-sqlite-installer-build.log` and `logs/lv035-future-sqlite-installed.log`.

The refreshed [Linux unpacked evidence](lawn-videorc-future-database-linux.json), [installed Debian evidence](lawn-videorc-future-database-installed-linux.json) and [AppImage extract-and-run evidence](lawn-videorc-future-database-appimage-linux.json) all pass both preservation cases and unchanged hashes across restart. Existing support-report, recording/recovery/journal/layout, codec, SQLite, archive and CLI checks also pass. The AppImage result records its artifact SHA-256 and execution mode; FUSE mounting remains unverified.

The Linux image passes lint, workspace typechecks and 727 tests in 150 files in 118.73 seconds using the existing one-worker, 30-second test budget. Production builds and AppImage/deb packaging pass. The runtime runs as `node`, offline without host mounts, using the existing Xvfb/D-Bus/keyring session, UTF-8 locale and sandbox allowances. The Debian package and disposable container are removed after verification. Build/runtime logs are `logs/lv035-future-sqlite-linux-build.log` and `logs/lv035-future-sqlite-linux-runtime.log`. Reproduce with image `sidecut-linux-verification:lv035-future-sqlite`, the settings in [Linux container verification](linux-container.md) and `tests/linux/run-appimage-session.sh` for the AppImage journey.

These refreshed artifacts were built from the SQLite-fix snapshot before the later main-branch merge and raE.E branding changes. They establish preservation behavior for that snapshot; branding acceptance is recorded separately.

Logs are `logs/lv035-future-sqlite-tests.log`, `logs/lv035-future-sqlite-all-tests.log`, `logs/lv035-future-sqlite-lint.log`, `logs/lv035-future-sqlite-types.log`, `logs/lv035-future-sqlite-check.log`, `logs/lv035-future-sqlite-build.log`, `logs/lv035-future-sqlite-client-build.log`, `logs/lv035-future-sqlite-package.log`, `logs/lv035-future-sqlite-packaged.log` and `logs/lv035-future-sqlite-format.log`.

## Limits

These fixtures use closed, consistent databases. They do not establish byte preservation during SQLite crash recovery or concurrent writes by another process. General library/settings migrations, signing, authenticated updates/rollback, physical-device/native macOS acceptance and full release certification remain open.
