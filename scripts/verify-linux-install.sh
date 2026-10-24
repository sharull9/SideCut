#!/bin/sh
set -eu
[ "$(uname -s)" = Linux ] || { echo "Run on Linux." >&2; exit 1; }
SIDECUT_WORKSPACE=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if dpkg-query -W sidecut >/dev/null 2>&1; then echo "Existing SideCut installation will not be replaced." >&2; exit 1; fi
set -- "$SIDECUT_WORKSPACE"/apps/desktop/release/SideCut-*-linux-*.deb
[ "$#" -eq 1 ] && [ -f "$1" ] || { echo "Build exactly one Debian package first." >&2; exit 1; }
trap 'sudo dpkg --remove sidecut' EXIT HUP INT TERM
sudo dpkg --install "$1"
SIDECUT_INSTALLED=$(readlink -f "$(command -v sidecut)")
cd "$SIDECUT_WORKSPACE"
vp exec node scripts/verify-packaged.mjs --executable "$SIDECUT_INSTALLED"
