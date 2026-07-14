#!/usr/bin/env bash
set -euo pipefail
# ---------------------------------------------------------------------------
# Deploy to the STAGING Netlify site.
#
# Staging is a SEPARATE Netlify site + a SEPARATE Supabase project, so a staging
# deploy can NEVER touch prod (different site id, different database). The
# deployed site reads its env from the STAGING site's Netlify settings (populate
# / refresh them from .env.staging with the commented env:import line below).
#
# Prod is deployed the usual way (`npm run deploy` from the main checkout) —
# this script does not affect it.
# ---------------------------------------------------------------------------
STAGING_SITE_ID="a0eeffdc-8c4f-48a8-b01b-f800210a03dc"
STAGING_URL="https://launchpad-staging.netlify.app"

echo "→ Deploying to STAGING ($STAGING_SITE_ID)…"
# Refresh staging env from .env.staging (uncomment when env changes):
# npx netlify-cli env:import .env.staging --site "$STAGING_SITE_ID"
npx netlify-cli deploy --build --prod --site "$STAGING_SITE_ID"
echo "✓ Staging live → $STAGING_URL"
