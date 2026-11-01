#!/bin/sh
set -eu

cd "$(dirname "$0")/../.."
SIDECUT_WORKSPACE=$(pwd)
set -- "$SIDECUT_WORKSPACE"/apps/desktop/release/SideCut-*-linux-*.AppImage
[ "$#" -eq 1 ] && [ -f "$1" ] || { echo "Build exactly one AppImage first." >&2; exit 1; }
SIDECUT_APPIMAGE=$1
SIDECUT_APPIMAGE_FIXTURE=$(mktemp -d /tmp/sidecut-appimage-XXXXXX)
trap 'rm -rf "$SIDECUT_APPIMAGE_FIXTURE"' EXIT HUP INT TERM

export XDG_RUNTIME_DIR="/tmp/sidecut-runtime-$(id -u)"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
printf '%s' 'sidecut-container-fixture' | gnome-keyring-daemon --unlock --components=secrets
eval "$(gnome-keyring-daemon --start --components=secrets)"

# The verifier locates its CLI beside the executable. Expose the same image's
# CLI resources there; both application launches still execute the AppImage.
cd "$SIDECUT_APPIMAGE_FIXTURE"
"$SIDECUT_APPIMAGE" --appimage-extract >/dev/null
ln -s "$SIDECUT_APPIMAGE" SideCut.AppImage
ln -s "$SIDECUT_APPIMAGE_FIXTURE/squashfs-root/resources" resources
cd "$SIDECUT_WORKSPACE"
export APPIMAGE_EXTRACT_AND_RUN=1
vp exec node scripts/verify-packaged.mjs --executable "$SIDECUT_APPIMAGE_FIXTURE/SideCut.AppImage"
vp exec node --input-type=module - "$SIDECUT_APPIMAGE" <<'NODE'
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
const artifact = process.argv[2];
const hash = createHash('sha256');
for await (const chunk of createReadStream(artifact)) hash.update(chunk);
const result = JSON.parse(await readFile('apps/desktop/release/installed-smoke-linux-x64.json', 'utf8'));
result.appimage = {
  file: basename(artifact),
  bytes: (await stat(artifact)).size,
  sha256: hash.digest('hex'),
  mode: 'extract-and-run',
  fuseVerified: false,
  cliResources: 'extracted from the same AppImage',
};
await writeFile('apps/desktop/release/appimage-smoke-linux-x64.json', JSON.stringify(result, null, 2) + '\n');
NODE
