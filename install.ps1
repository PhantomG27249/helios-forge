param(
  [switch]$InstallPiKwargs,
  [switch]$SkipNpmInstall,
  [switch]$Start,
  [int]$Port = 3777
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $RepoRoot

function Require-Command($Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name is required. Install it first, then rerun this installer."
  }
}

Require-Command "node"
Require-Command "npm"

Write-Host "Helios Forge installer"
Write-Host "Repo: $RepoRoot"
Write-Host ""

if (-not $SkipNpmInstall) {
  Write-Host "Installing npm dependencies..."
  npm install
}

Write-Host "Preparing workspace-local harness package and capabilities..."
npm run setup

if ($InstallPiKwargs) {
  Write-Host "Installing optional global Pi kwargs extension..."
  npm run install:pi-kwargs
} else {
  Write-Host "Skipping global Pi kwargs extension. Re-run with -InstallPiKwargs to install it."
}

Write-Host "Running release smoke check..."
npm run release:smoke

Write-Host ""
Write-Host "Setup complete."
Write-Host "Open http://127.0.0.1:$Port/ after starting the app."

if ($Start) {
  Write-Host "Starting Helios Forge on port $Port..."
  $env:PORT = "$Port"
  npm run dev
}
