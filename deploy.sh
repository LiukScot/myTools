#!/usr/bin/env bash
# Simple deploy script to push the local web/ folder (UI + API) to your Hetzner webhosting.
# Usage:
#   FTP_HOST=your-host FTP_USER=your-user FTP_PASS=your-pass ./deploy.sh
# Expected remote layout: public_html/myhealth/ (adjust REMOTE_BASE if needed).

set -euo pipefail

if ! command -v lftp >/dev/null 2>&1; then
  echo "lftp is required. Install it (e.g. sudo apt-get install lftp) and retry." >&2
  exit 1
fi

FTP_HOST="${FTP_HOST:-}"
FTP_USER="${FTP_USER:-}"
FTP_PASS="${FTP_PASS:-}"
REMOTE_BASE="${REMOTE_BASE:-/public_html/myhealth}"
LOCAL_DIR="${LOCAL_DIR:-web}"

if [[ -z "$FTP_HOST" || -z "$FTP_USER" || -z "$FTP_PASS" ]]; then
  echo "Set FTP_HOST, FTP_USER, FTP_PASS environment variables." >&2
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
