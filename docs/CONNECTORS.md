# Hiremind connector layer

New connector-backed functions added in this pass. Each one plugs into an
existing Lemma auth-config (org-level) plus per-function `connector.use`
grants.

## What's new

| Function | Connector | Auth config | What it does |
|---|---|---|---|
| `enrich_github` | GitHub (Composio) | `github` | Fetches candidate's public GitHub profile + recent repos, computes a signal score, appends a `## GitHub signal` section to the dossier. |
| `enrich_linkedin` | LinkedIn (Composio) | `linkedin` | Pulls headline, current role, positions, education via `LINKEDIN_GET_PERSON`; appends a `## LinkedIn signal` section to the dossier. |
| `discord_broadcast` | Discord (Composio) | `discord` | Posts a role sourcing message to a Discord channel via `DISCORD_CREATE_MESSAGE`; records the outbound in the `messages` table. |
| `ingest_drive_resume` | Google Drive (Composio) | `google_drive` | Parses a Drive URL/id, downloads the file (auto-exports Google-native docs to PDF), saves to `/candidates/<id>/resume.<ext>`, updates `candidate.resume_path`. |
| `send_sms_reminder` | Twilio (**direct REST**) | *n/a — pod secrets* | SMS reminder via Twilio's REST API. Twilio isn't in Lemma's connector catalog, so we use basic-auth HTTP with credentials from pod secrets. |

## Org-level auth configs (already installed)

Run once per org — I've already done these; listed here for reference.

```bash
# Already installed and CONNECTED:
lemma connectors auth-configs create github          --name github          --provider COMPOSIO --config-source SYSTEM_DEFAULT
lemma connectors auth-configs create linkedin        --name linkedin        --provider COMPOSIO --config-source SYSTEM_DEFAULT

# Installed today (need user OAuth in the web UI):
lemma connectors auth-configs create discord         --name discord         --provider COMPOSIO --config-source SYSTEM_DEFAULT
lemma connectors auth-configs create google_drive    --name google_drive    --provider COMPOSIO --config-source SYSTEM_DEFAULT
```

**Connect the accounts** for `discord` and `google_drive` from the Lemma web
UI: **Integrations → Discord / Google Drive → Connect**. Login and grant scopes.

## Twilio secrets (for `send_sms_reminder`)

Twilio has no Lemma connector, so we call its REST API directly with
credentials pulled from pod secrets. Set these once via the Lemma dashboard
(Pod → Secrets), or via CLI if your tenant supports it:

| Secret | Where to find it | Example |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio console → Account Info | `AC1234…` |
| `TWILIO_AUTH_TOKEN` | Twilio console → Account Info → Auth Token | `deadbeef…` |
| `TWILIO_FROM_NUMBER` | Twilio Phone Numbers → Active Numbers (E.164) | `+14155552671` |

The function will short-circuit with `mode: "missing_secrets"` if any of the
three env vars is empty — no silent failure.

## Deploy

Once Lemma's function executor recovers (there's currently a platform-level
outage — see the earlier failures in the workflow runs list), redeploy the
pod:

```bash
cd /Users/naitik/Desktop/lemma/hiremind/pod
lemma pods import .
```

Or import just the new functions if the full pod import is slow:

```bash
cd /Users/naitik/Desktop/lemma/hiremind/pod
lemma functions update enrich_github/enrich_github.json
lemma functions update enrich_linkedin/enrich_linkedin.json
lemma functions update discord_broadcast/discord_broadcast.json
lemma functions update ingest_drive_resume/ingest_drive_resume.json
lemma functions update send_sms_reminder/send_sms_reminder.json
```

## Smoke tests

Once deployed, quick manual tests per function:

```bash
# 1. GitHub enrichment on Priya (id below is an existing candidate).
lemma functions run enrich_github -d '{
  "candidate_id": "f9ba0f9b-fc3a-4636-9c76-9ae0c460e075",
  "github_username": "torvalds",
  "max_repos": 10
}'

# 2. LinkedIn enrichment — public_id derived from linkedin_url on the row.
lemma functions run enrich_linkedin -d '{
  "candidate_id": "f9ba0f9b-fc3a-4636-9c76-9ae0c460e075"
}'

# 3. Discord broadcast — replace channel_id with a channel you can post in.
lemma functions run discord_broadcast -d '{
  "channel_id": "REPLACE_WITH_YOUR_CHANNEL_ID",
  "role_id": "f2008e23-4b0d-4934-a6bd-27795a5e7efb"
}'

# 4. Drive resume ingest — replace with a shared file link/id.
lemma functions run ingest_drive_resume -d '{
  "candidate_id": "f9ba0f9b-fc3a-4636-9c76-9ae0c460e075",
  "drive_url_or_id": "https://drive.google.com/file/d/REPLACE_WITH_FILE_ID/view"
}'

# 5. SMS — needs candidate.phone or to_number_override in E.164.
lemma functions run send_sms_reminder -d '{
  "candidate_id": "f9ba0f9b-fc3a-4636-9c76-9ae0c460e075",
  "to_number_override": "+14155552671",
  "body": "Reminder: Naitik chat in 30 minutes."
}'
```

## How to wire these into the operator app

Suggested UI hooks for each — cheap wins, big demo impact:

- **Candidate detail page** — add two "Enrich" chips next to the LinkedIn URL: **`Enrich GitHub`** and **`Enrich LinkedIn`**. Each calls the respective function, then triggers a dossier refresh. One tap → 30 more seconds of context for the founder.
- **Candidate detail → Files card** — a "Paste Drive link" input that fires `ingest_drive_resume`. Currently resumes live in Gmail attachments; this brings them into the pod's durable store.
- **Interviews table row** — an SMS chip on any scheduled interview: **`Text reminder`** → fires `send_sms_reminder` with the interview_id. Massive no-show reduction for near-zero effort.
- **Role detail page** — **`Broadcast to Discord`** button that opens a picker for community channels and fires `discord_broadcast` with the role_id. Post to five communities in the time it took to write one LinkedIn post.

## Extra table columns (optional, non-breaking)

The enrichment functions write these fields to `candidates`. Add them to
`pod/tables/candidates/candidates.json` if you want them typed (they'll
land as untyped JSON otherwise):

- `github_username: string`
- `github_score: number`
- `linkedin_headline: string`
- `linkedin_current_role: string`
- `linkedin_current_company: string`
- `resume_path: string`
- `resume_source: string`
- `resume_ingested_at: timestamp`
- `phone: string` (E.164, e.g. `+14155552671`)

## Known gaps / follow-ups

- **Twilio inbound**: today we only send. Replying `STOP` should mark the
  candidate as `sms_opt_out=true` and drop them from future reminders — one
  more function (`handle_twilio_webhook`) + a Lemma HTTP endpoint would
  close that loop.
- **Discord DM sourcing**: intentionally omitted — cold DMs on Discord get
  accounts banned. Channel posts only.
- **LinkedIn cold outreach**: same reasoning — LinkedIn will kill accounts
  that DM at scale. Enrichment only, no automation of outbound.
- **GitHub sourcing search**: not built. Would use `GITHUB_SEARCH_USERS`
  with a location + language filter to pipe candidates into intake, but
  that requires PRD-level thought about noise thresholds first.
