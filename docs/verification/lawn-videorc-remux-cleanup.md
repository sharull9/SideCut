# LV035 published remux cleanup

Continued the approved release phase on 2026-11-01. LV035 remains in progress.

## Behavior

A process killed after publishing `recording.mp4` can leave the original `remux-<UUID>.mp4` name pointing to the same file. Successful explicit retry already validates the source and reconciles a matching published output. It now also removes these redundant hard links after saving the ready journal.

Cleanup accepts only a regular file at its canonical path, named `remux-<version-4 UUID>.mp4`, with the same device and nonzero inode as the verified published MP4. File identities use bigint filesystem values. A matching filename or matching bytes alone does not qualify. Cleanup is best effort: a filesystem error leaves remaining candidates in place without changing a committed recording back to error.

Startup listing and failed repair leave these files alone. Partial remuxes, independent copies, source hard links, directories, symbolic links/junctions, unknown names and metadata remnants are preserved. The MKV, final MP4 and journal remain. This is a targeted unlink operation after successful finalization, not a recursive directory sweep. It does not reconcile arbitrary abandoned files or protect against adversarial filesystem changes between checks and operations.

## Regression and package evidence

The regression creates a real synthetic recording and a remux hard link to its published MP4, seeds a stopping journal and opens a fresh recorder. It confirms that listing and a failed repair preserve every fixture. Successful retry removes only the recognized duplicate link, preserves the output's bytes, inode and modification time, retains the source and saves a ready journal. The fixture also preserves an independent byte-identical remux, partial media, an unknown hard-link name, a source hard link, metadata remnants, a directory and a directory link. The original failure is recorded in `logs/lv035-orphan-red.log`.

The [Windows directory-package result](lawn-videorc-remux-cleanup-windows.json) passes. The packaged verifier stages a real remux hard link alongside the synthetic published MP4 before exit. A fresh process confirms the link still exists after listing, then repairs the journal, removes the redundant link and preserves the published MP4. Evidence records `nativeRecording.repair.publishedRemuxRemoved`, alongside existing publication/source/corruption and renderer codec checks. The fixture seeds a crash state; it does not kill the process during publication or simulate power loss.

The default `vp run check` passes all 17 tasks and 720 tests in 149 files; the test run took 47.80 seconds. The focused recorder/library suite passes 11 tests. Production renderer, desktop and client builds and directory packaging pass. Logs are `logs/lv035-orphan-tests.log`, `logs/lv035-orphan-check.log`, `logs/lv035-orphan-build.log`, `logs/lv035-orphan-client-build.log`, `logs/lv035-orphan-package.log` and `logs/lv035-orphan-packaged.log`.

The refreshed [Windows NSIS installed result](lawn-videorc-remux-cleanup-installed-windows.json) also passes the cleanup/recovery journey, bundled CLI launch and uninstall/registration cleanup. Logs are `logs/lv035-orphan-installer-build.log` and `logs/lv035-orphan-installed.log`. The installer remains unsigned.

The [Linux unpacked result](lawn-videorc-remux-cleanup-linux.json) and [installed Debian result](lawn-videorc-remux-cleanup-installed-linux.json) also pass. Both confirm cleanup of the redundant remux hard link, preservation/recovery of the published MP4, source retention, corrupt-source refusal, renderer codec checks and support diagnostics. The application runs as the container's `node` user with no network or host mounts, using the existing disposable Xvfb/D-Bus/keyring session and UTF-8 locale. The Debian package is removed afterward; the disposable container was removed after evidence collection.

Linux lint and workspace typechecks pass, as do all 720 tests in 149 files in 110.45 seconds using the existing one-worker, 30-second test budget. Production builds and AppImage/deb creation pass; AppImage execution remains unchecked. Logs are `logs/lv035-orphan-linux-build.log` and `logs/lv035-orphan-linux-runtime.log`. Reproduce with `docker build --progress=plain -f tests/linux/Dockerfile -t sidecut-linux-verification:lv035-cleanup .` and the offline runtime settings in [Linux container verification](linux-container.md). Minimal-session hostname and desktop-association warnings do not fail the journeys.

## Limits

Native macOS and physical Linux capture remain unverified. Filesystems without a usable inode leave duplicate links untouched. Only the current attempt's temporary file is removed unconditionally by its existing finalizer; unrelated or unproven old remnants remain available for manual inspection.

Signing, authenticated updates/rollback, library/settings migrations, broader abandoned-file recovery, physical/native platform acceptance, repair UI and complete release certification remain open. See the earlier [recording recovery report](lawn-videorc-recording-repair.md) for publication-recovery behavior and platform evidence.
