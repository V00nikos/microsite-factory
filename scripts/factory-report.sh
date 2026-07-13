#!/usr/bin/env bash
# factory-report.sh — the pipeline's only state write path (CLAUDE.md rule 6).
# One call does BOTH writes so skills need a single, allowlistable command:
#   1. Local JSONL append (source of truth):
#        trace -> ~/.hermes/factory/traces/{UTC date}.jsonl
#        fleet -> ~/.hermes/factory/fleet.jsonl
#   2. Convex mirror:
#      - CONVEX_SITE_URL set:   POST to $CONVEX_SITE_URL/<endpoint> with x-factory-key.
#                               One retry after 2s. Second failure = loud, nonzero exit
#                               (payload is still spooled so no data is lost).
#      - CONVEX_SITE_URL unset: append to the local spool
#                               (~/.hermes/factory/pending-convex.jsonl) and exit 0 —
#                               replay the spool once Convex exists.
#
# Usage: factory-report.sh <fleet|trace> '<json-payload>'
set -uo pipefail

ENDPOINT="${1:-}"
PAYLOAD="${2:-}"

if [[ "$ENDPOINT" != "fleet" && "$ENDPOINT" != "trace" ]] || [[ -z "$PAYLOAD" ]]; then
  echo "usage: factory-report.sh <fleet|trace> '<json-payload>'" >&2
  exit 2
fi

# Reject malformed JSON immediately — a skill emitting garbage is a bug to surface
# early — and compact it to one line so JSONL files stay one-record-per-line.
PAYLOAD="$(python3 -c 'import json,sys; print(json.dumps(json.loads(sys.argv[1]), separators=(",",":")))' "$PAYLOAD" 2>/dev/null)" || {
  echo "factory-report: payload is not valid JSON — refusing to send" >&2
  exit 2
}

# Env fallback: the Hermes terminal tool does not always export the gateway env.
load_key() {
  local key="$1"
  [[ -n "${!key:-}" ]] && return 0
  local f val
  for f in "$HOME/.hermes/.env" "$HOME/microsite-factory/.env"; do
    [[ -f "$f" ]] || continue
    val="$(grep -m1 "^${key}=" "$f" | cut -d= -f2-)"
    if [[ -n "$val" ]]; then printf -v "$key" '%s' "$val"; return 0; fi
  done
  return 1
}
load_key CONVEX_SITE_URL || true
load_key FACTORY_KEY || true

SPOOL_DIR="$HOME/.hermes/factory"
SPOOL="$SPOOL_DIR/pending-convex.jsonl"
mkdir -p "$SPOOL_DIR" "$SPOOL_DIR/traces"

# Local append first — this is the pipeline's source of truth regardless of Convex.
if [[ "$ENDPOINT" == "trace" ]]; then
  LOCAL_LOG="$SPOOL_DIR/traces/$(date -u +%Y-%m-%d).jsonl"
else
  LOCAL_LOG="$SPOOL_DIR/fleet.jsonl"
fi
printf '%s\n' "$PAYLOAD" >> "$LOCAL_LOG"
echo "factory-report: logged $ENDPOINT -> $LOCAL_LOG"

spool() {
  printf '{"endpoint":"%s","spooled_at":"%s","payload":%s}\n' \
    "$ENDPOINT" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$PAYLOAD" >> "$SPOOL"
}

if [[ -z "${CONVEX_SITE_URL:-}" ]]; then
  spool
  echo "factory-report: SPOOLED $ENDPOINT (Convex not configured yet) -> $SPOOL"
  exit 0
fi

if [[ -z "${FACTORY_KEY:-}" ]]; then
  echo "factory-report: FACTORY_KEY not set — cannot authenticate to Convex" >&2
  spool
  exit 1
fi

post() {
  curl -sS -m 15 -o /tmp/factory-report-resp.$$ -w '%{http_code}' \
    -X POST "$CONVEX_SITE_URL/$ENDPOINT" \
    -H "Content-Type: application/json" \
    -H "x-factory-key: $FACTORY_KEY" \
    -d "$PAYLOAD" 2>/tmp/factory-report-err.$$
}

for attempt in 1 2; do
  code="$(post)" || code="000"
  if [[ "$code" =~ ^2 ]]; then
    echo "factory-report: OK $ENDPOINT ($code)"
    rm -f /tmp/factory-report-resp.$$ /tmp/factory-report-err.$$
    exit 0
  fi
  [[ "$attempt" == 1 ]] && sleep 2
done

echo "factory-report: FAILED to POST $ENDPOINT after 2 attempts (HTTP $code)" >&2
echo "  response: $(cat /tmp/factory-report-resp.$$ 2>/dev/null | head -c 400)" >&2
echo "  error:    $(cat /tmp/factory-report-err.$$ 2>/dev/null | head -c 400)" >&2
rm -f /tmp/factory-report-resp.$$ /tmp/factory-report-err.$$
spool
echo "  payload spooled to $SPOOL for replay" >&2
exit 1
