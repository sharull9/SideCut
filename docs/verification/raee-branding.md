# raE.E branding from the landing app

Integrated `origin/main` through merge commit `131867e` on 2026-11-01, including the landing app and its brand assets. Existing local parity, recording, cloud and compatibility work was restored after the merge. The pre-merge stash remains as a recovery copy.

The editor now uses the landing app's **raE.E** spelling, white viewfinder mark with green lens, and Geist wordmark typography. Its browser title, accessible editor label, adaptive SVG favicon, ICO fallback and Apple touch icon use the same identity. Web assets are copied byte-for-byte from `apps/landing/public`; future brand changes should update those source assets and their copies in `apps/web/public` together.

The desktop product/window name, executable display metadata, icon, startup errors and project/storage error copy use raE.E. Packaging derives the Windows, Linux and macOS application icon from the landing app's 512-pixel icon. Windows executable resource editing is enabled while signing remains disabled. The existing packaged `SideCut` profile directory is selected explicitly before any storage is opened; headless and smoke-test profiles still override it normally. Package IDs, executable names, CLI commands, artifact filenames and saved-file formats retain their existing identifiers for compatibility. The installer checks recognize both old and new display names and use the branded uninstaller. macOS verifier paths follow the branded app bundle.

## Verification

Frozen dependency installation, lint and all 17 workspace typecheck tasks pass after the merge. The full suite passes 727 tests in 150 files in 66.71 seconds. After the final error-copy update, the 20 SQLite/project/review tests pass again, along with lint and typechecks. Production editor/desktop and landing builds pass. Targeted formatting and diff checks pass; the unrelated cloud formatting issues recorded in the earlier verification remain outside this change.

The [Windows directory-package evidence](raee-branding-windows.json) verifies the raE.E browser title, wordmark, accessible label, loaded viewfinder image and fetched SVG favicon, in both initial and reopened application processes. The same fixture asserts the native app name is raE.E. Windows executable `ProductName` and `FileDescription` both read raE.E. The copied editor images match the landing originals by SHA-256.

The [Windows installed evidence](raee-branding-installed-windows.json) runs the same branding checks alongside recording/recovery/journal/layout, SQLite version refusal, support-report privacy/download cleanup, codecs, archive, CLI and restart checks. The existing harness uses a disposable Unicode/space installation path, verifies the CLI launcher, uninstalls the app and checks registration cleanup.

Logs are `logs/raee-main-install.log`, `logs/raee-brand-lint.log`, `logs/raee-brand-types.log`, `logs/raee-brand-tests.log`, `logs/raee-brand-storage-tests.log`, `logs/raee-brand-build.log`, `logs/raee-landing-build.log`, `logs/raee-brand-package.log`, `logs/raee-brand-packaged.log`, `logs/raee-brand-installed.log` and `logs/raee-brand-format.log`.

## Limits

Linux and macOS branded packages have not been executed in this task. The separately refreshed [SQLite platform evidence](lawn-videorc-future-database.md) comes from the earlier pre-merge snapshot. The installer remains unsigned; authenticated updates/rollback, physical-device acceptance and full LV035 certification remain open. This work creates local build artifacts and does not publish a release.
