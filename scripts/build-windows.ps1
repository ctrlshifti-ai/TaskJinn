# Builds the Windows installers (setup .exe and .msi) into dist\. Run it in PowerShell on Windows:
#
#   powershell -ExecutionPolicy Bypass -File scripts\build-windows.ps1
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Host "Rust is needed to build the app (you don't need to write any Rust)."
    Write-Host "Install it from https://rustup.rs - the installer also offers the Microsoft C++ build tools it needs."
    Write-Host "Then open a new PowerShell window and run this script again."
    exit 1
}

cargo tauri --version *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Installing the Tauri command-line tool (one time only, takes a few minutes)..."
    cargo install tauri-cli --version "^2" --locked
}

cargo tauri build --bundles nsis,msi
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

New-Item -ItemType Directory -Force dist | Out-Null
Copy-Item src-tauri\target\release\bundle\nsis\*.exe dist\
Copy-Item src-tauri\target\release\bundle\msi\*.msi dist\
Write-Host ""
Write-Host "Done:"
Get-ChildItem dist\*.exe, dist\*.msi | ForEach-Object { $_.Name }
