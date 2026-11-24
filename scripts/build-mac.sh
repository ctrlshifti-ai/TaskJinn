#!/usr/bin/env bash
# Builds the macOS app and its disk image into dist/.
#
#   ./scripts/build-mac.sh             for this Mac's processor
#   ./scripts/build-mac.sh universal   one app for both Apple silicon and Intel Macs
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/check-tools.sh

if [ "${1:-}" = "universal" ]; then
  rustup target add aarch64-apple-darwin x86_64-apple-darwin
  cargo tauri build --target universal-apple-darwin --bundles dmg
  BUNDLE_DIR=src-tauri/target/universal-apple-darwin/release/bundle
else
  cargo tauri build --bundles dmg
  BUNDLE_DIR=src-tauri/target/release/bundle
fi

mkdir -p dist
cp "$BUNDLE_DIR"/dmg/*.dmg dist/
echo
echo "Done:"
ls -1 dist/*.dmg
