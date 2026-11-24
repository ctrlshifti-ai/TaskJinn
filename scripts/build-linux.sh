#!/usr/bin/env bash
# Builds the Linux packages (.AppImage and .deb) into dist/. Run it on Linux.
set -euo pipefail
cd "$(dirname "$0")/.."

# Tauri needs the WebKitGTK and tray libraries to build.
if ! pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
  echo "Some system libraries are missing. On Debian or Ubuntu install them with:"
  echo
  echo "  sudo apt install build-essential curl wget file pkg-config libwebkit2gtk-4.1-dev \\"
  echo "       libssl-dev libayatana-appindicator3-dev librsvg2-dev"
  echo
  echo "Other distributions: https://v2.tauri.app/start/prerequisites/#linux"
  exit 1
fi

source scripts/check-tools.sh
cargo tauri build --bundles appimage,deb

mkdir -p dist
cp src-tauri/target/release/bundle/appimage/*.AppImage dist/
cp src-tauri/target/release/bundle/deb/*.deb dist/
echo
echo "Done:"
ls -1 dist/*.AppImage dist/*.deb
