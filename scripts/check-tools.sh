# Shared by the macOS and Linux build scripts (not run on its own).
# Makes sure Rust and the Tauri command-line tool are available.

# Rust installed by rustup lives in ~/.cargo/bin, which may not be on PATH yet.
if ! command -v cargo >/dev/null 2>&1 && [ -x "$HOME/.cargo/bin/cargo" ]; then
  export PATH="$HOME/.cargo/bin:$PATH"
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "Rust is needed to build the app (you don't need to write any Rust)."
  echo "Install it from https://rustup.rs with:"
  echo
  echo "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
  echo
  echo "then open a new terminal and run this script again."
  exit 1
fi

if ! cargo tauri --version >/dev/null 2>&1; then
  echo "Installing the Tauri command-line tool (one time only, takes a few minutes)..."
  cargo install tauri-cli --version "^2" --locked
fi
