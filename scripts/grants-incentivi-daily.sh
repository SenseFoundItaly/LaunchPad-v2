#!/bin/bash
# Daily incentivi.gov.it sync, run from a machine that the source will talk to.
#
# incentivi.gov.it silently DROPS traffic from AWS and Azure ranges — proven on
# prod 2026-09-06: `connect ETIMEDOUT 94.86.69.151:443`, from both the Netlify
# function (AWS) and a GitHub Actions runner (Azure), while an ordinary machine
# connects in 38ms and other datacenters answer fine. It is not a blanket
# datacenter block, just the big two. So this one source syncs from here.
#
# The other two sources (SEDIA, Regione Lombardia) sync from the Netlify
# background function and need nothing from this script.
#
# Installed as a LaunchAgent — see scripts/launchd/README, or run:
#   scripts/launchd/install-incentivi-agent.sh
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

if [ ! -f .env.local ]; then
  echo "[grants][launchd] no .env.local at $REPO — cannot get DATABASE_URL" >&2
  exit 1
fi

# Only DATABASE_URL: the sync needs nothing else, and a narrower blast radius
# is worth the extra line.
DATABASE_URL="$(grep '^DATABASE_URL=' .env.local | head -1 | cut -d= -f2- | sed 's/^"//; s/"$//')"
export DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
  echo "[grants][launchd] DATABASE_URL is empty in .env.local" >&2
  exit 1
fi

# The installer bakes the real node directory into the plist's PATH. This is
# the belt-and-braces path for running the script by hand from a bare shell:
# guessing a single location was wrong on this machine (node lives in
# ~/.local/bin), so probe the places it actually turns up.
if ! command -v node >/dev/null 2>&1; then
  for d in "$HOME/.local/bin" /opt/homebrew/bin /usr/local/bin "$HOME/.nvm/versions/node"/*/bin; do
    if [ -x "$d/node" ]; then export PATH="$d:$PATH"; break; fi
  done
fi
if ! command -v node >/dev/null 2>&1; then
  echo "[grants][launchd] node not found on PATH — cannot run" >&2
  exit 1
fi

echo "[grants][launchd] $(date -u +%FT%TZ) starting"
npx tsx scripts/grants-sync-incentivi.mts "$@"
echo "[grants][launchd] $(date -u +%FT%TZ) done"
