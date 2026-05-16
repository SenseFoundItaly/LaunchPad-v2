#!/usr/bin/env bash
set -euo pipefail

# ── SenseFound Deploy Script ─────────────────────────────────────────
# Builds locally to verify, commits, pushes, and Netlify auto-deploys.
# The site is Git-connected — pushing to main triggers production.
#
# Usage:
#   ./scripts/deploy.sh                    # Build, commit, push to main
#   ./scripts/deploy.sh -m "my message"    # Custom commit message
#   ./scripts/deploy.sh --dry-run          # Build only, don't push
# ─────────────────────────────────────────────────────────────────────

MSG=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--message) MSG="$2"; shift 2 ;;
    --dry-run)    DRY_RUN=true; shift ;;
    *)            shift ;;
  esac
done

echo "▸ Building Next.js (verifying before push)…"
npm run build

if [ "$DRY_RUN" = true ]; then
  echo "✓ Build passed. Dry run — skipping push."
  exit 0
fi

# Stage all tracked changes
echo "▸ Staging changes…"
git add -A

# Check if there's anything to commit
if git diff --cached --quiet; then
  echo "✓ No changes to commit. Push any unpushed commits…"
else
  COMMIT_MSG="${MSG:-deploy: $(date +%Y-%m-%d_%H:%M)}"
  echo "▸ Committing: $COMMIT_MSG"
  git commit -m "$COMMIT_MSG"
fi

echo "▸ Pushing to origin/main…"
git push origin main

echo "✓ Pushed. Netlify will auto-build and deploy to production."
echo "  Track at: https://app.netlify.com/projects/lustrous-bavarois-a2a86b/deploys"
