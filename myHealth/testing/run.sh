#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-8000}"
DB_HOST="${DB_HOST:-}"
DB_USER="${DB_USER:-}"
DB_PASS="${DB_PASS:-}"
DB_NAME="${DB_NAME:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WEB_ROOT="$PROJECT_ROOT/web"
ROUTER="$PROJECT_ROOT/testing/router.php"
PHP_BIN="${PHP_BIN:-php}"

if ! command -v "$PHP_BIN" >/dev/null 2>&1; then
  echo "php not found (looked for '$PHP_BIN'). Set PHP_BIN or install PHP 8+." >&2
  exit 1
fi

if [[ ! -d "$WEB_ROOT" ]]; then
  echo "Web root not found: $WEB_ROOT" >&2
  exit 1
fi

export DB_HOST DB_USER DB_PASS DB_NAME

URL="http://127.0.0.1:${PORT}"
echo "Starting myHealth dev server at $URL"
echo "Using router: $ROUTER"

if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 || true
fi

cd "$WEB_ROOT"
exec "$PHP_BIN" -S "127.0.0.1:${PORT}" "$ROUTER"
