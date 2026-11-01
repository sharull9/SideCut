# LV035 Linux AppImage execution

Continued the approved release phase on 2026-11-01. LV035 remains in progress.

## Execution and scope

The existing Linux AppImage now passes the production packaged-app verifier in `APPIMAGE_EXTRACT_AND_RUN=1` mode. Both application launches execute the AppImage artifact. This mode extracts its bundled filesystem into temporary storage and runs the packaged application without a FUSE mount. It does not establish FUSE mounting or acceptance on a physical Linux desktop.

The [AppImage evidence](lawn-videorc-appimage-linux.json) records the artifact filename, byte count, SHA-256 and execution mode under `appimage`. It also records successful renderer isolation, encrypted credentials, project locking, SQLite migration with the legacy file preserved, import/edit/export/archive, recording/codec/recovery/journal/layout checks and restart. Support-report creation, privacy exclusions, download URL cleanup and unchanged project state pass. The packaged CLI runs through the AppImage with `ELECTRON_RUN_AS_NODE=1` and displays help.

The existing verifier expects CLI resources beside its executable. The fixture therefore extracts the same AppImage once to expose its own CLI resources through an adjacent symlink; application launches still execute the AppImage, and the CLI script comes from that artifact. The fixture removes its temporary extraction afterward. It does not substitute the unpacked app's resources.

The application runs as the Debian container's `node` user, with no network or host mounts, using the established Xvfb/D-Bus/keyring session, UTF-8 locale and container sandbox allowances. The application sandbox settings remain unchanged. Minimal-session D-Bus warnings do not fail the journey. The container exits successfully and is removed after evidence collection. Runtime output is `logs/lv035-appimage-runtime.log`.

## Reproduction

The reusable fixture is `tests/linux/run-appimage-session.sh`. It requires exactly one built AppImage. The previously built `sidecut-linux-verification:lv035-support-ui` image contains the artifact whose source checks passed 725 tests in 150 files, lint and workspace typechecks; see [support UI platform acceptance](lawn-videorc-support-ui.md). This verification adds a shell fixture and documentation without changing product code or rebuilding that artifact.

For that existing image, copy the new fixture into a disposable container before starting it:

```sh
docker create --name sidecut-appimage-runtime --network none \
  --cap-add SYS_ADMIN --security-opt seccomp=unconfined \
  -e XDG_CURRENT_DESKTOP=GNOME -e LANG=C.UTF-8 -e LC_ALL=C.UTF-8 \
  --entrypoint dbus-run-session sidecut-linux-verification:lv035-support-ui \
  -- xvfb-run -a sh tests/linux/run-appimage-session.sh
docker cp tests/linux/run-appimage-session.sh sidecut-appimage-runtime:/workspace/tests/linux/run-appimage-session.sh
docker start -a sidecut-appimage-runtime
docker cp sidecut-appimage-runtime:/workspace/apps/desktop/release/appimage-smoke-linux-x64.json docs/verification/lawn-videorc-appimage-linux.json
docker rm sidecut-appimage-runtime
```

Future builds using `tests/linux/Dockerfile` include the fixture directly. Its default command still runs unpacked and Debian-installed verification; select this fixture explicitly for AppImage acceptance.

## Remaining limits

FUSE mounting, physical Linux desktop/portal/device behavior, GPU acceleration, Linux ARM64 and other distributions remain unverified. This is extraction-mode artifact execution in the existing container environment. It does not establish public distribution, signing, authenticated updates/rollback, native macOS acceptance or complete LV035 certification.
