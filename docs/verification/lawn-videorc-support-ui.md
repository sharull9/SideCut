# LV035 desktop support report

Continued the approved release phase on 2026-11-01. LV035 remains in progress.

## Desktop action

Open **Checks** in the desktop editor and choose **Create support report**, then **Download support report**. The JSON download is named `sidecut-support.json`. The page explains what the report contains and that sharing is a separate choice. Creation provides an accessible pending status, disables the button while running, and shows a generic retry message on failure without displaying native errors.

The action uses a dedicated no-argument preload method and trusted-main-frame IPC handler. The handler invokes the existing diagnostics collector with fixed empty options and returns only the report JSON. It rechecks the sender after collection. No service token, endpoint, response wrapper or output path is sent to the renderer. The existing authenticated service, SDK and CLI behavior is unchanged.

The report contains selected runtime/service information and technical project counts. It excludes project content, paths, credentials and raw logs/errors, using the existing [report boundary](lawn-videorc-release-diagnostics.md#report-boundary). Creation does not write into the project or its exports folder. The renderer creates a local JSON Blob for the download and revokes its URL when replaced or when the page closes. Completion after page unmount is ignored.

## Verification

The full `vp run check` passes all 17 tasks and 725 tests in 150 files. The test run took 44.76 seconds. After adding navigation/destruction checks to the IPC fixture, the six focused support/IPC tests and workspace typechecks pass again. The fixtures use real host storage and collector behavior, mocking only the Electron IPC boundary. They verify no-argument enforcement, trusted main-frame access, unavailable-service refusal, navigation/destruction during collection, unchanged project/files and report-only output. Existing collector tests cover hostile metadata and credential/raw-error exclusion.

Production renderer, desktop and client builds and Windows directory packaging pass. The [Windows directory-package evidence](lawn-videorc-support-ui-windows.json) records `supportUI.downloaded`, `contentExcluded`, `replacementRevoked`, `unmountRevoked` and `projectUnchanged` as true. The packaged renderer opens Checks through its navigation link, creates the report, reads the offered Blob with its JSON MIME type and download filename, verifies format/version/counts and exclusion of the profile path, discovery token, project title and media filename, then creates a second report and returns to the editor. Both discarded URLs become unreadable, and the project snapshot is unchanged. The harness reads the download in its disposable profile rather than saving into the user's Downloads folder.

Existing recording/recovery/journal/layout, codec, archive, SQLite, CLI and restart checks also pass in that journey. Logs are `logs/lv035-support-ui-check.log`, `logs/lv035-support-ui-tests.log`, `logs/lv035-support-ui-types.log`, `logs/lv035-support-ui-build.log`, `logs/lv035-support-ui-client-build.log`, `logs/lv035-support-ui-package.log` and `logs/lv035-support-ui-packaged.log`.

## Installed Windows acceptance

The refreshed [Windows NSIS installed evidence](lawn-videorc-support-ui-installed-windows.json) passes the same support-report creation, privacy, replacement/unmount URL cleanup and unchanged-project checks. The existing recording/recovery/journal/layout, codec, SQLite, archive, CLI and restart checks also pass. The harness installs into a disposable Unicode/space path, verifies the bundled CLI launcher, uninstalls the package and confirms registration cleanup. It refuses to replace an existing registered SideCut installation. The installer remains unsigned. Logs are `logs/lv035-support-ui-installer-build.log` and `logs/lv035-support-ui-installed.log`.

## Linux acceptance

The refreshed Linux image passes lint, workspace typechecks and all 725 tests in 150 files using the existing one-worker, 30-second test budget. The test run took 112.83 seconds. Production renderer, desktop and client builds and AppImage/deb creation pass. The subsequent [AppImage journey](lawn-videorc-appimage.md) also passes in extract-and-run mode; FUSE mounting remains unchecked. The build log is `logs/lv035-support-ui-linux-build.log`; reproduce with `docker build --progress=plain -f tests/linux/Dockerfile -t sidecut-linux-verification:lv035-support-ui .`.

The refreshed [Linux unpacked evidence](lawn-videorc-support-ui-linux.json) and [installed Debian evidence](lawn-videorc-support-ui-installed-linux.json) both pass support-report creation, JSON download, privacy exclusions, replacement/unmount URL cleanup and unchanged-project checks. Existing recording/recovery/journal/layout, codec, SQLite, archive, CLI and restart checks also pass. The application runs as the container's `node` user with no network or host mounts, using the existing disposable Xvfb/D-Bus/keyring session and UTF-8 locale. The Debian package is removed afterward; the disposable container was removed after saving evidence. Minimal-session D-Bus, hostname and desktop-association warnings do not fail either journey. The runtime log is `logs/lv035-support-ui-linux-runtime.log`. Runtime settings and their limits are documented in [Linux container verification](linux-container.md).

The refreshed evidence and documentation pass targeted formatting and diff checks. A final repository-wide formatting check reports issues in the unrelated `apps/web/src/modules/cloud/config.test.ts` and `scripts/verify-cloud-teams.mjs`; those files were left unchanged by this verification task. Logs are `logs/lv035-support-ui-platform-format.log` and `logs/lv035-support-ui-platform-format-targeted.log`.

## Limits

Native macOS, physical-device acceptance, signing, authenticated updates/rollback, general settings/library migrations, broader abandoned-file recovery and full workflow certification remain open. The generic UI failure message is implemented but was not induced in the packaged journey. This change does not certify parity or distribute a release.
