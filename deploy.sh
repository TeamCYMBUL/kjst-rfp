#!/bin/bash
# KJST RFP — full deploy script
# Usage: ./deploy.sh "commit message"
# Run this after every set of changes. Never leave uncommitted code.
# Secrets live in .env.deploy (gitignored), never in this file.

set -e

# Load deploy secrets
if [ -f .env.deploy ]; then
  export $(grep -v '^#' .env.deploy | xargs)
fi

MSG=${1:-"Update: $(date '+%Y-%m-%d %H:%M')"}

echo "▶ Building..."
npm run build

echo "▶ Staging changes..."
git add src/ package.json package-lock.json 2>/dev/null || true

echo "▶ Committing: $MSG"
git diff --cached --quiet && echo "  (nothing new to commit)" || git commit -m "$MSG

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"

echo "▶ Pushing to GitHub..."
git push origin main

echo "▶ Deploying to Vercel..."
VERCEL_ORG_ID=$VERCEL_ORG_ID \
VERCEL_PROJECT_ID=$VERCEL_PROJECT_ID \
./node_modules/.bin/vercel --prod --force --token "$VERCEL_TOKEN"

echo "✅ Live at https://kjst-rfp.vercel.app"
