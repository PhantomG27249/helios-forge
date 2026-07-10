#!/usr/bin/env bash
# Helios Forge installer for Linux/macOS. Mirrors install.ps1.
set -euo pipefail

INSTALL_PI_KWARGS=0
SKIP_NPM_INSTALL=0
START=0
PORT=3777

usage() {
  cat <<'EOF'
Usage: ./install.sh [options]

Options:
  --install-pi-kwargs   Also install the global Pi kwargs extension (~/.pi/agent/extensions)
  --skip-npm-install    Skip `npm install`
  --start               Start the dev server after setup
  --port <port>         Port for the dev server (default: 3777)
  -h, --help            Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-pi-kwargs) INSTALL_PI_KWARGS=1 ;;
    --skip-npm-install) SKIP_NPM_INSTALL=1 ;;
    --start) START=1 ;;
    --port)
      PORT="${2:?--port requires a value}"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "$1 is required. Install it first, then rerun this installer." >&2
    exit 1
  fi
}

require_command node
require_command npm

echo "Helios Forge installer"
echo "Repo: $REPO_ROOT"
echo ""

if [[ $SKIP_NPM_INSTALL -eq 0 ]]; then
  echo "Installing npm dependencies..."
  npm install
fi

echo "Preparing workspace-local harness package and capabilities..."
npm run setup

if [[ $INSTALL_PI_KWARGS -eq 1 ]]; then
  echo "Installing optional global Pi kwargs extension..."
  npm run install:pi-kwargs
else
  echo "Skipping global Pi kwargs extension. Re-run with --install-pi-kwargs to install it."
fi

echo "Running release smoke check..."
npm run release:smoke

echo ""
echo "Setup complete."
echo "Open http://127.0.0.1:${PORT}/ after starting the app."

if [[ $START -eq 1 ]]; then
  echo "Starting Helios Forge on port ${PORT}..."
  PORT="$PORT" npm run dev
fi
