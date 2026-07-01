# Hiremind — pod bundle

Founder-led hiring co-pilot, built on Lemma. Candidates are rows, conversations
are workflows, and **nothing leaves the pod without your approval**.

> This folder IS the pod. Edit files, run `lemma pods import .`, the pod updates.

---

## 0. What's inside

```
hiremind/
├── pod.json                     # bundle manifest
├── tables/                      # 7 shared tables — candidates, roles, etc.
├── functions/                   # 6 deterministic Python functions
├── agents/                      # 5 LLM agents (intake, outreach, …)
├── workflows/                   # 6 DAGs (intake, outreach, reply_handler, …)
├── schedules/                   # 2 cron-based triggers (Mon + Fri digests)
├── surfaces/                    # WhatsApp / Gmail / Slack stubs
├── files/                       # folder metadata (knowledge + per-candidate)
├── apps/
│   ├── operator/                # Vite + React operator UI
│   └── candidate-view/          # single-file HTML public view
├── payloads/                    # demo seed records + seed knowledge files
└── scripts/                     # setup.sh, seed.sh
```

---

## 1. Prerequisites

| | |
|---|---|
| Lemma CLI | `pipx install lemma-cli` — verify with `lemma --version` |
| Lemma account | `lemma auth login` (cloud) or run a local stack — either works |
| Node ≥ 20 | for building the operator app |
| Python 3.11+ | only if you want to lint the function code locally |

You do **not** need any connector keys to see the pod working end-to-end with mock
data in the operator app. Connectors (Gmail / WhatsApp / Slack) are added later.

---

## 2. One-shot bootstrap

```bash
cd hiremind/pod
./scripts/setup.sh
```

That will:

1. Create the pod (or reuse the existing one).
2. Dry-run validate the bundle (`lemma pods import . --dry-run`).
3. Import every resource (tables → functions → agents → apps → workflows → schedules → surfaces).
4. Upload knowledge files (founder voice sample + 3 role rubrics).
5. Seed 3 roles + 7 demo candidates.
6. Build and deploy the operator app and the candidate-side view.

Open the operator:

```bash
lemma apps open operator
```

---

## 3. Manual step-by-step (the same thing, broken out)

```bash
# A. Create + select the pod
lemma pods create hiremind
# (the CLI marks this as active for you)

# B. Validate then import
lemma pods import . --dry-run
lemma pods import .

# C. Upload knowledge files (these don't travel in bundles)
lemma files mkdir /knowledge/roles
lemma files upload ./payloads/seed-files/knowledge/founder-voice.md  /knowledge/founder-voice.md
lemma files upload ./payloads/seed-files/knowledge/roles/ai-pm/rubric.md  /knowledge/roles/ai-pm/rubric.md
lemma files upload ./payloads/seed-files/knowledge/roles/ai-pm/pitch.md   /knowledge/roles/ai-pm/pitch.md
lemma files upload ./payloads/seed-files/knowledge/roles/senior-fe/rubric.md /knowledge/roles/senior-fe/rubric.md
lemma files upload ./payloads/seed-files/knowledge/roles/founding-de/rubric.md /knowledge/roles/founding-de/rubric.md

# D. Seed records
lemma records import roles      ./payloads/seed-roles.jsonl
lemma records import candidates ./payloads/seed-candidates.jsonl

# E. Build + deploy the operator app
cd apps/operator/source && npm install && npm run build && cd -
lemma apps deploy operator --yes

# F. Deploy the candidate-side view (single HTML, no build)
lemma apps deploy candidate-view ./apps/candidate-view/html.html --yes
```

---

## 4. Smoke tests (verify each layer)

