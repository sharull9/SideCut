# LV035 saved layout preservation

Continued the approved release phase on 2026-11-01. LV035 remains in progress.

## Settings compatibility

The workspace previously treated an unreadable saved panel layout as ordinary defaults. Once preferences finished loading, its autosave effect immediately overwrote the original value with those defaults. This could discard a layout from a newer release or damaged data that the user wanted to recover.

The layout parser now distinguishes an absent setting from an unreadable value. Missing settings use normal defaults and remain writable. A malformed value or unsupported version uses temporary defaults while panel-layout autosave is blocked. Panel resizing and visibility changes still work for the current session. The original saved string remains in SQLite until the user chooses the existing **Reset layout** action, which enables saving a new version-1 layout. Reset is disabled until preferences finish loading.

An accessible status notice appears below the toolbar: **Temporary layout**. It explains that changes will not be saved until Reset layout is chosen. Existing side-tab and keyboard-preference persistence remain independent. Valid version-1 settings retain width clamping and legacy defaults for absent visibility fields. No capture-device selection or streaming credential is newly persisted.

## Verification

The focused panel-sizing suite passes five tests. The parser regression failed before the fix because malformed and future-version values were indistinguishable from absent settings; see `logs/lv035-layout-red.log`. Checks cover damaged JSON, empty strings, unsupported/malformed versions, invalid required fields, legacy visibility defaults, valid width clamping and responsive panel fitting.

The [Windows production directory-package result](lawn-videorc-layout-preferences-windows.json) passes. Its renderer fixture writes three unreadable values through the real SQLite storage bridge: a future-version layout with unknown data, damaged JSON and version 1 with an invalid field. For each, it reloads the production renderer, checks the notice and unchanged stored string, resizes the media panel through its keyboard handler, reloads again and confirms preservation. It then chooses Reset layout and verifies a new version-1 value is saved. Subsequent ordinary resizing survives another reload. The journey runs in both application processes, alongside existing journal compatibility, recording/codec/recovery, diagnostics, SQLite, archive and CLI checks.

Evidence records `panelPreferences.unreadableCases`, `originalPreserved`, `temporaryResize`, `resetPersisted`, `resizePersisted` and `reloaded`. The fixture uses a disposable app profile; it does not change the user's preferences.

The default `vp run check` passes all 17 tasks and 723 tests in 149 files; the test run took 43.36 seconds. Production renderer, desktop and client builds and directory packaging pass. Logs are `logs/lv035-layout-check.log`, `logs/lv035-layout-build.log`, `logs/lv035-layout-client-build.log`, `logs/lv035-layout-package.log` and `logs/lv035-layout-packaged.log`.

## Refreshed installed and Linux acceptance

The refreshed [Windows NSIS installed result](lawn-videorc-layout-preferences-installed-windows.json) also passes all three unreadable-layout cases, temporary resizing, preservation across reloads, explicit reset and ordinary resize persistence. The harness verifies the bundled CLI launcher, Unicode/space installation path and uninstall/registration cleanup. Logs are `logs/lv035-layout-installer-build.log` and `logs/lv035-layout-installed.log`. The installer remains unsigned.

The refreshed [Linux unpacked result](lawn-videorc-layout-preferences-linux.json) and [installed Debian result](lawn-videorc-layout-preferences-installed-linux.json) also pass all three unreadable-layout cases, temporary resizing, preservation across reloads, explicit reset and ordinary resize persistence. Existing recording/journal/recovery, diagnostics, codec, SQLite, archive and CLI checks pass in both journeys. The application runs as the container's `node` user without network or host mounts, using the existing disposable Xvfb/D-Bus/keyring session and UTF-8 locale. The harness removes the Debian package afterward; the disposable container was removed after evidence collection.

Linux lint and workspace typechecks pass, along with all 723 tests in 149 files in 110.02 seconds using the existing one-worker, 30-second test budget. Production builds and AppImage/deb creation pass; AppImage execution remains unchecked. Logs are `logs/lv035-layout-linux-build.log` and `logs/lv035-layout-linux-runtime.log`. Reproduce with `docker build --progress=plain -f tests/linux/Dockerfile -t sidecut-linux-verification:lv035-layout .` and the offline runtime settings in [Linux container verification](linux-container.md). Minimal-session hostname and desktop-association warnings do not fail the journeys.

## Limits and remaining work

Native macOS and physical Linux capture remain unverified. This protects the value loaded during preference hydration; it does not add concurrent-tab conflict detection, repair damaged settings or migrate a future layout schema. The existing localStorage-to-SQLite preference migration remains unchanged.

General settings/library migrations, broader abandoned-file recovery, signing, authenticated updates/rollback, physical/native platform acceptance, support UI and full release certification remain open. Earlier [journal version checks](lawn-videorc-journal-versions.md) and [recording recovery](lawn-videorc-recording-repair.md) retain their separate evidence and limits.
