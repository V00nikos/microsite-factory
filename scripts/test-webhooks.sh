#!/usr/bin/env bash
# test-webhooks.sh — fires signed sample payloads at the three Microsite
# Factory webhooks (run-factory, regenerate, update-positioning) and asserts:
#
#   1. A correctly HMAC-signed request is ACCEPTED (2xx / 202 Accepted).
#   2. One deliberately WRONG-signature request is REJECTED (non-2xx) — the
#      gateway validates the signature before it even looks up the route, so
#      this is checked once, not per-webhook (see docs/webhook-setup.md §1).
#   3. Within a bounded poll window, a resulting fleet-state change appears.
#
# HMAC scheme (see docs/webhook-setup.md §1 for the full rationale — this
# matches CLAUDE.md "Webhook payloads" and Hermes' generic V1 webhook
# signature validator in gateway/platforms/webhook.py):
#
#   header: X-Webhook-Signature: <hex HMAC-SHA256 of the EXACT raw POST body>
#   secret: WEBHOOK_HMAC_SECRET (must equal whatever was passed to --secret
#           on each `hermes webhook subscribe ...` command)
#
# This script does NOT run `hermes webhook subscribe` — the human does that
# (docs/webhook-setup.md §5). It also does not deploy anything.
#
# Degradation instead of false failures: if the base URL is unreachable,
# the script does NOT report the live round-trip checks as failed (per this
# task's own constraint: don't fire at a nonexistent endpoint expecting
# success). It still runs — and reports PASS/FAIL on — everything checkable
# offline: JSON validity of each sample payload, and the HMAC computation
# itself (verified against a known test vector). Exit code:
#   0 = all applicable checks passed
#   1 = at least one check genuinely failed (bad signature accepted, a
#       correctly-signed request was rejected, JSON/HMAC math is wrong, or
#       no fleet-state change appeared within the poll window)
#   2 = base URL unreachable — only offline checks ran (not a failure of
#       this tooling; run again once the gateway is up and subscriptions
#       exist)
#
# Usage:
#   scripts/test-webhooks.sh [--base URL] [--poll-timeout SECONDS]
#
# Env:
#   HERMES_WEBHOOK_BASE        base URL, e.g. https://your-app.up.railway.app
#                              (default: http://localhost:8644, the gateway's
#                              local bind address per `hermes webhook list`)
#   WEBHOOK_HMAC_SECRET        shared HMAC secret — loaded like
#                              factory-report.sh: process env, else
#                              ~/.hermes/.env, else repo .env
#   CONVEX_SITE_URL            optional — used only for an informational
#                              probe; see the note in check_state_change()
#   FACTORY_KEY                optional — only used for the Convex probe
#   TEST_WEBHOOK_POLL_TIMEOUT  overrides the default 60s poll window

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

BASE="${HERMES_WEBHOOK_BASE:-http://localhost:8644}"
POLL_TIMEOUT="${TEST_WEBHOOK_POLL_TIMEOUT:-60}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base) BASE="$2"; shift 2 ;;
    --poll-timeout) POLL_TIMEOUT="$2"; shift 2 ;;
    -h|--help)
      sed -n '1,45p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done
BASE="${BASE%/}"

# ---------------------------------------------------------------------------
# Env loading — mirrors scripts/factory-report.sh's fallback chain exactly
# (process env -> ~/.hermes/.env -> repo .env) without modifying that file.
# ---------------------------------------------------------------------------
load_key() {
  local key="$1"
  [[ -n "${!key:-}" ]] && return 0
  local f val
  for f in "$HOME/.hermes/.env" "$REPO_ROOT/.env"; do
    [[ -f "$f" ]] || continue
    val="$(grep -m1 "^${key}=" "$f" | cut -d= -f2-)"
    if [[ -n "$val" ]]; then printf -v "$key" '%s' "$val"; return 0; fi
  done
  return 1
}
load_key WEBHOOK_HMAC_SECRET || true
load_key CONVEX_SITE_URL || true
load_key FACTORY_KEY || true

if [[ -z "${WEBHOOK_HMAC_SECRET:-}" ]]; then
  echo "test-webhooks: WEBHOOK_HMAC_SECRET not set in env, ~/.hermes/.env, or $REPO_ROOT/.env — cannot sign anything" >&2
  exit 2
