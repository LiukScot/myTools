#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-8001}"
PY_BIN="${PY_BIN:-python3}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER="$APP_ROOT/server.py"

if ! command -v "$PY_BIN" >/dev/null 2>&1; then
  echo "python3 not found (looked for '$PY_BIN'). Set PY_BIN or install Python 3." >&2
  exit 1
fi

if [[ ! -f "$SERVER" ]]; then
  echo "Server script not found: $SERVER" >&2
  exit 1
fi

URL="http://127.0.0.1:${PORT}/myMoney.html"
echo "Starting myMoney dev server at $URL"

if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 || true
fi

cd "$APP_ROOT"
exec "$PY_BIN" "$SERVER" --port "$PORT"
