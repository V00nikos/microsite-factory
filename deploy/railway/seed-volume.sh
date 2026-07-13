#!/usr/bin/env bash
# seed-volume.sh — seed a freshly-created Railway /opt/data volume with the local
# Hermes state the factory pipeline needs, then verify. Run AFTER the service is
# up with the volume attached (see README.md). Idempotent-ish: re-running overwrites.
#
# Railway volumes are only reachable from inside the running container, so we tar
# the state locally and stream it in over `railway ssh`.
set -euo pipefail

RAILWAY_SERVICE="${1:-hermes-factory-worker}"
HERMES="${HERMES_HOME:-$HOME/.hermes}"
REPO="$HOME/microsite-factory"

command -v railway >/dev/null || { echo "railway CLI not found; brew install railway" >&2; exit 1; }

echo "Packaging Hermes state + repo (excluding caches/sessions)…"
TAR=$(mktemp /tmp/hermes-seed.XXXXXX.tgz)
tar -czf "$TAR" \
  -C "$HERMES" \
    .env config.yaml auth.json SOUL.md \
    profiles/factory-worker profiles/factory-manager \
    skills memories \
  -C "$HOME" \
    --exclude 'microsite-factory/node_modules' \
    --exclude 'microsite-factory/frontend/node_modules' \
    --exclude 'microsite-factory/.git' \
    --exclude 'microsite-factory/sites' \
    microsite-factory 2>/dev/null || {
      echo "tar hit missing optional paths; continuing with what exists" >&2; }

echo "Tarball: $TAR ($(du -h "$TAR" | cut -f1))"
echo "Streaming into the container's /opt/data via railway ssh…"
# /opt/data == HERMES_HOME in-container; the repo lands at /opt/data/microsite-factory
# so the skills' ~/microsite-factory/scripts/* paths resolve (HOME=/opt/data).
railway ssh --service "$RAILWAY_SERVICE" -- bash -lc '
  set -e
  mkdir -p /opt/data
  tar -xzf - -C /opt/data
  # hermes runtime user owns the volume
  chown -R "${HERMES_UID:-10000}:${HERMES_GID:-10000}" /opt/data || true
  echo "seeded. installing repo skills into the profile runtime…"
  bash /opt/data/microsite-factory/scripts/install-skills.sh || true
  echo "verifying:"; hermes doctor || true; hermes skills list | grep -E "distributor|account-researcher|microsite-builder|qa-reviewer" || true
' < "$TAR"

rm -f "$TAR"
echo "Done. Restart the service so the gateway picks up the seeded profiles:"
echo "  railway redeploy --service $RAILWAY_SERVICE"