fi

FLEET_LOG="$HOME/.hermes/factory/fleet.jsonl"
MEMORY_MD="$HOME/.hermes/profiles/factory-worker/memories/MEMORY.md"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

PASS=0
FAIL=0
SKIP=0
declare -a RESULT_LINES=()

record() {
  # record <PASS|FAIL|SKIP> <label> <detail>
  local status="$1" label="$2" detail="$3"
  case "$status" in
    PASS) PASS=$((PASS+1)) ;;
    FAIL) FAIL=$((FAIL+1)) ;;
    SKIP) SKIP=$((SKIP+1)) ;;
  esac
  RESULT_LINES+=("$status|$label|$detail")
}

# ---------------------------------------------------------------------------
# HMAC helper — hex HMAC-SHA256 of the exact bytes in $1 (a file path),
# using openssl dgst -sha256 -hmac as instructed. Verified below against a
# known test vector so a broken openssl/sed pipeline fails loudly rather
# than silently signing garbage.
# ---------------------------------------------------------------------------
hmac_hex() {
  local file="$1" secret="$2"
  openssl dgst -sha256 -hmac "$secret" "$file" | sed 's/^.*= //'
}

echo "=== Offline sanity checks (no network required) ==="

# Known-answer test: HMAC-SHA256("mysecret", '{"test":true}') per RFC 2104 /
# python hmac cross-check done during development of this script.
KAT_FILE="$WORKDIR/kat.json"
printf '%s' '{"test":true}' > "$KAT_FILE"
KAT_EXPECTED="f269168b331c2c56aa328857bfcda87bacca5e4e1da4da687667068a21dd3c53"
KAT_ACTUAL="$(hmac_hex "$KAT_FILE" "mysecret")"
if [[ "$KAT_ACTUAL" == "$KAT_EXPECTED" ]]; then
  record PASS "hmac-known-answer-test" "openssl dgst HMAC-SHA256 matches expected hex digest"
else
  record FAIL "hmac-known-answer-test" "expected $KAT_EXPECTED, got $KAT_ACTUAL — openssl/sed pipeline is broken, all signed requests below are suspect"
fi
echo "  hmac-known-answer-test: $KAT_ACTUAL"

MARK="wh$(date +%s)"

# ---------------------------------------------------------------------------
# Sample payload builders — python3 for correct JSON escaping (same reason
# factory-report.sh shells out to python3 rather than hand-building JSON).
# ---------------------------------------------------------------------------
build_run_factory_payload() {
  python3 -c "
import json, sys
mark = sys.argv[1]
print(json.dumps({
    'rows': [{
        'company': f'Webhook Test Co {mark}',
        'domain': f'webhook-test-{mark}.example.com',
        'contact_title': 'VP Engineering',
        'vertical': 'devtools',
        'contact_name': 'Test Contact',
        'notes': 'Synthetic row from scripts/test-webhooks.sh -- safe to delete from the fleet.',
    }]
}))
" "$MARK"
}

build_regenerate_payload() {
  python3 -c "
import json, sys
mark = sys.argv[1]
print(json.dumps({
    'account_id': f'webhook-test-{mark}',
    'mode': 'instruction',
    'angle': 'speed',
    'instruction': 'Synthetic smoke test from scripts/test-webhooks.sh -- make the hero punchier.',
}))
" "$MARK"
}

