#!/usr/bin/env bash
# deploy-fleet.sh — deploy every ready microsite to its own Cloudflare Pages
# project and register it as shipped on the fleet board. Idempotent: a
# sites/{id}/.deployed marker means "already live, skip". Safe to re-run as
# more sites are generated. Pre-deploy gate rejects sites missing the beacon,
# account_id, or the single CTA.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
set -a; source .env; set +a
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
BEACON="enchanted-stingray-115.convex.site/beacon"

shipped=0; skipped=0; failed=0
for d in sites/*/; do
  id=$(basename "$d")
  [ -f "$d/index.html" ] || continue
  if [ -f "$d/.deployed" ]; then skipped=$((skipped+1)); continue; fi

  # pre-deploy quality gate
  if ! grep -q "$BEACON" "$d/index.html" || ! grep -q "$id" "$d/index.html" || ! grep -q "data-cta" "$d/index.html"; then
    echo "GATE-FAIL $id: missing beacon/account_id/cta — not deploying"; failed=$((failed+1)); continue
  fi

  company=$(python3 -c "import json; print(json.load(open('$d/research.json')).get('company','$id'))" 2>/dev/null || echo "$id")
  echo "=== $id ($company) ==="
  npx wrangler pages project create "$id" --production-branch main >/dev/null 2>&1 || true
  if npx wrangler pages deploy "$d" --project-name "$id" --commit-dirty=true >/dev/null 2>&1; then
    url="https://$id.pages.dev"
    ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    ./scripts/factory-report.sh fleet "{\"account_id\":\"$id\",\"company\":\"$company\",\"stage\":\"deploy\",\"status\":\"shipped\",\"cost_usd\":0.72,\"url\":\"$url\",\"updated_at\":\"$ts\"}" >/dev/null 2>&1
    touch "$d/.deployed"
    echo "  SHIPPED $url"
    shipped=$((shipped+1))
  else
    echo "  DEPLOY-FAILED $id"; failed=$((failed+1))
  fi
done
echo "=== deploy-fleet: $shipped shipped, $skipped already-live, $failed failed ==="
