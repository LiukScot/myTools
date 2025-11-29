#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-8000}"
PHP_BIN="${PHP_BIN:-php}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROUTER="$ROOT_DIR/testing/router.php"
ENV_FILE="$ROOT_DIR/.env"

load_env_file() {
  local file="$1"
  [[ -f "$file" ]] || return 1
  while IFS='=' read -r key value; do
    [[ -z "${key// }" || "${key:0:1}" == "#" ]] && continue
    key="$(echo "$key" | xargs)"
    value="${value:-}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
    local current="${!key-}"
    if [[ -n "$current" ]]; then
      continue
    fi
    export "$key=$value"
  done < "$file"
  echo "Loaded env vars from $file"
  return 0
}

if ! command -v "$PHP_BIN" >/dev/null 2>&1; then
  echo "php not found (looked for '$PHP_BIN'). Set PHP_BIN or install PHP 8+." >&2
  exit 1
fi

load_env_file "$ENV_FILE" || true

echo "Serving hub at http://127.0.0.1:${PORT}" \
  " (myHealth at /myhealth, myMoney at /mymoney)"
cd "$ROOT_DIR"
exec "$PHP_BIN" -S "127.0.0.1:${PORT}" "$ROUTER"
