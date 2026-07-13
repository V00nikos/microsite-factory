#!/usr/bin/env bash
# replay-spool.sh — drains ~/.hermes/factory/pending-convex.jsonl, the spool
# scripts/factory-report.sh writes to whenever CONVEX_SITE_URL was unset (or
# a POST to Convex failed twice) at write time, so no pipeline state is ever
# lost while Convex is unreachable/unconfigured.
#
# Each spooled line is exactly:
#   {"endpoint":"fleet|trace","spooled_at":"<UTC ISO8601>","payload":{...}}
#
# For each line: POST payload to $CONVEX_SITE_URL/<endpoint> with the
# x-factory-key header (same auth CLAUDE.md's frozen /fleet and /trace HTTP
# actions require). On a 2xx response, the line is dropped. On any other
# response, the line is kept, verbatim, for the next replay attempt. The
# spool file is rewritten with only the still-failing lines.
#
# Env is loaded exactly like scripts/factory-report.sh: process env first,
# then ~/.hermes/.env, then the repo .env (that file is not modified here).
#
# Usage: scripts/replay-spool.sh [--spool PATH] [--dry-run]

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SPOOL_DIR="$HOME/.hermes/factory"
SPOOL="$SPOOL_DIR/pending-convex.jsonl"
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --spool) SPOOL="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help)
      sed -n '1,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------------------
# Env loading — mirrors scripts/factory-report.sh's fallback chain exactly.
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
load_key CONVEX_SITE_URL || true
load_key FACTORY_KEY || true

if [[ -z "${CONVEX_SITE_URL:-}" ]]; then
  echo "replay-spool: CONVEX_SITE_URL is not set (checked process env, ~/.hermes/.env, $REPO_ROOT/.env)." >&2
  echo "  Refusing to run — there is nowhere to replay the spool to yet." >&2
  echo "  Set CONVEX_SITE_URL once the Convex deployment exists, then re-run this script." >&2
  exit 1
fi

if [[ -z "${FACTORY_KEY:-}" ]]; then
  echo "replay-spool: FACTORY_KEY is not set — cannot authenticate to Convex's /fleet or /trace." >&2
  echo "  Refusing to run." >&2
  exit 1
fi

if [[ ! -f "$SPOOL" ]]; then
  echo "replay-spool: no spool file at $SPOOL — nothing to replay (0 replayed, 0 remain)."
  exit 0
fi

TOTAL=0
REPLAYED=0
KEEP_FILE="$(mktemp)"
trap 'rm -f "$KEEP_FILE"' EXIT

post_one() {
  # post_one <endpoint> <payload_json_compact> <resp_file> -> prints http_code
  # (resp_file is passed in by the caller, not created here — this runs
  # inside a $(...) subshell via command substitution, so any variable this
  # function assigns is invisible to the caller; only stdout survives.)
  local endpoint="$1" payload="$2" resp_file="$3"
  curl -sS -m 15 -o "$resp_file" -w '%{http_code}' \
    -X POST "$CONVEX_SITE_URL/$endpoint" \
    -H "Content-Type: application/json" \
    -H "x-factory-key: $FACTORY_KEY" \
    -d "$payload" 2>/dev/null
}

while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "${line// /}" ]] && continue
  TOTAL=$((TOTAL+1))

  # Parse + validate with python3 (same reasoning as factory-report.sh: shell
  # JSON handling by hand is a bug magnet). A line that isn't valid
  # {"endpoint":...,"payload":...} JSON is kept as-is so it isn't silently
  # discarded — it needs human attention, not deletion.
  PARSED="$(python3 -c "
import json, sys
try:
    obj = json.loads(sys.argv[1])
    endpoint = obj['endpoint']
    payload = obj['payload']
    if endpoint not in ('fleet', 'trace'):
        raise ValueError('bad endpoint')
    print(endpoint)
    print(json.dumps(payload, separators=(',', ':')))
except Exception:
    sys.exit(1)
" "$line" 2>/dev/null)" || {
    echo "replay-spool: SKIPPING malformed spool line (kept for manual review): ${line:0:200}" >&2
    printf '%s\n' "$line" >> "$KEEP_FILE"
    continue
  }

  ENDPOINT="$(sed -n '1p' <<< "$PARSED")"
  PAYLOAD="$(sed -n '2p' <<< "$PARSED")"

  if [[ "$DRY_RUN" == true ]]; then
    echo "replay-spool: [dry-run] would POST $ENDPOINT -> $CONVEX_SITE_URL/$ENDPOINT"
    printf '%s\n' "$line" >> "$KEEP_FILE"
    continue
  fi

  RESP_FILE="$(mktemp)"
  CODE="$(post_one "$ENDPOINT" "$PAYLOAD" "$RESP_FILE")" || CODE="000"
  if [[ "$CODE" =~ ^2 ]]; then
    echo "replay-spool: OK $ENDPOINT ($CODE) — dropping spooled line"
    REPLAYED=$((REPLAYED+1))
  else
    echo "replay-spool: FAILED $ENDPOINT ($CODE) — keeping for next replay" >&2
    echo "  response: $(head -c 300 "$RESP_FILE" 2>/dev/null)" >&2
    printf '%s\n' "$line" >> "$KEEP_FILE"
  fi
  rm -f "$RESP_FILE"
done < "$SPOOL"

# Rewrite the spool with only the still-failing (or malformed / dry-run)
# lines. Atomic-ish: write to a temp file in the same dir, then move.
FINAL_TMP="$SPOOL_DIR/.pending-convex.jsonl.tmp.$$"
if [[ -f "$KEEP_FILE" ]]; then
  cp "$KEEP_FILE" "$FINAL_TMP"
else
  : > "$FINAL_TMP"
fi
mv "$FINAL_TMP" "$SPOOL"

REMAIN=$(( TOTAL - REPLAYED ))
echo "----------------------------------------------------------------"
if [[ "$DRY_RUN" == true ]]; then
  echo "replay-spool: DRY RUN — $TOTAL line(s) inspected, 0 replayed, spool unchanged."
else
  echo "replay-spool: $REPLAYED / $TOTAL replayed successfully; $REMAIN remain in $SPOOL."
fi

if [[ "$DRY_RUN" != true ]] && (( REMAIN > 0 )); then
  exit 1
fi
exit 0
