# Linux container delivery verification

This phase-139 follow-up runs on 2026-10-26 in Debian 12 amd64 under Docker
Desktop's Linux/WSL2 engine on Windows. It is a separate acceptance target from
a user's Linux desktop. Native macOS acceptance remains open.

## Build and fixes

The fixture uses `tests/linux/Dockerfile`, `Dockerfile.dockerignore` and
`run-session.sh`. Its Node base image is pinned to digest
`sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205`.
It installs Vite+ 1.4.0 and the frozen dependency graph, runs lint, TypeScript
and all 521 tests in 109 files, then builds the production renderer and Electron
application with the platform's own media binaries. The dependency manifest
selects Node 24.22.1. Electron is 45.0.0.

The first build-time SPA crawl failed to reach `127.0.0.1:3000`, leaving no
`_shell.html`. Setting `preview.host` to `127.0.0.1` makes the same Linux build
generate its shell. The Windows production build also passes with this setting.
Vite documents possible address differences when resolving
[localhost](https://vite.dev/config/server-options#server-host).

The container fixture also corrects Vite+'s Linux XDG installation path, creates
its cache directory as the application user, and includes `xz-utils` for Debian
package compression. These changes belong to the build harness. The production
application retains its sandbox settings.

An unrelated watch-test startup race surfaced under build load. Its integration
test now waits for the first watch request to reach the actual host instead of
sleeping for 300 milliseconds. Windows and Linux full suites pass this change.

## Runtime acceptance

Both the unpacked app and installed Debian package pass the packaged journey.
The runner uses a disposable D-Bus session, Xvfb display and synthetic keyring,
then runs the existing Debian install/verify/uninstall script. The package is
removed afterward. The application runs as `node` (uid 1000), with no host mounts
and no container network access.

- [Unpacked app evidence](phase-139-container-unpacked.json).
- [Installed app evidence](phase-139-container-installed.json).
- [Package hashes, sizes and shell-launcher check](phase-139-container-build.json).
- [Runtime conditions and failed probes](phase-139-container-runtime.json).

Both journeys verify renderer isolation, an encrypted credential round trip,
exclusive project locking, SQLite migration with the legacy file preserved,
synthetic PCM import, a shared edit, VP8/Opus export with bundled FFmpeg/FFprobe,
WAV decoding, archive creation and project reopen. The standalone packaged CLI
script passes; a separate check also executes its Unix shell launcher.

The default Docker policy refuses Chromium sandbox namespace creation. This
fixture needs `SYS_ADMIN` and an unconfined seccomp policy inside the isolated
container. The app's own renderer sandbox stays enabled. These flags are test
infrastructure requirements, not requirements for a normal Linux desktop.

With namespace creation allowed but the default locale retained, the Unicode
profile fails opening its legacy IndexedDB backing store. The same image passes
with `LANG=C.UTF-8` and `LC_ALL=C.UTF-8`. No storage-migration error is swallowed.
Non-UTF-8 Linux profiles remain outside acceptance. `XDG_CURRENT_DESKTOP=GNOME`
selects the fixture's available secret service; this is not a full GNOME session.

Reproduce from the repository root:

```sh
docker build --progress=plain -f tests/linux/Dockerfile -t sidecut-linux-verification:2026-10-25 .
docker run --rm --network none --cap-add SYS_ADMIN --security-opt seccomp=unconfined \
  -e XDG_CURRENT_DESKTOP=GNOME -e LANG=C.UTF-8 -e LC_ALL=C.UTF-8 \
  sidecut-linux-verification:2026-10-25
```

The container reports missing system D-Bus and hostname-resolution warnings in
this minimal session; both verification processes and the install/uninstall
runner exit successfully. Artifacts remain local; no installer is published.

## Limits

This container does not establish real GNOME/KDE/Wayland acceptance, native file
picker or portal behavior, screen-reader/touch support, GPU acceleration,
AppImage/FUSE execution, Linux ARM64, additional distributions, signing, updates
or public distribution. Building an AppImage alone does not verify executing it.
The current package retains Electron's default icon; desktop window association
has not been verified. No remote CI workflow or release is published by this run.

The existing `workspace.css` formatting failure remains outside this phase;
lint, TypeScript and unit-test success do not imply that the full `check` command
passes.
