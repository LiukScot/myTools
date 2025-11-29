#!/usr/bin/env bash
# Deploy hub + myHealth + myMoney (Hetzner webhosting) in one go.
# Usage (run from repo root):
#   FTP_HOST=host FTP_USER=user FTP_PASS='pass' ./deploy.sh
# Optional overrides:
#   BASE_REMOTE=/public_html/custom
#   REMOTE_HUB=/public_html
#   REMOTE_HEALTH=/public_html/myhealth
#   REMOTE_MONEY=/public_html/mymoney

set -euo pipefail

if ! command -v lftp >/dev/null 2>&1; then
  echo "lftp is required. Install it (e.g. sudo apt-get install lftp) and retry." >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_REMOTE="${BASE_REMOTE:-/public_html}"

REMOTE_HUB="${REMOTE_HUB:-${BASE_REMOTE}}"
REMOTE_HEALTH="${REMOTE_HEALTH:-${BASE_REMOTE}/myhealth}"
REMOTE_MONEY="${REMOTE_MONEY:-${BASE_REMOTE}/mymoney}"

TARGETS=(
  "$ROOT_DIR/hub:${REMOTE_HUB}"
  "$ROOT_DIR/myHealth/web:${REMOTE_HEALTH}"
  "$ROOT_DIR/myMoney/web:${REMOTE_MONEY}"
)

FTP_HOST="${FTP_HOST:-}"
FTP_USER="${FTP_USER:-}"
FTP_PASS="${FTP_PASS:-}"

if [[ -z "$FTP_HOST" || -z "$FTP_USER" || -z "$FTP_PASS" ]]; then
  echo "Set FTP_HOST, FTP_USER, FTP_PASS environment variables." >&2
  exit 1
fi

deploy_one() {
  local src="$1"
  local dest="$2"
  if [[ ! -d "$src" ]]; then
    echo "Local directory not found: $src" >&2
    return 1
  fi
  echo "Deploying $src -> $dest on $FTP_HOST as $FTP_USER (cleanup enabled)"
  lftp -u "$FTP_USER","$FTP_PASS" sftp://"$FTP_HOST" <<EOF
set ssl:verify-certificate no
set sftp:auto-confirm yes
mirror -R --delete --verbose --parallel=4 \
  --exclude-glob ".DS_Store" \
  --include-glob ".htaccess" \
  "$src" "$dest"
bye
EOF
}

for pair in "${TARGETS[@]}"; do
  IFS=':' read -r src dest <<<"$pair"
  deploy_one "$src" "$dest"
done

echo "Deploy complete."
