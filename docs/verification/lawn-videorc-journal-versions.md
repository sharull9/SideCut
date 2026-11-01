# LV035 recording journal versions

Continued the approved release phase on 2026-11-01. LV035 remains in progress.

## Disk compatibility

New recording journal writes include numeric `journalVersion: 1` in `metadata.json`, using the existing exclusive temporary write, flush and atomic rename. The marker belongs only to disk storage. The public recording type, IPC/SDK responses and recording-list entries retain their existing shape.

The recorder accepts version 1 and legacy journals without a marker, then validates their recording fields with the existing contract decoder. Reading a ready legacy journal does not rewrite it. A subsequent normal save adds version 1; startup interruption recovery is one such save. No eager directory migration or media rewrite is performed.

An explicit unsupported version is rejected before recording decoding, startup recovery, retry or saved-recording library access. Listing omits those entries using its existing invalid-journal handling. Direct retry and library deletion reject with `Unsupported recording journal version`, preserving the original journal and media. Numeric future versions, zero/negative/fractional versions, strings, null, objects and arrays are refused. A missing marker means legacy format; it does not mean an invalid explicit marker is accepted.

## Verification

The focused recorder/library suite passes 13 tests. New fixtures confirm ready legacy and version-1 journals remain byte-for-byte unchanged when read, and that the disk marker is absent from returned recording objects. A real synthetic capture checks version-1 saves and recovery of a legacy active journal. Eight unsupported-version fixtures check startup omission, retry/library-deletion refusal, unchanged journal text including unknown metadata, retained source/output bytes and unchanged directory contents. The unsupported-version fixtures need no media executable.

Before the fix, the regression found that startup accepted and rewrote unsupported-version journals and new recordings lacked the marker. Evidence is in `logs/lv035-journal-red.log`.

The [Windows directory-package result](lawn-videorc-journal-versions-windows.json) passes. A production recording saves version 1. Three seeded legacy interrupted journals receive version 1 during restart recovery; existing repair, corruption, published-MP4 and redundant-hard-link checks remain. A fourth seeded version-2 journal is omitted and refused by retry, with its source retained and journal SHA-256 compared across application processes. Evidence records `nativeRecording.diskJournalVersion`, `repair.legacyJournalsUpgraded`, `repair.futureJournalPreserved` and `repair.futureJournalSHA256`.

The default `vp run check` passes all 17 tasks and 722 tests in 149 files; the test run took 45.62 seconds. Production renderer, desktop and client builds and directory packaging pass. Logs are `logs/lv035-journal-tests.log`, `logs/lv035-journal-check.log`, `logs/lv035-journal-build.log`, `logs/lv035-journal-client-build.log`, `logs/lv035-journal-package.log` and `logs/lv035-journal-packaged.log`.

## Refreshed installed and Linux acceptance

The refreshed [Windows NSIS installed result](lawn-videorc-journal-versions-installed-windows.json) passes version-1 saves, legacy restart recovery, future-version preservation and the existing recording/codec, diagnostics, SQLite, archive and CLI checks. The harness verifies its bundled CLI launcher, Unicode/space installation path and uninstall/registration cleanup. Logs are `logs/lv035-journal-installer-build.log` and `logs/lv035-journal-installed.log`. The installer remains unsigned.

The refreshed [Linux unpacked result](lawn-videorc-journal-versions-linux.json) and [installed Debian result](lawn-videorc-journal-versions-installed-linux.json) also pass version-1 saves, legacy restart recovery and future-journal preservation, alongside the earlier repair, corruption, published-MP4, hard-link cleanup, diagnostics and codec checks. The container runs as `node` with no network or host mounts, using the existing disposable Xvfb/D-Bus/keyring session and UTF-8 locale. The harness removes the Debian package afterward; the disposable container was removed after evidence collection.

Linux lint and workspace typechecks pass, along with 722 tests in 149 files in 111.55 seconds using the existing one-worker, 30-second test budget. Production builds and AppImage/deb creation pass. AppImage execution remains unchecked. Logs are `logs/lv035-journal-linux-build.log` and `logs/lv035-journal-linux-runtime.log`. Reproduce with `docker build --progress=plain -f tests/linux/Dockerfile -t sidecut-linux-verification:lv035-journals .` and the offline runtime settings in [Linux container verification](linux-container.md). Minimal-session hostname and desktop-association warnings do not fail the journeys.

## Limits and remaining work

Native macOS and physical Linux capture remain unverified. A version marker does not make older releases enforce this guard or detect an incompatible layout that fails to declare a new version. Existing filesystem race limits still apply; this does not add cross-process journal conflict detection.

Unsupported journals remain on disk and are omitted from current lists; a dedicated migration/recovery UI is not provided. Settings migration, general schema transformations, signing, authenticated updates/rollback, physical/native platform acceptance and full release certification remain open. See [recording recovery](lawn-videorc-recording-repair.md) and [published remux cleanup](lawn-videorc-remux-cleanup.md) for the earlier behavior and platform results.

The later [saved layout preservation checks](lawn-videorc-layout-preferences.md) prevent panel-layout autosave from replacing unreadable settings without an explicit Reset layout action. They cover a separate settings format and do not change journal handling.
