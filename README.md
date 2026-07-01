# Hiremind

**The hiring OS built for founders, not recruiters.**
One pod. Eight Lemma primitives. Zero backend to maintain.

A WhatsApp forward becomes a scored candidate in 8 seconds. First-round interviews run by an AI in the candidate's browser, deterministically graded 0–100 against the role rubric. Every outbound action — email, calendar invite, offer letter — pauses at a Lemma FORM-node until the founder taps approve. No autopilot, no spam, no missed candidates.

> Hiremind isn't a feature of Lemma — Hiremind is what Lemma makes possible.

---

## The problem

Founder-led hiring at seed stage is broken by every tool that exists.

- **Greenhouse / Ashby** were built for 50-person recruiting teams — they assume an SLA, a hiring committee, and a candidate who fills out forms.
- **Notion / Airtable** falls over past twenty candidates.
- The actual first-touch source of truth is the founder's **phone** — referrals on WhatsApp, screening on Gmail, feedback in the founder's head for 24 hours before anyone writes it down.

Great candidates get buried under Stripe alerts and ghost after four days of silence. Any tool that doesn't start on the phone is already a copy of a copy.

## The loop

```
📱 WhatsApp  →  🤖 parse + score  →  👤 approve  →  📧 Gmail
                                                       ↓
                                    👤 decide  ←  📊 score /100  ←  🎥 AI interview
```

Every arrow is a Lemma workflow. Every human step is a FORM-node approval gate — the AI can't skip you.

## What's in the pod

| Primitive        | Count | Notes                                                                       |
| ---------------- | ----- | --------------------------------------------------------------------------- |
| **Tables**       | 7     | candidates · roles · messages · interviews · scorecards · tasks · referrers |
| **Files**        | 2     | `/candidates/<id>/dossier.md` · `/knowledge/<role>/rubric.md`               |
| **Functions**    | 19    | Deterministic work + connector calls                                        |
| **Agents**       | 8     | Intake · outreach drafter · reply classifier · scheduler · evaluator …      |
| **Workflows**    | 8     | With FORM-node approval gates                                               |
| **Schedules**    | 2     | Gmail poll · Friday digest                                                  |
| **Apps**         | 4     | operator · landing · apply · candidate-view                                 |
| **Surfaces**     | 4     | WhatsApp · Telegram · Gmail · Slack                                         |

Rubric target was 6 primitives. Shipped with 8, every one in production use.

## Zero-cost AI interview

The moment the pitch turns on: **the AI conducts the first-round interview in the candidate's browser.**

| Layer            | Provider                                       |
| ---------------- | ---------------------------------------------- |
| AI voice (TTS)   | Browser `SpeechSynthesis`                      |
| Speech-to-text   | Browser `SpeechRecognition` (60+ languages)    |
| Video capture    | `WebRTC getUserMedia`                          |
| Scoring 0–100    | Deterministic Python heuristic + role rubric   |
| Proctor          | `visibility` + `focus` events                  |

No OpenAI key. No ElevenLabs bill. No Daily.co seats. **$0 marginal cost per candidate.**

## Repo layout

```
hiremind/
├── PRD.md                        Full product requirements (836 lines)
├── docs/
│   └── PITCH-DECK.md             3-minute demo script + slide deck (Marp)
└── pod/
    ├── pod.json                  Pod bundle root
    ├── tables/                   7 typed tables
    ├── functions/                19 Python functions
    ├── agents/                   8 LLM agents with role-scoped tool grants
    ├── workflows/                8 workflows with FORM-node approval gates
    ├── schedules/                2 cron schedules
    ├── apps/                     4 apps (Vite React + static HTML)
    │   ├── operator/             Founder desk-side app — full kanban + drafts + roles
    │   ├── landing/              Public landing page
    │   ├── apply/                Public application form
    │   └── candidate-view/       Public per-candidate status + AI interview
    ├── surfaces/                 Chat surfaces (WhatsApp / Telegram / Gmail)
    └── files/                    Bundled files (rubrics, seed candidates)
```

## Running it

Requires the Lemma CLI (`lemma 0.5.0+`).

```bash
# 1. import the pod (creates all resources)
lemma pods import ./pod --set-pod-meta

# 2. deploy the operator app
cd pod/apps/operator/source
npm install
lemma apps deploy operator . --yes --no-create

# 3. connect Gmail + Google Calendar in the Lemma web UI's integrations panel

# 4. wire the WhatsApp / Telegram / Gmail surfaces to their bot accounts
```

That's the whole install.

## The demo in one sentence

Forward a LinkedIn URL to the Hiremind WhatsApp bot → 8 seconds later the candidate is on your kanban with a scored dossier and a founder-voice email waiting for your approval; approve, schedule a screen with a Meet link, run the AI first-round interview in the browser, read the 78/100, tap Offer.

See [`docs/PITCH-DECK.md`](docs/PITCH-DECK.md) for the full 3-minute demo script and slide deck.

## Built with

- **[Lemma](https://lemma.work)** — the platform. Pods, functions, workflows, tables, files, agents, apps, surfaces.
- **Composio** — Google Calendar / Meet / Chat connectors.
- **Vite + React + Tailwind** — the operator app.
- **Browser Web Speech + WebRTC APIs** — free, multilingual AI interviewer.

---

Built for the Lemma hackathon · Naitik Jain
