# LV035 recording recovery checks

Continued the approved release phase on 2026-11-01. LV035 remains in progress.

## Recovery path correction

Startup recovery and retry previously read recording journals without the canonical-path checks used by library access. A disposable Windows directory-junction fixture reproduced startup following a linked recording folder and rewriting the outside journal to `interrupted`. The failing result is recorded in `logs/lv035-repair-red.log`.

Journal reads, journal writes, source size checks, library access and finalization now share recording-folder checks. The folder must be a real child of the configured recording root. Journals and repair sources must be regular files at their canonical paths. Linked recording folders are omitted from the library and refused by retry without changing the outside journal.

Repair now accepts local Matroska/WebM input through FFmpeg's protocol and format allowlists. Valid MP4 bytes renamed to `recording.mkv` are rejected. Failed remuxes retain the input and error journal, remove temporary output and leave any existing `recording.mp4` untouched. Repair continues to use stream copy rather than re-encoding the source.

These filesystem checks do not certify safety against an adversary that changes filesystem links between a check and an operation. Root-directory ownership and local access controls still matter. Startup marks unfinished journals interrupted; the explicit retry operation can now reconcile a matching published MP4 as described below.

## Acceptance

The focused recorder and library suite covers normal H.264/AAC remux, software fallback, missing probe/retry, existing-output refusal, malformed/mismatched metadata, linked-folder refusal, corrupt input, misnamed MP4 input, source retention and temporary-output cleanup. The new linked-folder fixture runs without invoking a codec process and confirms the outside journal remains byte-for-byte unchanged.

The packaged verifier stages two simulated `stopping` journals in a disposable profile before the first application process exits. One refers to a closed synthetic recording; the other contains damaged bytes. After a fresh application process starts, the production recorder marks both interrupted, repairs the intact source and refuses the damaged source. The intact output is probed as H.264/AAC and transcoded through the renderer's native-media bridge to VP8/Opus. Checks compare the original source SHA-256 across processes, retain damaged source bytes and verify no temporary remux files remain.

The fixture uses complete synthetic media and seeded interrupted journals. It does not simulate power loss during capture or prove repair of every truncated/corrupt container. Earlier host/encoder termination evidence remains in [LV007](lawn-videorc-native-recorder.md).

## Validation results

The [Windows directory-package result](lawn-videorc-recording-repair-windows.json) and [Windows installed result](lawn-videorc-recording-repair-installed-windows.json) pass. Both include recovery evidence under `nativeRecording.repair` and support diagnostics under `support`. The installed NSIS journey verifies launch from a Unicode/space path, the recording/recovery, diagnostics, SQLite, archive, CLI and restart checks, then uninstalls and verifies registration cleanup. The installer remains unsigned.

The default `vp run check` passes all 17 tasks, including formatting, lint, workspace typechecks and 718 tests in 149 files; the test run took 38.40 seconds. The focused recorder/library suite passes nine tests. Production renderer, desktop and client builds pass.

Logs are `logs/lv035-repair-tests.log`, `logs/lv035-repair-types.log`, `logs/lv035-repair-check-final.log`, `logs/lv035-repair-build.log`, `logs/lv035-repair-client-build.log`, `logs/lv035-repair-package.log`, `logs/lv035-repair-packaged.log`, `logs/lv035-repair-installer-build.log` and `logs/lv035-repair-installed.log`.

The refreshed Debian 12 x64 container also passes the [unpacked journey](lawn-videorc-recording-repair-linux.json) and [installed Debian journey](lawn-videorc-recording-repair-installed-linux.json), including recovery after restart, source preservation, corrupt-source refusal, temporary-output cleanup and support diagnostics. Both use the production Linux media binaries and renderer bridge. The application runs as the container's `node` user under Xvfb with a disposable D-Bus/keyring session, UTF-8 locale, no network and no host mounts. The harness removes the Debian package afterward; the container was removed after evidence collection.

Linux lint and all workspace typechecks pass. All 718 tests in 149 files pass in 107.55 seconds using the existing one-worker, 30-second test budget. Production renderer, desktop and client builds and AppImage/deb creation pass. AppImage execution is not checked. Minimal-session D-Bus, hostname and package-removal desktop-association warnings do not fail either journey. Logs are `logs/lv035-linux-build.log` and `logs/lv035-linux-runtime.log`.

