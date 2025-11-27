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
ENV_LOADED_FROM=""

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
  ENV_LOADED_FROM="$file"
  return 0
}

if ! command -v "$PHP_BIN" >/dev/null 2>&1; then
  echo "php not found (looked for '$PHP_BIN'). Set PHP_BIN or install PHP 8+." >&2
  exit 1
fi

if [[ ! -d "$WEB_ROOT" ]]; then
  echo "Web root not found: $WEB_ROOT" >&2
  exit 1
fi

for candidate in "$PROJECT_ROOT/.env" "$WEB_ROOT/.env" "$SCRIPT_DIR/.env"; do
  if load_env_file "$candidate"; then
    break
  fi
done

required_env=(DB_HOST DB_USER DB_PASS DB_NAME)
missing=()
for var in "${required_env[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    missing+=("$var")
  fi
done
if (( ${#missing[@]} > 0 )); then
  echo "Missing required env vars: ${missing[*]}" >&2
  echo "Add them to $PROJECT_ROOT/.env (see $PROJECT_ROOT/.env.example) or export them before running." >&2
  exit 1
fi

if [[ -n "$ENV_LOADED_FROM" ]]; then
  echo "Loaded env vars from $ENV_LOADED_FROM"
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