```bash
# tables
lemma query run "select stage, count(*) as n from candidates group by stage"

# agents — chat directly
lemma agents chat intake_parser "https://linkedin.com/in/jeffdean — referred by Rohit"
lemma agents chat outreach_drafter --data '{"candidate_id":"<paste a real id>"}'
lemma agents chat digest_composer  --data '{"pipeline_state":{"stale_replies":[],"decisions_pending":[],"new_arrivals":[],"referrer_updates_due":[],"active_count":7,"offer_count":1}}'

# functions
lemma functions run compute_pipeline_state --data '{}'

# workflows
lemma workflows run intake   --data '{"raw":"https://linkedin.com/in/aartikrishnan","channel_hint":"linkedin"}'
lemma workflows run outreach --data '{"candidate_id":"<paste>","channel":"email"}'
# (the outreach run will pause on the FORM approval node — submit it:)
lemma workflows runs waiting     # find your run id
lemma workflows runs submit-form <run-id> --data '{"approved":true}'

# apps
lemma apps open operator
lemma apps open candidate-view --path "/c/aarti-krishnan-9k2hxp"
```

---

## 5. Connector setup (only when you want real sends)

The pod ships **without** real connector accounts. The Gmail / WhatsApp / Slack
surfaces are scaffolded with placeholder account IDs and `is_enabled: false`.
Nothing will accidentally email a candidate.

To wire each one up:

```bash
# Gmail (used by outreach + reply_handler + send_digest fallback)
lemma connectors connect-requests create gmail
# follow the OAuth flow, then grab the account uuid:
lemma connectors accounts list

# WhatsApp (Composio → Twilio WhatsApp Business)
lemma connectors connect-requests create twilio_whatsapp
lemma connectors accounts list

# Slack (for interviewer scorecard DMs)
lemma connectors connect-requests create slack
lemma connectors accounts list
```

Then edit `surfaces/whatsapp/whatsapp.json`, `surfaces/gmail/gmail.json`,
`surfaces/slack/slack.json` — replace each `REPLACE_WITH_*` placeholder, set
`is_enabled: true`, and re-import just those:

```bash
lemma pods import ./surfaces
```

---

## 6. Operator app — dev loop

```bash
cd apps/operator/source
npm install
npm run dev          # http://localhost:5713
# the app falls back to mock data if no Lemma backend is reachable,
# so it loads even without a connected pod.
```

To deploy a fresh build into the pod:

```bash
npm run build
cd ../../..
lemma apps deploy operator --yes
```

---

## 7. What ships, what's deferred

**Tier 1 (in this bundle):**

- ✅ Intake: paste any of {URL, voice transcript, name} → dossier + scored row
- ✅ Outreach: draft in founder voice → approval gate → Gmail send
- ✅ Reply handler: classifies interest / slot_selection → proposes slots or confirms
- ✅ Scorecard collection: Slack DM → form → saved scorecard
- ✅ Weekly digest: pipeline snapshot → composed WhatsApp message
- ✅ Referrer auto-update: approval-first, then opt-in for that referrer
- ✅ Candidate-side public read-only view (`/c/<token>`)
- ✅ Operator app: pipeline + candidate detail + drafts + roles + activity

**Deferred (PRD §13):**

- Calendar integration (slots are heuristic; founder edits before sending)
- Pre-screen tasks (Loom requests, take-home rubrics)
- Multi-founder sharing
- Mobile-native app shells
- Backchannel reference checks

---

## 8. Edits that DON'T need a re-import

- Records (`lemma records create/update/import …`)
- File uploads (`lemma files upload …`)
- Connector accounts
- Live column add: `lemma tables add-column candidates priority --type INTEGER`

## 9. Edits that DO need a re-import

- Schema changes (column add/remove via the JSON), permissions (grants on agents/functions), workflow graphs, schedule cron/payload, surface config, app build.

Run `lemma pods import .` after editing any of those. The CLI is idempotent.

---

## 10. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `MISSING_WORKLOAD_RESOURCE_GRANT` on a workflow node | The agent/function isn't granted the table/folder it touches | Edit `permissions.grants` in the resource's `.json` and re-import |
| `start.payload.id` resolves to null in a DATASTORE_EVENT workflow | The record id is at `start.metadata.record_id`, not the payload | Already correct in this bundle — check any custom edits |
| Surface won't enable | `account_id` is still the placeholder | Connect the connector first, paste the uuid, re-import the surface |
| Operator app shows "Demo data — Lemma SDK not connected" | The page can't reach the Lemma SDK from `window.__LEMMA_CONFIG__.apiUrl` | Deploy via `lemma apps deploy` (don't open the raw HTML), or set the env vars when running locally |