Reproduce with `docker build --progress=plain -f tests/linux/Dockerfile -t sidecut-linux-verification:lv035 .`, then run the image using the locale, D-Bus and sandbox conditions in [Linux container verification](linux-container.md). Container/Xvfb results do not establish physical GNOME/KDE/Wayland capture or permissions acceptance. Native macOS recovery remains unverified.

## Recovery after output publication

A later bounded fix addresses a crash between publishing `recording.mp4` and saving its ready journal. Previously, retry remuxed the retained source but failed because the target already existed, leaving a usable recording in error. The regression reproduced that result before the fix; see `logs/lv035-publication-red.log`.

Retry still remuxes and probes the source before publication. When the atomic no-replacement link reports an existing target, the recorder requires that target to be a regular file at its canonical path, with the same size and streaming SHA-256 as the newly validated remux. A match completes the ready journal without rewriting or replacing the published file. A mismatch, unsafe target or source/remux failure leaves the target intact and the journal in error. Hashing uses bounded memory and reads both complete outputs when their sizes match. The public journal schema and retry interface are unchanged.

The regression seeds a stopping journal after a real synthetic recording, creates a fresh recorder and confirms interruption detection. Retry refuses a same-size output with one changed byte and a directory at the target path. Restoring the original MP4 lets retry complete; checks preserve its bytes, inode and modification time, retain the MKV, save a ready journal and remove the attempt's temporary output.

The [Windows directory-package publication result](lawn-videorc-publication-recovery-windows.json) passes. The packaged verifier now stages a third interrupted journal with an already-published synthetic MP4. A fresh process repairs it and preserves its bytes, inode and modification time; the root verifier also compares its SHA-256 across processes. Existing intact-source and corrupt-source fixtures remain. These are seeded crash states, not a power-loss test.

The default `vp run check` passes all 17 tasks and 719 tests in 149 files; the test run took 44.89 seconds. The focused recorder/library suite passes ten tests. Production renderer, desktop and client builds and directory packaging pass. Logs are `logs/lv035-publication-tests.log`, `logs/lv035-publication-check.log`, `logs/lv035-publication-build.log`, `logs/lv035-publication-client-build.log`, `logs/lv035-publication-package.log` and `logs/lv035-publication-packaged.log`.

The refreshed [Windows NSIS installed result](lawn-videorc-publication-recovery-installed-windows.json), [Linux unpacked result](lawn-videorc-publication-recovery-linux.json) and [Linux installed Debian result](lawn-videorc-publication-recovery-installed-linux.json) also pass publication recovery, preservation of the published MP4, existing source/corruption checks and diagnostics. The Windows harness verifies the bundled CLI launcher and uninstall/registration cleanup. The Linux harness runs offline without host mounts under the same disposable Xvfb/D-Bus/keyring conditions described above, removes the Debian package and exits successfully. Its disposable container was removed after copying evidence.

The refreshed Linux build passes lint, workspace typechecks and all 719 tests in 149 files in 109.50 seconds, using the existing one-worker, 30-second test budget. Production builds and AppImage/deb creation pass; AppImage execution remains unchecked. Reproduce with image tag `sidecut-linux-verification:lv035-publication` and the same Docker build/run settings above. Logs are `logs/lv035-publication-installer-build.log`, `logs/lv035-publication-installed.log`, `logs/lv035-publication-linux-build.log` and `logs/lv035-publication-linux-runtime.log`. Minimal-session hostname and desktop-association warnings do not fail the Linux journeys.

Native macOS remains unverified. Recovery requires a readable, remuxable source and an exactly matching output; a different media-tool version may produce different MP4 bytes and cause conservative refusal. Startup does not automatically retry. The later [published remux cleanup](lawn-videorc-remux-cleanup.md) removes recognized redundant hard links after a successful repair; other abandoned files remain preserved.

## Remaining release work

The later [recording journal version checks](lawn-videorc-journal-versions.md) add a disk-only version marker, legacy read compatibility and preservation of unsupported-version journals. Their validation and remaining migration limits are recorded separately.

Signing, authenticated updates/rollback, broader abandoned-file recovery, recording-library/settings migrations, physical capture and native macOS/Linux device acceptance, repair UI and complete release certification remain open. This slice does not publish installers or certify parity.
