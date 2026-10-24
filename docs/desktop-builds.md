# Desktop builds

The `Desktop builds` GitHub Actions workflow builds Windows x64, Linux x64 and
macOS Apple Silicon. It produces NSIS `.exe` installers on `windows-latest`,
AppImage and `.deb` files on `ubuntu-24.04`, and `.dmg` and `.zip` files on
`macos-15`. Each package includes a CLI launcher under `resources/cli` (inside
the app bundle's Resources directory on macOS).

## Run on GitHub

1. Commit and push the workflow and packaging changes. For the manual Run workflow
   button to appear, the workflow must be present on the repository's default branch.
2. Open **Actions**, select **Desktop builds**, and choose **Run workflow**.
3. After the target job passes, download `sidecut-windows-x64`, `sidecut-linux-x64` or `sidecut-macos-arm64`
   from that run's **Artifacts** section. Each contains the installers and a
   `smoke-*.json` verification result. Artifacts expire after one day.

Pushing a version tag such as `v0.1.0` also runs the workflow. The staged app's
version comes from that tag. Manual branch builds use `apps/desktop/package.json`.
The workflow does not create GitHub releases or publish downloads automatically,
and it needs no signing secrets. Both workflows use Node 24.22.1, matching the
repository engine.

The workflow has read-only repository permissions, a 30-minute job timeout, and
cancels older builds for the same ref. It installs dependencies, runs the full
checks, builds and packages the app, then verifies the unpacked application before
uploading artifacts. It also tests NSIS installation, a copied DMG app, or an
installed Debian package on the corresponding runner. Linux verification uses Xvfb and permits Chromium sandbox
namespaces on that disposable runner; the application keeps its Electron sandbox.

Standard runner execution is free for public repositories. Private repository
minutes and artifact storage count against the owner's plan. One-day retention
reduces storage use; it does not guarantee that a private repository remains
within its allowance. See [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

## Package locally

```sh
vp install --frozen-lockfile
vp run package:desktop
vp run verify:packaged
```

Run these commands on the target OS and architecture. The script deliberately
uses native builds, so FFmpeg and FFprobe match Electron. Intel macOS and Linux
ARM builds are not in the initial workflow.

For an unpacked application without creating installers:

```sh
vp run build:desktop
vp exec node scripts/package-desktop.mjs --dir
vp run verify:packaged
```

Builds go to the ignored `apps/desktop/release/` directory. The ignored `.package/`
directory stages a standalone application manifest, host/preload bundles, the
shared web editor, and selected native binaries. Development packages are excluded
from the application archive. The renderer is copied to `resources/renderer`;
FFmpeg and FFprobe are executable files in `resources/media`, outside ASAR.
Installed licence/readme companions and provenance links are copied into
`resources/licenses`, including the retained Tandem notice.

The packaged verifier uses a temporary Unicode/space profile, clears development/binary
overrides, imports synthetic PCM audio, places a trimmed clip on the timeline,
exports VP8/Opus WebM and probes/decodes the result with the shipped binaries. It
also checks archive creation, reopening, the CLI, credential encryption or secure
keyring refusal, exclusive project locking, and that the renderer exposes neither `process` nor `require`. It removes
the temporary profile and writes platform-specific JSON into `release/`.

## Verification and distribution limits

Current acceptance is recorded in [phases 136–140](verification/phases-136-140.md).
Windows NSIS installation, the installed CLI launcher, encrypted credentials,
lock refusal, import/edit/export/archive and reopening passed in a disposable
Unicode/space installation path. The installer was then uninstalled. Native
macOS/Linux installation scripts are prepared but have not run; no successful
remote delivery workflow run exists in this evidence. `vp run check` currently
passes 343 tests in 75 files. Windows installers are unsigned.

The following directory-package result is historical evidence from before the
installed-delivery checks:

On 2026-10-24, `vp run check` passed all 302 tests in 60 files and all formatting,
lint and TypeScript checks. `vp run build:desktop` and native Windows x64 directory
packaging passed. The real packaged app passed the verifier with a 4,396-byte
VP8/Opus export, 0.228-second container duration for a 0.2-second timeline, and WAV
decode. The [recorded result](verification/desktop-packaged-windows.json) validates the packaged resource paths and isolated renderer on
Windows. Linux/AppImage/deb and macOS/DMG/ZIP execution remain pending their first
GitHub Actions run. Windows installer configuration and installed acceptance were
added in phases 136–140.

macOS uses an ad-hoc signature with hardened runtime and notarization disabled.
It has no Apple Developer ID signature and does not offer a normal notarized
download experience. Public macOS distribution still needs Developer ID signing,
notarization and testing on users' machines. The bundles currently use Electron's
default application icon. See [macOS packaging options](https://www.electron.build/v26/docs/mac/).

`verify:packaged` launches the unpacked application by default. The workflow's
additional target scripts verify NSIS, copied DMG and installed `.deb` delivery;
the latter two remain unexecuted. AppImage execution and real desktop permissions
are separate acceptance checks. Bundled native-library notices and source provenance are
included; distributing a public release still needs a review of its complete
third-party notices and redistribution requirements.