build_update_positioning_payload() {
  python3 -c "
import json
print(json.dumps({
    'one_liner': '[TEST] We ship research-grade microsites, not merge-tag spam.',
    'proof_points': [
        {'tag': 'technical', 'text': 'Every claim on the page cites a sourced finding.'},
        {'tag': 'roi', 'text': 'Cost per site stays under \$2 with graceful degradation.'},
        {'tag': 'gtm', 'text': \"One signature element derived from the target's own stack.\"},
    ],
    'tone_rules': ['active voice', 'sentence case', 'no hype adjectives'],
    'forbidden_claims': ['guaranteed replies', 'AI replaces your SDR team'],
    'verticals': ['devtools', 'fintech'],
}))
"
}

validate_json() {
  python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$1" 2>/dev/null
}

# ---------------------------------------------------------------------------
# Reachability preflight
# ---------------------------------------------------------------------------
echo
echo "=== Preflight: $BASE ==="
HEALTH_CODE="$(curl -sS -m 5 -o /dev/null -w '%{http_code}' "$BASE/health" 2>/dev/null)" || HEALTH_CODE="000"
GATEWAY_UP=false
if [[ "$HEALTH_CODE" =~ ^[0-9]+$ ]] && [[ "$HEALTH_CODE" != "000" ]]; then
  GATEWAY_UP=true
  echo "  reachable (GET /health -> $HEALTH_CODE)"
else
  echo "  UNREACHABLE ($BASE/health did not respond) — running offline-only checks."
  echo "  This is expected if the gateway isn't running yet, or if the human hasn't"
  echo "  run the subscribe commands in docs/webhook-setup.md yet. Not counted as FAIL."
fi

if [[ -n "${CONVEX_SITE_URL:-}" ]]; then
  echo "  note: CONVEX_SITE_URL is set ($CONVEX_SITE_URL), but per the frozen HTTP"
  echo "  actions contract (CLAUDE.md) /fleet is POST-only -- there is no GET/query"
  echo "  action to read fleet state back. This script relies on the local"
  echo "  $FLEET_LOG append as the authoritative state-change signal instead."
fi

# ---------------------------------------------------------------------------
# fleet.jsonl snapshot helpers
# ---------------------------------------------------------------------------
fleet_line_count() {
  [[ -f "$FLEET_LOG" ]] && wc -l < "$FLEET_LOG" | tr -d ' ' || echo 0
}

fleet_contains_marker() {
  local marker="$1"
  [[ -f "$FLEET_LOG" ]] && grep -qF "$marker" "$FLEET_LOG"
}

memory_contains_marker() {
  local marker="$1"
  [[ -f "$MEMORY_MD" ]] && grep -qF "$marker" "$MEMORY_MD"
}

poll_for_condition() {
  # poll_for_condition <timeout_s> <check_cmd...>
  local timeout="$1"; shift
  local waited=0
  while (( waited < timeout )); do
    if "$@"; then return 0; fi
    sleep 3
    waited=$((waited+3))
  done
  return 1
}

# ---------------------------------------------------------------------------
# Fire one signed webhook and report PASS/FAIL/SKIP
# ---------------------------------------------------------------------------
fire_webhook() {
  local name="$1" payload="$2" state_check_desc="$3"
  shift 3
  local state_check=("$@")   # command to run; returns 0 once state changed

  local body_file="$WORKDIR/${name}.json"
  printf '%s' "$payload" > "$body_file"

  if ! validate_json "$body_file"; then
    record FAIL "${name}:json-valid" "sample payload is not valid JSON"
    return
  fi
  record PASS "${name}:json-valid" "sample payload is valid JSON"

  if [[ "$GATEWAY_UP" != true ]]; then
    record SKIP "${name}:round-trip" "gateway unreachable at $BASE — signed POST not attempted"
    return
  fi

  local sig url resp_file http_code
  sig="$(hmac_hex "$body_file" "$WEBHOOK_HMAC_SECRET")"
  url="$BASE/webhooks/$name"
  resp_file="$WORKDIR/${name}.resp"

  http_code="$(curl -sS -m 20 -o "$resp_file" -w '%{http_code}' \
    -X POST "$url" \
    -H "Content-Type: application/json" \
    -H "X-Webhook-Signature: $sig" \
    --data-binary @"$body_file" 2>/dev/null)" || http_code="000"

  if [[ "$http_code" =~ ^2 ]]; then
    record PASS "${name}:accepted" "signed POST to $url -> HTTP $http_code"
  else
    record FAIL "${name}:accepted" "signed POST to $url -> HTTP $http_code (body: $(head -c 300 "$resp_file" 2>/dev/null)) — is this route subscribed? (hermes webhook list)"
    return
  fi

  echo "  ${name}: polling up to ${POLL_TIMEOUT}s for $state_check_desc ..."
  if poll_for_condition "$POLL_TIMEOUT" "${state_check[@]}"; then
    record PASS "${name}:state-change" "$state_check_desc observed within ${POLL_TIMEOUT}s"
  else
    record FAIL "${name}:state-change" "$state_check_desc NOT observed within ${POLL_TIMEOUT}s — request was accepted (202) so the agent turn may still be running in the background; rerun with --poll-timeout N to wait longer, or check 'hermes logs -n 50'"
  fi
}

echo
echo "=== run-factory ==="
RUN_FACTORY_PAYLOAD="$(build_run_factory_payload)"
fire_webhook "run-factory" "$RUN_FACTORY_PAYLOAD" \
  "a fleet.jsonl row for company 'Webhook Test Co $MARK'" \
  fleet_contains_marker "Webhook Test Co $MARK"

echo
echo "=== regenerate ==="
REGENERATE_PAYLOAD="$(build_regenerate_payload)"
fire_webhook "regenerate" "$REGENERATE_PAYLOAD" \
  "a fleet.jsonl row for account_id 'webhook-test-$MARK'" \
  fleet_contains_marker "webhook-test-$MARK"

echo
echo "=== update-positioning ==="
UPDATE_POSITIONING_PAYLOAD="$(build_update_positioning_payload)"
echo "  note: update-positioning rewrites the factory-worker profile's MEMORY.md,"
echo "  not fleet.jsonl -- the state-change check below looks for the test"
echo "  one_liner in that MEMORY.md (best-effort; only checkable if this script"
echo "  runs on the same host as the Hermes gateway)."
fire_webhook "update-positioning" "$UPDATE_POSITIONING_PAYLOAD" \
  "the '[TEST]' one_liner in $MEMORY_MD" \
  memory_contains_marker "[TEST] We ship research-grade microsites"

# ---------------------------------------------------------------------------
# Bad-signature rejection check (once, not per-webhook — the gateway
# validates the signature before route-specific logic runs at all).
# ---------------------------------------------------------------------------
echo
echo "=== bad-signature rejection ==="
if [[ "$GATEWAY_UP" != true ]]; then
  record SKIP "bad-signature-rejected" "gateway unreachable at $BASE — not attempted"
else
  BAD_BODY_FILE="$WORKDIR/bad-sig.json"
  printf '%s' "$RUN_FACTORY_PAYLOAD" > "$BAD_BODY_FILE"
  BAD_SIG="0000000000000000000000000000000000000000000000000000000000000000"
  BAD_URL="$BASE/webhooks/run-factory"
  BAD_RESP_FILE="$WORKDIR/bad-sig.resp"
  BAD_HTTP_CODE="$(curl -sS -m 20 -o "$BAD_RESP_FILE" -w '%{http_code}' \
    -X POST "$BAD_URL" \
    -H "Content-Type: application/json" \
    -H "X-Webhook-Signature: $BAD_SIG" \
    --data-binary @"$BAD_BODY_FILE" 2>/dev/null)" || BAD_HTTP_CODE="000"

  if [[ "$BAD_HTTP_CODE" =~ ^2 ]]; then
    record FAIL "bad-signature-rejected" "wrong signature was ACCEPTED (HTTP $BAD_HTTP_CODE) — this is a real security failure, investigate immediately"
  else
    record PASS "bad-signature-rejected" "wrong signature correctly rejected (HTTP $BAD_HTTP_CODE)"
  fi
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo
echo "================================================================"
echo "  WEBHOOK TEST SUMMARY"
echo "================================================================"
for line in "${RESULT_LINES[@]}"; do
  IFS='|' read -r status label detail <<< "$line"
  printf "  [%-4s] %-32s %s\n" "$status" "$label" "$detail"
done
echo "----------------------------------------------------------------"
echo "  PASS=$PASS  FAIL=$FAIL  SKIP=$SKIP"
echo "================================================================"

if (( FAIL > 0 )); then
  echo "RESULT: FAIL — at least one check genuinely failed." >&2
  exit 1
elif [[ "$GATEWAY_UP" != true ]]; then
  echo "RESULT: gateway unreachable — only offline checks ran (not a failure)." >&2
  exit 2
else
  echo "RESULT: PASS — all checks passed."
  exit 0
fi
