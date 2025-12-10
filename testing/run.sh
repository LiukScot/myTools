#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-8000}"
PHP_BIN="${PHP_BIN:-php}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROUTER_FILE=""
ROUTER_TMP=""
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

ensure_router_file() {
  ROUTER_TMP="$(mktemp)"
  ROUTER_FILE="$ROUTER_TMP"
  cat >"$ROUTER_FILE" <<'PHP'
<?php
// Unified router for local PHP dev: serves hub, myHealth, myMoney, shared assets, and API passthroughs.

$root = getenv('APP_ROOT') ?: dirname(__DIR__);
$hubRoot = $root . '/hub';
$healthRoot = $root . '/myHealth/web';
$moneyRoot = $root . '/myMoney/web';
$sharedRoot = $root . '/shared';

$uri = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?: '/';

// API routing first
if (strpos($uri, '/myhealth/api/files') === 0) {
    require $healthRoot . '/api/files/index.php';
    return;
}
if (strpos($uri, '/mymoney/api/files') === 0) {
    require $moneyRoot . '/api/files/index.php';
    return;
}

function try_serve(string $file): bool
{
    if (!is_file($file))
        return false;

    $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
    $mime = match ($ext) {
        'css' => 'text/css',
        'js' => 'application/javascript',
        'json' => 'application/json',
        'html', 'htm' => 'text/html',
        'png' => 'image/png',
        'jpg', 'jpeg' => 'image/jpeg',
        'gif' => 'image/gif',
        'svg' => 'image/svg+xml',
        'txt' => 'text/plain',
        default => function_exists('mime_content_type') ? mime_content_type($file) : null,
    };

    if ($mime) {
        header('Content-Type: ' . $mime);
    }
    readfile($file);
    return true;
}

// Helper to resolve and serve static assets inside app roots
function serve_from_app(string $appRoot, string $uri, string $base): bool
{
    $rel = substr($uri, strlen($base));
    if ($rel === '' || $rel === false || $rel === null)
        $rel = '/';
    if ($rel === '/' || $rel === '')
        $rel = '/index.html';
    $path = realpath($appRoot . $rel);
    if (!$path || strpos($path, realpath($appRoot)) !== 0) {
        return try_serve($appRoot . '/index.html');
    }
    if (is_file($path)) {
        return try_serve($path);
    }
    return try_serve($appRoot . '/index.html');
}

// Serve shared assets (e.g. shared/base.css)
if (strpos($uri, '/shared') === 0) {
    $rel = substr($uri, strlen('/shared'));
    $path = realpath($sharedRoot . $rel);
    if ($path && strpos($path, realpath($sharedRoot)) === 0 && is_file($path)) {
        return try_serve($path);
    }
}

if (strpos($uri, '/myhealth') === 0) {
    if (serve_from_app($healthRoot, $uri, '/myhealth'))
        return;
}
if (strpos($uri, '/mymoney') === 0) {
    if (serve_from_app($moneyRoot, $uri, '/mymoney'))
        return;
}

// Default to hub
if ($uri !== '/' && try_serve($hubRoot . $uri)) {
    return;
}
try_serve($hubRoot . '/index.html');
PHP
}

cleanup() {
  if [[ -n "${ROUTER_TMP:-}" && -f "$ROUTER_TMP" ]]; then
    rm -f "$ROUTER_TMP"
  fi
}
trap cleanup EXIT

if ! command -v "$PHP_BIN" >/dev/null 2>&1; then
  echo "php not found (looked for '$PHP_BIN'). Set PHP_BIN or install PHP 8+." >&2
  exit 1
fi

load_env_file "$ENV_FILE" || true

ensure_router_file

echo "Serving hub at http://127.0.0.1:${PORT}" \
  " (myHealth at /myhealth, myMoney at /mymoney)"
cd "$ROOT_DIR"
APP_ROOT="$ROOT_DIR" "$PHP_BIN" -S "127.0.0.1:${PORT}" "$ROUTER_FILE"
