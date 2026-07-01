#!/usr/bin/env bash
# Seed the hiremind pod with demo data + knowledge files.
# Run AFTER `lemma pods import .`. Idempotent: safe to re-run.

set -euo pipefail

POD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$POD_DIR"

if ! command -v lemma >/dev/null 2>&1; then
  echo "✗ lemma CLI not found on PATH. Install with: pipx install lemma-cli" >&2
  exit 1
fi

echo "→ Hiremind pod seed (running from: $POD_DIR)"

active_pod="$(lemma pods describe 2>/dev/null | head -1 || true)"
if [[ -z "$active_pod" ]]; then
  echo "✗ No active pod. Run: lemma pods create hiremind && lemma pods import ." >&2
  exit 1
fi

echo
echo "→ Uploading knowledge files (founder voice + role rubrics)…"
lemma files mkdir /knowledge >/dev/null 2>&1 || true
lemma files mkdir /knowledge/roles >/dev/null 2>&1 || true

# Walk the seed-files tree and upload each markdown into the matching pod path
find ./payloads/seed-files -type f -name '*.md' | while read -r local_path; do
  rel="${local_path#./payloads/seed-files}"
  pod_path="$rel"
  parent_dir="$(dirname "$pod_path")"
  lemma files mkdir "$parent_dir" >/dev/null 2>&1 || true
  echo "   uploading $pod_path"
  lemma files upload "$local_path" "$pod_path" >/dev/null
done

echo
echo "→ Seeding roles (3)…"
lemma records import roles ./payloads/seed-roles.jsonl >/dev/null
echo "   ✓ roles loaded"

echo
echo "→ Seeding candidates (7 demo rows)…"
lemma records import candidates ./payloads/seed-candidates.jsonl >/dev/null
echo "   ✓ candidates loaded"

echo
echo "→ Verifying…"
lemma query run "select stage, count(*) as n from candidates group by stage order by stage" 2>/dev/null || true

echo
echo "✓ Seed complete. Open the operator app:"
echo "    lemma apps open operator"
