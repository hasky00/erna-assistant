#!/usr/bin/env bash
set -euo pipefail

# Run from the Erna repo root on the Hetzner server.
# Usage: ./deploy/deploy.sh

APP_DIR="${ERNA_APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
PM2_CONFIG="${APP_DIR}/deploy/ecosystem.config.js"

cd "$APP_DIR"

echo "==> Deploying Erna from ${APP_DIR}"

if [[ ! -f .env ]]; then
  echo "ERROR: .env not found. Copy deploy/.env.production.example to .env and fill in values."
  exit 1
fi

if command -v git >/dev/null 2>&1 && [[ -d .git ]]; then
  echo "==> Pulling latest changes"
  git pull --ff-only
fi

echo "==> Installing dependencies"
npm ci

echo "==> Building"
npm run build

echo "==> Restarting PM2"
export ERNA_APP_DIR="$APP_DIR"
if pm2 describe erna >/dev/null 2>&1; then
  pm2 restart "$PM2_CONFIG" --update-env
else
  pm2 start "$PM2_CONFIG"
fi

pm2 save

echo "==> Done. Check: pm2 status && pm2 logs erna --lines 30"