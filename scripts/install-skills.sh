#!/usr/bin/env bash
set -euo pipefail

# Installs repo skills into the Hermes runtime. Repo is the source of truth;
# never edit ~/.hermes/skills directly.

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS_SRC="$REPO_DIR/skills"
SKILLS_DST="${HERMES_HOME:-$HOME/.hermes}/skills"

if [ ! -d "$SKILLS_SRC" ]; then
  echo "error: $SKILLS_SRC not found — run from the repo" >&2
  exit 1
fi

mkdir -p "$SKILLS_DST"

for skill in distributor account-researcher microsite-builder qa-reviewer; do
  if [ ! -f "$SKILLS_SRC/$skill/SKILL.md" ]; then
    echo "error: missing $skill/SKILL.md in repo" >&2
    exit 1
  fi
  rm -rf "$SKILLS_DST/$skill"
  cp -r "$SKILLS_SRC/$skill" "$SKILLS_DST/$skill"
  echo "installed: $skill"
done

mkdir -p "${HERMES_HOME:-$HOME/.hermes}/factory/traces"

echo
echo "verifying with hermes..."
if command -v hermes >/dev/null 2>&1; then
  hermes skills list | grep -E "distributor|account-researcher|microsite-builder|qa-reviewer" || {
    echo "warn: skills not visible in hermes skills list — check profile" >&2
  }
else
  echo "warn: hermes not on PATH — skipped verification" >&2
fi

echo "done."
