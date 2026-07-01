#!/usr/bin/env bash
# Full bootstrap for the hiremind pod.
# Idempotent — safe to run multiple times.

set -euo pipefail

POD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$POD_DIR"

POD_NAME="hiremind"

step() { echo; echo "─── $* ───"; }

step "1. Sanity check"
if ! command -v lemma >/dev/null 2>&1; then
  echo "✗ The 'lemma' CLI is not installed."
  echo "  Install: pipx install lemma-cli   (or follow https://docs.lemma.work/cli)"
  exit 1
fi
lemma auth status >/dev/null || {
  echo "✗ Not logged in. Run: lemma auth login"
  exit 1
}
echo "✓ lemma CLI present + authenticated"

step "2. Create / select the pod"
if lemma pods get "$POD_NAME" >/dev/null 2>&1; then
  echo "✓ pod '$POD_NAME' already exists"
else
  lemma pods create "$POD_NAME"
  echo "✓ created pod '$POD_NAME'"
fi

step "3. Dry-run validation of the bundle"
lemma pods import . --dry-run --pod "$POD_NAME"

step "4. Import the bundle (upserts everything)"
lemma pods import . --pod "$POD_NAME" --yes

step "5. Seed knowledge files + demo records"
bash "$POD_DIR/scripts/seed.sh"

step "6. Build and deploy the operator app"
if [[ -d "./apps/operator/source/node_modules" ]]; then
  echo "✓ operator app deps already installed"
else
  (cd ./apps/operator/source && npm install --silent)
fi
(cd ./apps/operator/source && npm run build)
lemma apps deploy operator --yes

step "7. Deploy the candidate-side view"
lemma apps deploy candidate-view ./apps/candidate-view/html.html --yes

step "Done"
echo
echo "Next steps:"
echo "  • Open operator:        lemma apps open operator"
echo "  • Inspect pod:          lemma pods describe"
echo "  • Smoke test outreach:  lemma workflows run outreach --data '{\"candidate_id\":\"<id>\",\"channel\":\"email\"}'"
echo
echo "Connector setup (only needed once you want real sends):"
echo "  lemma connectors connect-requests create gmail"
echo "  lemma connectors connect-requests create twilio_whatsapp"
echo "  lemma connectors connect-requests create slack"
echo "  Then paste the account UUIDs into ./surfaces/*/*.json and re-run:"
echo "  lemma pods import ./surfaces"
