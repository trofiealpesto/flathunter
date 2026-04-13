#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_NODE_VERSION="$(tr -d '[:space:]' < "$ROOT_DIR/.nvmrc")"

export FLATHUNTER_TARGET_NODE_VERSION="$TARGET_NODE_VERSION"

exec bash -lc '
TARGET_NODE_VERSION="${FLATHUNTER_TARGET_NODE_VERSION}"
NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

if [[ -s "$NVM_DIR/nvm.sh" ]]; then
  . "$NVM_DIR/nvm.sh" --no-use
  nvm install "$TARGET_NODE_VERSION" >/dev/null 2>&1
  nvm use "$TARGET_NODE_VERSION" >/dev/null 2>&1
elif command -v node >/dev/null 2>&1; then
  CURRENT_NODE_MAJOR="$(node -p '\''process.versions.node.split(".")[0]'\'')"

  if [[ "$CURRENT_NODE_MAJOR" != "$TARGET_NODE_VERSION" ]]; then
    echo "Node $TARGET_NODE_VERSION is required. Install nvm or switch to Node $TARGET_NODE_VERSION manually." >&2
    exit 1
  fi
else
  echo "Node $TARGET_NODE_VERSION is required but no Node runtime was found." >&2
  exit 1
fi

export PATH="$HOME/.local/bin:$PATH"

exec "$@"
' bash "$@"
