#!/usr/bin/env bash
# Shared deploy script for myHealth and myMoney (Hetzner webhosting, same provider).
# Usage examples (run from repo root):
#   APP=myhealth FTP_HOST=host FTP_USER=user FTP_PASS='pass' ./deploy.sh
#   APP=mymoney  FTP_HOST=host FTP_USER=user FTP_PASS='pass' ./deploy.sh
# Optional overrides: REMOTE_BASE=/public_html/custom LOCAL_DIR=/path/to/web

set -euo pipefail

if ! command -v lftp >/dev/null 2>&1; then
  echo "lftp is required. Install it (e.g. sudo apt-get install lftp) and retry." >&2
  exit 1
fi

APP="${APP:-myhealth}"
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
case "$APP" in
  myhealth|myHealth) LOCAL_DIR="${LOCAL_DIR:-$ROOT_DIR/myHealth/web}"; REMOTE_BASE="${REMOTE_BASE:-/public_html/myhealth}";;
  mymoney|myMoney)   LOCAL_DIR="${LOCAL_DIR:-$ROOT_DIR/myMoney/web}";  REMOTE_BASE="${REMOTE_BASE:-/public_html/mymoney}";;
  hub|root)          LOCAL_DIR="${LOCAL_DIR:-$ROOT_DIR/hub}";          REMOTE_BASE="${REMOTE_BASE:-/public_html}";;
  *) echo "Unknown APP '$APP' (use myhealth, mymoney, or hub/root)" >&2; exit 1;;
esac

FTP_HOST="${FTP_HOST:-}"
FTP_USER="${FTP_USER:-}"
FTP_PASS="${FTP_PASS:-}"

if [[ -z "$FTP_HOST" || -z "$FTP_USER" || -z "$FTP_PASS" ]]; then
  echo "Set FTP_HOST, FTP_USER, FTP_PASS environment variables." >&2
  exit 1
fi

if [[ ! -d "$LOCAL_DIR" ]]; then
  echo "Local directory not found: $LOCAL_DIR" >&2
  exit 1
fi

echo "Deploying $LOCAL_DIR -> $REMOTE_BASE on $FTP_HOST as $FTP_USER (cleanup enabled)"

lftp -u "$FTP_USER","$FTP_PASS" sftp://"$FTP_HOST" <<EOF
set ssl:verify-certificate no
set sftp:auto-confirm yes
mirror -R --delete --verbose --parallel=4 \
  --exclude-glob ".DS_Store" \
  --include-glob ".htaccess" \
  "$LOCAL_DIR" "$REMOTE_BASE"
bye
EOF

echo "Deploy complete."
