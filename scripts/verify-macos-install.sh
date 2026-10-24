#!/bin/sh
set -eu
[ "$(uname -s)" = Darwin ] || { echo "Run on macOS." >&2; exit 1; }
SIDECUT_WORKSPACE=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
set -- "$SIDECUT_WORKSPACE"/apps/desktop/release/SideCut-*-mac-*.dmg
[ "$#" -eq 1 ] && [ -f "$1" ] || { echo "Build exactly one macOS DMG first." >&2; exit 1; }
SIDECUT_INSTALL_TEMP=$(mktemp -d "${TMPDIR:-/tmp}/sidecut-install-XXXXXX")
SIDECUT_MOUNT="$SIDECUT_INSTALL_TEMP/mounted"
SIDECUT_MOUNTED=0
cleanup() {
  if [ "$SIDECUT_MOUNTED" -eq 1 ]; then
    hdiutil detach "$SIDECUT_MOUNT" -quiet || { echo "Could not detach test DMG; retaining its temporary directory." >&2; return; }
  fi
  case "$SIDECUT_INSTALL_TEMP" in "${TMPDIR:-/tmp}"/sidecut-install-*) rm -rf -- "$SIDECUT_INSTALL_TEMP";; *) echo "Unsafe cleanup target." >&2;; esac
}
trap cleanup EXIT HUP INT TERM
mkdir "$SIDECUT_MOUNT"
hdiutil attach -readonly -nobrowse -mountpoint "$SIDECUT_MOUNT" "$1"
SIDECUT_MOUNTED=1
ditto "$SIDECUT_MOUNT/SideCut.app" "$SIDECUT_INSTALL_TEMP/SideCut 侧剪.app"
codesign --verify --deep --strict "$SIDECUT_INSTALL_TEMP/SideCut 侧剪.app"
cd "$SIDECUT_WORKSPACE"
vp exec node scripts/verify-packaged.mjs --executable "$SIDECUT_INSTALL_TEMP/SideCut 侧剪.app/Contents/MacOS/SideCut"
