#!/usr/bin/env bash
# Runs the app straight from the source, without making an installer (macOS and Linux).
# On Windows run:  cargo tauri dev   from the project folder.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/check-tools.sh
cargo tauri dev
