#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../../.." && pwd)
EXT_DIR="$REPO_ROOT/research-kit/extension"

API_URL=${VITE_API_URL:-}
GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID:-}

if [ -z "$API_URL" ]; then
  echo "Set VITE_API_URL, for example: https://api.example.com/v1" >&2
  exit 1
fi

if [ -z "$GOOGLE_CLIENT_ID" ]; then
  echo "Set VITE_GOOGLE_CLIENT_ID before building the extension." >&2
  exit 1
fi

command -v npm >/dev/null 2>&1 || {
  echo "Missing required command: npm" >&2
  exit 1
}

cd "$EXT_DIR"
npm ci
npm run build
