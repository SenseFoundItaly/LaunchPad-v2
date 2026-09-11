#!/usr/bin/env bash
set -euo pipefail

# ── SenseFound Deploy Script ─────────────────────────────────────────
# Builds locally via the Netlify CLI (includes OpenNext adapter
# post-processing for SSR functions + edge middleware), then uploads
# the built output directly to Netlify production.
#
# Usage:
#   ./scripts/deploy.sh                    # Build + deploy to production
#   ./scripts/deploy.sh --dry-run          # Build only, don't deploy
#   ./scripts/deploy.sh --preview          # Deploy to a preview URL (not prod)
#
# Prerequisites:
#   npx netlify-cli login   (authenticate as start@sensefound.io / Launchpad team)
# ─────────────────────────────────────────────────────────────────────

DRY_RUN=false
PREVIEW=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)  DRY_RUN=true; shift ;;
    --preview)  PREVIEW=true; shift ;;
    *)          shift ;;
  esac
done

echo "▸ Building locally with Netlify CLI (Next.js + OpenNext adapter)…"
npx netlify-cli build

if [ "$DRY_RUN" = true ]; then
  echo "✓ Build passed. Dry run — skipping deploy."
  exit 0
fi

if [ "$PREVIEW" = true ]; then
  echo "▸ Deploying to preview URL…"
  npx netlify-cli deploy
else
  echo "▸ Deploying to production…"
  npx netlify-cli deploy --prod
fi

echo ""
echo "✓ Deploy complete."
echo "  Site: https://launchpad.sensefound.io"
echo "  Logs: https://app.netlify.com/projects/lustrous-bavarois-a2a86b/deploys"
