#!/bin/sh
set -eu

export XDG_RUNTIME_DIR="/tmp/sidecut-runtime-$(id -u)"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
# This password belongs only to the disposable fixture keyring.
printf '%s' 'sidecut-container-fixture' | gnome-keyring-daemon --unlock --components=secrets
eval "$(gnome-keyring-daemon --start --components=secrets)"

vp exec node scripts/verify-packaged.mjs
sh scripts/verify-linux-install.sh
