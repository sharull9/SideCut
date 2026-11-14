# Desktop builds

The `Release` GitHub Actions workflow builds Windows x64, Linux x64 and
macOS Apple Silicon. It produces NSIS `.exe` installers on `windows-latest`,
AppImage and `.deb` files on `ubuntu-24.04`, and `.dmg` and `.zip` files on
`macos-15`. Each package includes a CLI launcher under `resources/cli` (inside
the app bundle's Resources directory on macOS).

## Releases

The workflow publishes a GitHub release once all three platforms build and pass
verification:

- **Every push to `main`** (except docs-only changes) publishes a nightly
  prerelease, `v<version>-nightly.<YYYYMMDD>.<run>`, where `<version>` comes from
  `apps/desktop/package.json`. Nightlies are never marked latest.
- **Pushing a version tag** such as `v0.1.0` publishes a stable release with that
  version and marks it latest. A tag with a suffix (`v0.1.0-beta.1`) is a prerelease.
- **Run workflow** (Actions → **Release**) on `main` publishes a nightly on demand.

Each release has the installers, a `SHA256SUMS` file and notes GitHub generates
from merged pull requests. It is created as a draft and published only after every
file is attached, so a cancelled run leaves no partial release. A newer push to
`main` cancels an unfinished nightly run; tag runs always finish. The verification
results (`smoke-*.json`) stay in the run's **Artifacts** section, which expires
after one day.

To cut a stable release, bump `version` in `apps/desktop/package.json` (so later
nightlies count from it), merge, then tag that commit and push the tag:
`git tag v0.1.0 && git push origin v0.1.0`.

The workflow needs no signing secrets: builds are unsigned on Windows and
ad-hoc signed, not notarized, on macOS. It uses Node 24.22.1, matching the
repository engine. Package jobs have read-only repository permissions and a
30-minute timeout; only the final publish job can write releases. It installs dependencies, runs the full
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

LV034 extends the same verifier with synthetic native H.264/AAC recording,
MKV-to-MP4 finalization, renderer-bridge VP8/Opus transcoding and a second-process
journal/media check using the MP4 SHA-256. See the latest
[native platform evidence and limits](verification/lawn-videorc-native-platforms.md).
This checks packaged codec/storage behavior; physical device capture remains a
separate platform gate.

For local troubleshooting, `diagnostics --output sidecut-support.json --json`
creates a versioned report in the project's exports folder. It contains selected
technical counts/status and excludes project content, paths, credentials and logs.
See [support diagnostics and release limits](verification/lawn-videorc-release-diagnostics.md)
for CLI/SDK usage and the report boundary.

## Verification and distribution limits

Current acceptance is recorded in [phases 136–140](verification/phases-136-140.md).
Windows NSIS installation, the installed CLI launcher, encrypted credentials,
lock refusal, import/edit/export/archive and reopening passed in a disposable
Unicode/space installation path. The installer was then uninstalled. Native
macOS installation remains unverified. The later
[Debian 12 container journey](verification/linux-container.md) passes unpacked
and installed verification under its recorded locale/sandbox conditions; real
Linux desktop sessions remain open. No successful remote delivery workflow run
exists in this evidence. Windows and Linux lint, TypeScript and 521 tests in
109 files pass. The existing `workspace.css` formatting failure prevents claiming
that the full `check` command passes. Windows installers are unsigned.

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
the macOS script remains unexecuted. Debian installation passes in the documented
container. The [AppImage extract-and-run journey](verification/lawn-videorc-appimage.md)
also passes in that environment. FUSE mounting and real desktop permissions
remain separate acceptance checks. Bundled native-library notices and source provenance are
included; distributing a public release still needs a review of its complete
third-party notices and redistribution requirements.
