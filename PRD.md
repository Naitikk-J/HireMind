# Hiremind — PRD & Implementation Plan

**Project:** Hiremind — a founder-led hiring co-pilot, built as a Lemma pod
**Hackathon:** Gappy AI National AI Hackathon, powered by Lemma SDK
**Build window:** June 24 – June 30, 2026 (6 days)
**Author:** Naitik
**Status:** v0.1 — locked scope for hackathon submission

---

# PART 1 — PRODUCT REQUIREMENTS

## 1. One-liner

**Hiremind is a Lemma-native operations layer for founder-led hiring: candidates become rows, conversations become workflows, and nothing leaves the pod without the founder's tap.**

It collapses LinkedIn DMs, Gmail threads, scheduling chaos, scattered scorecards, and "I forgot to follow up" guilt into one durable system that runs on the founder's WhatsApp.

## 2. The problem

### 2.1 Who feels it
A **solo or founder-led hiring loop at a 5–50 person startup.** The same person is the hiring manager, the recruiter coordinator, the scheduler, the scorecard-chaser, and the offer-extender. They typically run 3–8 open roles simultaneously, source from 4+ channels, and lose 30–40% of their pipeline to coordination failure.

### 2.2 The current stack (what they're using today)
- LinkedIn DMs (sourcing)
- Gmail (outreach + scheduling)
- Cal.com / Calendly (booking)
- Notion or Google Sheets (tracking)
- Slack DMs (interviewer coordination)
- Their own head (everything else)

### 2.3 Why this fails
1. **State is scattered.** A candidate's "current state" requires reading 5 tools and remembering what was said in person.
2. **No durable owner per action.** Things fall through cracks because the only "trigger" is the founder's memory.
3. **Coordination overhead scales linearly with pipeline.** 10 candidates = 10x the chase.
4. **Interviewer feedback never gets written down.** Scorecards exist in theory; in practice they're a verbal "yeah, I liked them" 4 days later.
5. **No single source of truth.** "Did we already reach out to her in March?" — nobody knows.

### 2.4 Why now
Three forces converge:
- **Lemma SDK launches today** — first time a multi-actor, multi-surface, approval-gated workspace is open-source and pod-portable.
- **Coding agents (Claude Code, Codex, Cursor) make pod authoring trivial** — a founder can build their own operations layer in a weekend instead of a quarter.
- **WhatsApp is the founder's primary device** — desk-based tools are 10x friction vs. the chat window already open on their phone.

### 2.5 Failure modes of existing solutions
| Solution | Why it fails for this user |
|---|---|
| Greenhouse / Lever / Ashby | Built for 200+ person companies with full-time recruiters. Overkill, expensive, slow to set up. |
| Notion / Sheets | No agency — won't draft, schedule, follow up, or chase feedback. |
| Recruitee / Workable | Same as Greenhouse, slightly smaller. Still SaaS, no agentic layer. |
| ChatGPT custom GPTs | No durable state, no multi-actor, no approvals, no surfaces. |
| Pipedrive (used as ATS) | Wrong shape — sales CRM, not hiring loop. |

**Hiremind's wedge:** the only tool built for a single founder running a real loop, with agentic drafting + WhatsApp + approval gates, exportable as a pod they own.

## 3. Target user persona

**Naitik, founder of a 12-person YC-stage startup, Bangalore.**
- Runs 3 open roles simultaneously (AI PM, Senior FE, Founding DE)
- Sources from LinkedIn outreach + Twitter inbound + warm referrals
- Spends ~8 hours/week on hiring coordination, hates 7 of them
- Lives on WhatsApp, opens Gmail in batches, has a Notion page for "candidates" he hasn't updated in 11 days
- Co-founders interview but rarely write scorecards in <48 hours
- Has lost 2 strong candidates in the last 3 months to "we never followed up"

If Hiremind reclaims **5 of those 7 hated hours** with a 6-day learning curve, it wins.

## 4. Goals & non-goals (for hackathon scope)

### 4.1 In scope (must work end-to-end by June 30)
- Candidate intake from 3 sources: LinkedIn URL paste, Gmail ingestion, WhatsApp voice note
- Auto-triage: dossier generation, role-fit scoring, suggested next action
- Founder-voice outreach drafting with explicit approval gate before send
- Inbound reply parsing → scheduling workflow with calendar slot proposals
- Interview feedback collection via Slack DM form
- Weekly pipeline digest via WhatsApp
- Operator web app (Kanban + candidate detail)
- Candidate-side public link (no login) showing their status
- Referrer auto-update workflow
- Founder approval gates on all outbound external actions
- Full audit trail (who/what/when, including which agent)

### 4.2 Out of scope (deliberately deferred)
- Real LinkedIn API scraping (use paste-URL fallback)
- Real calendar integration (use Gmail draft scheduling with manual confirm)
- Multi-tenant / hiring committee mode (single founder user only)
- Mobile native app (PWA via the web app is enough)
- Notion/Greenhouse import
- Onboarding flow / first-run wizard
- 6-month performance feedback closed loop (mentioned in roadmap)
- Real interview recording transcription
- Cold-source-from-public-signals (reverse pipeline)
- Bias-flagging digest

### 4.3 Success metrics

| Metric | Target |
|---|---|
| Core loop works end-to-end in screen recording | Yes / No (must be Yes) |
| Time from "I see Aarti on LinkedIn" → "draft sent" | < 3 minutes founder time |
| Founder taps required per candidate (sourced → intro_sent) | ≤ 2 |
| Lemma primitives used meaningfully | ≥ 6 (tables, files, agents, workflows, functions, apps, surfaces, approvals) |
| Surfaces wired | ≥ 3 (Gmail + Slack + WhatsApp + Web app) |
| Demo recording length | 4–5 minutes |

### 4.4 Hackathon rubric mapping

| Criterion | Weight | How Hiremind earns it |
|---|---|---|
| Problem clarity & real-world fit | 35% | Every judge is the user. Hiring partners are the user. Specific persona named in §3. |
| Product judgment | 25% | Tight scope (§4.1/4.2). No "AI for X" hand-waving. Each component maps to a specific failure mode in §2.3. |
| Execution quality | 25% | All primitives Lemma-native, no novel ML. Core loop runs end-to-end (§4.3). |
| SDK utilization | 15% | 7+ primitives in essential roles (§5.1). Uses WhatsApp surface — Lemma's least-replicable feature. |

## 5. Product principles

1. **The agent drafts; the human ships.** No outbound action without an explicit founder approval. The pod is configured to refuse unilateral external actions.
2. **WhatsApp is the primary surface.** The web app is the deep-dive; daily friction lives in chat.
3. **Candidates never know there's a pod.** Outreach comes from the founder's real Gmail, in the founder's voice. The pod is invisible from the outside.
4. **Every action is auditable.** `created_by`, `approved_by`, and `source_event` on every row that can affect the outside world.
5. **One agent, one job, narrow scope.** No god-agent. If one prompt gets jailbroken, the blast radius is one table.
6. **Founder's voice is sacred.** Outreach reads as written by the founder, not the agent. Voice-sample file is the agent's North Star.
7. **Optimize for re-engagement, not net new sourcing.** Most pipeline value is in the candidates already in your funnel; chase them well before sourcing more.

## 6. Information architecture (data model)

### 6.1 Tables

```
candidates
──────────
id              uuid
name            string
source          enum(linkedin, referral, inbound_email, twitter, site)
source_meta     jsonb     # e.g. {"linkedin_url": "...", "referrer_id": "..."}
role_id         fk → roles
stage           enum(sourced, reviewed, intro_sent, replied,
                     screen_done, onsite_done, offer, hired, closed)
owner           fk → users
score           float     # 0–10, fit score
last_contact    timestamp
next_action     string    # human-readable, agent-authored
status          enum(active, passed, hired, declined)
public_token    string    # for candidate-side link
created_at      timestamp
updated_at      timestamp

roles
─────
id              uuid
title           string
hiring_lead     fk → users
must_haves      string[]
nice_haves      string[]
rubric_file     file_ref  → roles/<id>/rubric.md
status          enum(open, paused, filled, closed)
opened_at       timestamp

interviews
──────────
id              uuid
candidate_id    fk → candidates
round           string    # "intro_call", "product_judgment", "system_design", "founder_chat"
interviewer     fk → users (external panelist by email is OK)
scheduled_at    timestamp
status          enum(scheduled, done, no_show, cancelled)
feedback_sent_at timestamp     # when Slack DM went out
scorecard_id    fk → scorecards (nullable)

scorecards
──────────
id              uuid
interview_id    fk → interviews
strengths       text
concerns        text
recommendation  enum(strong_hire, hire, no_hire, strong_no_hire)
notes           text
submitted_at    timestamp
submitted_by    fk → users

messages
────────
id              uuid
candidate_id    fk → candidates
direction       enum(outbound, inbound)
channel         enum(email, whatsapp, linkedin, slack)
subject         string  # nullable for non-email
body            text
status          enum(draft, awaiting_approval, sent, failed, ignored)
created_by      string  # agent name, or user id
approved_by     fk → users (nullable until approved)
sent_at         timestamp
thread_ref      string  # for matching inbound replies

tasks
─────
id              uuid
type            enum(needs_followup, approve_message, submit_feedback,
                     decide_offer, manual_review)
owner           fk → users
candidate_id    fk → candidates (nullable)
title           string
due             timestamp
status          enum(pending, done, snoozed, cancelled)
created_by      string  # agent or workflow id
context_ref     jsonb   # links back to the triggering row

referrers
─────────
id              uuid
name            string
contact         string   # email or phone
candidate_ids   uuid[]   # candidates referred
last_update     timestamp
```

### 6.2 Files (markdown, versioned)

```
voice-sample/
  founder-voice.md            # 3+ real messages the founder has written

roles/
  <role_id>/
    rubric.md                 # what good looks like for this role
    pitch.md                  # how to sell this role to candidates

candidates/
  <candidate_id>/
    dossier.md                # auto-generated, agent rewrites over time
    conversation.md           # running thread of all messages, both directions
    notes.md                  # founder's free-form notes
    research/
      linkedin.md             # pasted or scraped LinkedIn content
      web.md                  # blog, github, twitter findings
```

### 6.3 Public-facing artifacts

```
candidate-view at /c/<public_token>
  read-only, no login
  shows: current_stage, last_action_taken, expected_next_step,
         estimated_response_time, founder's brand statement
  does NOT show: scores, scorecards, internal notes, other candidates
```

## 7. The agents (specs)

Each agent is a Lemma agent: role + prompt + tool grants + runtime profile. All five together total < 200 lines of config.

### 7.1 Triage agent
- **Trigger:** Table event — new row in `candidates`
- **Reads:** Source URL or text, `roles` table, founder voice sample
- **Writes:** `candidates/<id>/dossier.md`, updates `candidates` row (score, role_id, next_action)
- **Approval needed:** No — internal only
- **Tools granted:** read `roles`, write `candidates` (own row only), write `files` (own dossier path only)
- **Output contract:** Dossier MUST include: snapshot, why-interesting, role-fit reasoning, suggested talking points (3), prep questions (3), confidence note

### 7.2 Outreach agent
- **Trigger:** Founder taps "draft intro" on a candidate
- **Reads:** Dossier, role, conversation history, founder voice sample
- **Writes:** New `messages` row with status=`awaiting_approval`
- **Approval needed:** Yes — message must be approved before send
- **Tools granted:** read `candidates`, read `files` (dossier + voice), write `messages` (draft only)
- **Output contract:** Subject + body. Body MUST reference one specific detail from dossier. Body MUST be in founder's voice (verified by self-check pass). No emojis unless founder voice uses them. Length 80–150 words.

### 7.3 Scheduler agent
- **Trigger:** Inbound `messages` row arrives, body is classified as "interest" or "question"
- **Reads:** Inbound message, founder's calendar availability (paste-ICS or manual config)
- **Writes:** New outbound `messages` row with status=`awaiting_approval`. On accepted reply: `interviews` row.
- **Approval needed:** Yes — for both the slot-proposal reply and the calendar invite
- **Tools granted:** read `messages` (for the candidate's thread), write `messages` (draft), write `interviews`
- **Output contract:** Propose exactly 3 slots, all within next 5 business days, ≥ 1 hour apart, 30-min duration, with IST timezone explicit.

### 7.4 Feedback collector agent
- **Trigger:** Workflow — fires 30 minutes after an `interviews` row flips to `done`
- **Reads:** Interview metadata, candidate dossier
- **Writes:** Slack DM to interviewer with structured form. On form submit → `scorecards` row.
- **Approval needed:** No — internal Slack DM only
- **Tools granted:** Slack DM send (interviewer only), write `scorecards`
- **Output contract:** DM is short (<60 words), form is 4 fields max (strengths, concerns, recommendation enum, optional notes). Includes a 2-line refresher on the candidate so interviewer doesn't have to re-load context.

### 7.5 Pipeline digest agent
- **Trigger:** Schedule — Mon 9am IST, Fri 6pm IST
- **Reads:** Full pipeline state
- **Writes:** WhatsApp message to founder
- **Approval needed:** No — one-way, to founder only
- **Tools granted:** read all tables, WhatsApp send (founder only)
- **Output contract:** Maximum 8 bullets. Prioritized: overdue replies → pending decisions → recent wins → coming-up. Each bullet ≤ 12 words. Includes inline approval buttons where possible.

### 7.6 Referrer update agent
- **Trigger:** `candidates.stage` transitions for a candidate with a non-null referrer
- **Reads:** Candidate stage, referrer info
- **Writes:** WhatsApp or email to referrer
- **Approval needed:** Yes (first time per candidate), then auto-approved for subsequent updates if founder allows
- **Tools granted:** read `candidates`, read `referrers`, send WhatsApp/email (referrer only)
- **Output contract:** Single-line update. Never reveals scorecards or scores. Always thanks the referrer.

## 8. Workflows (specs)

### 8.1 `intake` workflow
```
Trigger: row inserted in `candidates`
  ↓
[function] normalize_source   # extract URL/text/voice-transcript
  ↓
[agent] triage                 # build dossier, score, set next_action
  ↓
[function] notify_founder      # WhatsApp ping: "new candidate ready: <name>"
```

### 8.2 `outreach` workflow
```
Trigger: founder taps "draft intro" on candidate detail
  ↓
[agent] outreach               # draft message, status=awaiting_approval
  ↓
[notification] WhatsApp ping to founder with inline approve/edit/deny
  ↓
[approval gate] founder approves
  ↓
[function] send_email          # via Gmail surface
  ↓
[function] update_candidate    # stage → intro_sent, last_contact → now
  ↓
[function] schedule_followup_task  # if no reply in 4 days
```

### 8.3 `reply_handler` workflow
```
Trigger: inbound email matched to existing candidate thread
  ↓
[agent] classify_reply         # interest | decline | question | other
  ↓
[switch on classification]
  ├─ interest → [agent] scheduler → approval gate → send_email
  ├─ question → [agent] qa_responder → approval gate → send_email
  └─ decline  → [function] mark_passed → [function] update_referrer
```

### 8.4 `feedback_collect` workflow
```
Trigger: interviews.status → done (+ 30 min delay)
  ↓
[agent] feedback_collector     # sends Slack DM
  ↓
[wait] form submitted (up to 72h)
  ├─ submitted → write scorecard, notify founder
  └─ timeout → escalate via WhatsApp to founder
```

### 8.5 `weekly_digest` workflow
```
Trigger: cron(Mon 9am IST), cron(Fri 6pm IST)
  ↓
[function] compute_pipeline_state
  ↓
[agent] pipeline_digest        # composes WhatsApp message
  ↓
[function] send_whatsapp
```

### 8.6 `candidate_view_link` workflow
```
Trigger: new candidate created
  ↓
[function] generate_public_token
  ↓
[function] store on candidate row
  (link is then served by the app at /c/<token>)
```

## 9. User flows (the demo arcs)

### 9.1 Flow A: Voice-note sourcing
1. Founder, in an Uber, sends WhatsApp voice note: *"Aarti Mehta from Microsoft, AI PM role, referred by Rohit."*
2. Voice ingestion → transcript → `candidates` row created with source=referral, referrer=Rohit
3. Triage agent builds dossier, scores, sets next_action="send intro"
4. WhatsApp ping to founder: *"Aarti's dossier ready. Tap to draft intro."*
5. Founder taps. Outreach drafts intro. Approval ping. Founder approves. Gmail sends.
6. Referrer agent pings Rohit: *"Got Aarti's intro — thanks again for the referral."*

**Founder time: 90 seconds total.**

### 9.2 Flow B: Inbound reply → scheduled interview
1. Aarti replies to outreach email
2. Reply handler classifies "interest"
3. Scheduler agent proposes 3 slots (drafted reply)
4. Approval ping. Founder approves. Reply sent.
5. Aarti picks "Friday 2pm"
6. Scheduler parses, creates `interviews` row, sends calendar invite
7. Dossier updated with prep questions for Friday

### 9.3 Flow C: Post-interview feedback
1. Friday 2pm interview happens. Founder flips interview to `done`.
2. After 30 min: Slack DM to Priya (interviewer): *"Quick form — Aarti's product round?"*
3. Priya fills 4-field form in Slack
4. Scorecard saved. Pipeline digest agent queues it for Monday's WhatsApp.

### 9.4 Flow D: Monday morning digest
Founder wakes up to:
```
📊 Hiremind — Monday
• 3 candidates waiting on your reply (Aarti, Vikram, Sara)
• Priya recs HIRE on Aarti — decision needed
• Offer for Rohit expires Friday
• 2 new applicants from LinkedIn post
• 1 referrer pending: Rohit hasn't heard back since intro
[Tap to open pipeline]
```

### 9.5 Flow E: Candidate-side view
Aarti opens `hiremind.app/c/aarti-x82k` from her email signature:
```
Hi Aarti,
You're in Naitik's hiring process for AI Product Engineer.

Where you are: Round 2 scheduled — Friday 2pm IST
Next: Team feedback after the round
Typical response time: 48 hours
If you have questions: reply to your last email from naitik@startup.com
```

This builds your hiring brand for free. **No other recruiting tool does this.**

## 10. Surfaces

| Surface | Direction | What flows through it |
|---|---|---|
| **WhatsApp** | both | Voice-note intake, approval pings, weekly digest, urgent escalations |
| **Gmail** | both | All outbound to candidates, all inbound replies |
| **Slack** | both | Interviewer feedback DMs + form submissions |
| **Web app** | both | Kanban pipeline, candidate detail, draft editor |
| **Public candidate page** | outbound | Read-only candidate status, no login |

## 11. Permissions & safety

### 11.1 Per-agent permission matrix

| Agent | candidates | roles | interviews | scorecards | messages | files | Send external |
|---|---|---|---|---|---|---|---|
| Triage | RW (own row) | R | — | — | — | RW (own dossier) | — |
| Outreach | R | R | — | — | W (draft) | R | After approval |
| Scheduler | R | — | RW | — | RW (draft) | R | After approval |
| Feedback | R | — | R | W | — | — | Slack DM only |
| Digest | R | R | R | R | R | R | WhatsApp to founder only |
| Referrer | R | — | — | — | — | — | After approval (per referrer/candidate first time) |

### 11.2 Approval gates (the trust posture)
**No outbound message to any non-founder external party is sent without an explicit founder approval.** This is enforced at the workflow layer, not just by prompt.

### 11.3 Audit
Every row that can affect the outside world has `created_by` and `approved_by` columns. Every workflow run produces a trace. Founder can answer at any time: *"Who sent this? Was it approved? When?"*

## 12. Tier-1 additions (committed for hackathon scope)

Per scope-discipline discussion, three additions earn their build cost:

1. **Voice-first WhatsApp intake** — replaces LinkedIn-URL paste as primary sourcing path
2. **Candidate-side public view** — novel insight, builds hiring brand
3. **Referrer auto-update loop** — closes the silent gap in referral-driven hiring

## 13. Roadmap (mentioned in writeup, NOT built)

| Feature | Why it'd matter | Why not now |
|---|---|---|
| Reject-then-rehire memory | Resurface past candidates for new roles | Needs real pipeline history to demo |
| 6-month performance feedback loop | Refines rubric over time | Unshowable in 6 days |
| Hiring committee mode | Multi-user pod with role-based visibility | Doubles auth scope |
| Cold-reach warm-angle agent | Mutual connections, recent posts → 6x response rate | 1+ day of work, eats buffer |
| Reverse pipeline | Proactive sourcing from public signals | New product surface, not a tweak |
| Interview recording auto-debrief | Zoom transcript → first-draft scorecard | Recording integrations are a tarpit |
| Bias-flagging digest | Pattern-watch rejection trends | False positives are risky in demo |

## 14. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Lemma SDK ships with breaking changes on June 24 | High | Build core loop with synthetic data first; wire surfaces last |
| WhatsApp surface requires complex setup | Medium | Fallback to Telegram (long-polling, easier); demo whichever works |
| Voice transcription quality is poor | Low | Fallback to typed WhatsApp message; still demos the WhatsApp-first principle |
| Gmail OAuth flow eats Day 3 | Medium | Use Composio connector if available; otherwise dummy SMTP for demo |
| Scope creep | Very High | Cut list (§4.2) is locked. Re-read daily. |
| Demo recording fails on Day 6 | Medium | Record a working sub-demo daily from Day 3 onward as backup |
| Solo build, motivation dip on Day 4 | Medium | Day 2 evening MUST have core loop working — that's the morale anchor |

---

# PART 2 — IMPLEMENTATION PLAN

## 15. Lemma SDK primitives — what we use and why

| Primitive | Used for | Spec ref |
|---|---|---|
| **Pod** | The hiremind workspace itself | §6 |
| **Tables** | 7 tables: candidates, roles, interviews, scorecards, messages, tasks, referrers | §6.1 |
| **Files** | Voice sample, per-role rubrics, per-candidate dossiers/conversations/notes | §6.2 |
| **Agents** | 6 narrowly-scoped agents | §7 |
| **Workflows** | 6 named workflows with triggers + approval nodes | §8 |
| **Functions** | Deterministic helpers (token gen, classification, slot parsing) | §8 |
| **Approvals** | Explicit gates on all outbound external actions | §11.2 |
| **Apps** | Operator Kanban + candidate-side view, deployed via `lemma apps deploy` | §10 |
| **Surfaces** | WhatsApp, Gmail, Slack | §10 |
| **Permissions** | Per-agent permission matrix | §11.1 |
| **Public tokens** | Delegation tokens for candidate-side view | §9.5 |

**Primitives used meaningfully: 11. Surfaces wired: 3 + web app + public link.**

## 16. Repo / pod layout on disk

```
hiremind/
├── pod.yaml                          # pod manifest (name, owner, version)
├── README.md                         # one-pager for graders
├── .lemmaignore                      # exclude dev artifacts
│
├── tables/
│   ├── candidates.yaml
│   ├── roles.yaml
│   ├── interviews.yaml
│   ├── scorecards.yaml
│   ├── messages.yaml
│   ├── tasks.yaml
│   └── referrers.yaml
│
├── files/
│   ├── voice-sample/
│   │   └── founder-voice.md          # SEED: 3 of Naitik's real messages
│   └── roles/
│       ├── ai-pm/
│       │   ├── rubric.md
│       │   └── pitch.md
│       ├── senior-fe/
│       │   ├── rubric.md
│       │   └── pitch.md
│       └── founding-de/
│           ├── rubric.md
│           └── pitch.md
│
├── agents/
│   ├── triage.yaml
│   ├── outreach.yaml
│   ├── scheduler.yaml
│   ├── feedback.yaml
│   ├── digest.yaml
│   └── referrer.yaml
│
├── workflows/
│   ├── intake.yaml
│   ├── outreach.yaml
│   ├── reply-handler.yaml
│   ├── feedback-collect.yaml
│   ├── weekly-digest.yaml
│   └── candidate-link.yaml
│
├── functions/
│   ├── normalize_source.py
│   ├── classify_reply.py
│   ├── parse_slot_selection.py
│   ├── generate_public_token.py
│   └── compute_pipeline_state.py
│
├── surfaces/
│   ├── whatsapp.yaml
│   ├── gmail.yaml
│   └── slack.yaml
│
├── apps/
│   ├── operator/                     # main Kanban + detail
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   └── src/...
│   └── candidate-view/               # single-file HTML, no build
│       └── index.html
│
└── seed/
    ├── seed-candidates.py            # populate pipeline for demo
    └── seed-messages.py
```

## 17. Tech & dependency choices

| Layer | Choice | Why |
|---|---|---|
| Pod runtime | Lemma SDK (Python config) | Native primitives, the whole point |
| Agent model | Anthropic Claude Sonnet (via `LEMMA_ANTHROPIC_API_KEY`) | Best instruction following for voice-mimicking outreach |
| Voice transcription | Built-in to WhatsApp ingest (Lemma handles Whisper) | Free with the surface |
| Operator app | React + Vite + shadcn/ui | Fast scaffold; matches Lemma frontend conventions; deployable via `lemma apps deploy` |
| Candidate view | Single-file HTML | Fastest path, no build, deploys instantly |
| Connectors (Gmail/Slack/WhatsApp) | Composio via `COMPOSIO_API_KEY` | Lemma's recommended path per README |
| Functions | Python | Matches Lemma backend; deterministic helpers |
| Local stack | `./install.sh` → `lemma-stack` on 3711/8711 | Or lemma.work cloud — TBD per founder decision |

## 18. The 6-day plan (day by day, with concrete deliverables)

> **Rule:** Every day ends with a runnable artifact. No "I'll wire it tomorrow."

### Day 1 — Tuesday June 24 (today): Foundation
**Goal:** Pod scaffolded, all 7 tables created, all 6 agent configs stubbed, voice sample written.

- [ ] Install Lemma: `curl -fsSL https://raw.githubusercontent.com/lemma-work/lemma-platform/main/install.sh | bash`
- [ ] Configure model: `lemma-stack config set LEMMA_DEFAULT_MODEL_TYPE anthropic_compat` + key
- [ ] Configure Composio: `lemma-stack config set COMPOSIO_API_KEY <key>`
- [ ] `lemma servers select local && lemma auth login`
- [ ] `lemma pod init hiremind --with-starter` then strip starter to bones
- [ ] Author all 7 table schemas in `tables/*.yaml`
- [ ] Author all 6 agent configs in `agents/*.yaml` (role + prompt + grants, no integration yet)
- [ ] Write `files/voice-sample/founder-voice.md` (Naitik's 3 real messages — MUST be real, not synthetic)
- [ ] Write `files/roles/<role>/rubric.md` for one role (AI PM)
- [ ] Verify with `lemma table list` — all 7 tables present
- [ ] Verify with `lemma agent list` — all 6 agents registered

**End-of-day artifact:** A pod that's empty but well-shaped. `lemma chat "what's in this pod?"` returns a sensible tour.

### Day 2 — Wednesday June 25: The spine
**Goal:** The core loop runs end-to-end on a single candidate. This is the morale anchor — everything else is decoration.

- [ ] Implement `workflows/intake.yaml` — table-event triggered
- [ ] Implement `workflows/outreach.yaml` with approval gate node
- [ ] Wire Gmail surface (Composio path) for outbound only
- [ ] Test: paste a LinkedIn URL via `lemma record create candidates --data '...'`
  - → triage agent fires
  - → dossier file appears in `files/candidates/<id>/dossier.md`
  - → row updates with score + next_action
- [ ] Test: call outreach manually via `lemma agent run outreach --input '{"candidate_id": "..."}'`
  - → draft message row created with status=awaiting_approval
  - → notification fires (CLI for now)
- [ ] Test: approve via `lemma record update messages <id> --data '{"status": "approved"}'`
  - → outreach workflow resumes
  - → Gmail send succeeds
  - → candidate stage → intro_sent

**End-of-day artifact:** Screen recording (informal) of the spine working. **If this doesn't work by end of Day 2, kill scope: drop Slack feedback collection.**

### Day 3 — Thursday June 26: Surfaces (WhatsApp + Slack)
**Goal:** The founder can do everything from their phone. Interviewer feedback works in Slack.

- [ ] Wire WhatsApp surface — start with founder DMs only
- [ ] Wire WhatsApp voice ingestion path: voice note → transcript → `candidates` row
- [ ] Replace CLI notifications with WhatsApp pings
- [ ] Add WhatsApp inline approve/deny button handling (or "reply YES/NO" if buttons not ready)
- [ ] Wire Slack surface for interviewer DMs
- [ ] Implement `workflows/feedback-collect.yaml`
- [ ] Test: flip an `interviews` row to done → 30 min later → Slack DM to test interviewer → form fill → scorecard written

**End-of-day artifact:** A full candidate journey demonstrated from voice note to scorecard, with founder never opening a desk app.

### Day 4 — Friday June 27: Apps + reply handling + scheduler
**Goal:** Operator UI deployed. Inbound replies handled. Scheduler works.

- [ ] Scaffold operator React app (`apps/operator/`)
- [ ] Three views: Kanban by stage, candidate detail, message draft editor
- [ ] Wire SDK hooks from `lemma-typescript/` for real-time table updates
- [ ] `lemma apps deploy operator ./apps/operator` — confirm pod URL works
- [ ] Single-file candidate-view (`apps/candidate-view/index.html`)
- [ ] `lemma apps deploy candidate-view ./apps/candidate-view` at `/c/*` route
- [ ] Implement `workflows/reply-handler.yaml` with classify + branch
- [ ] Implement scheduler agent + workflow path
- [ ] Implement `workflows/weekly-digest.yaml` (test by manually triggering)
- [ ] Implement referrer auto-update workflow

**End-of-day artifact:** Founder uses the web app for a deep-dive. Inbound reply triggers scheduling. Test weekly digest runs.

### Day 5 — Saturday June 28: Seed data + demo polish
**Goal:** Pod looks like a real founder's pipeline. Demo is rehearsed.

- [ ] Run `seed-candidates.py`: 12 realistic candidates across 4 stages, 3 roles
- [ ] Run `seed-messages.py`: realistic conversation history per candidate
- [ ] Seed 3 referrers with real-looking link-backs
- [ ] Seed 2 completed scorecards, 1 pending
- [ ] Fix the 3 worst bugs from Days 1–4
- [ ] Record the demo (per §19)
- [ ] Write the writeup (per §20)
- [ ] Get one person to watch the demo, take their first reaction, iterate

**End-of-day artifact:** Submission-ready package.

### Day 6 — Sunday June 29 / Monday June 30: Buffer + submit
**Goal:** Submit before midnight on June 30.

- [ ] Fix the one thing that broke on review
- [ ] Re-record demo if needed
- [ ] Final writeup pass
- [ ] Submit via the hackathon form
- [ ] Post in Discord that we shipped

## 19. Demo recording script (4–5 minutes)

> **Recording setup:** OBS, 1080p, voiceover, screen + small webcam in corner for the human-moment scenes.

### Scene 1 (45s) — Set the stakes
> *"My name is Naitik. I'm a founder, I do my own hiring, and I lose candidates every month because I don't have a coordination system. Greenhouse is overkill. Notion is dead state. I built Hiremind so my hiring loop has the same operations layer my product does."*
- Cut to: blank dashboard.

### Scene 2 (60s) — Voice-note sourcing
- Pull out phone, send WhatsApp voice note in real time
- Cut to: dashboard — candidate row appears, dossier auto-builds, score lands
- *"Ninety seconds. I haven't sat down at my laptop."*

### Scene 3 (90s) — The full outreach loop
- Tap "draft intro" in app
- Phone buzzes with WhatsApp ping: "1 message ready"
- Show the draft — in the founder's voice, referencing a specific dossier detail
- One-tap approve
- Cut to: Gmail outbox showing the sent message
- Candidate stage flips to `intro_sent`
- Referrer Rohit gets a WhatsApp: *"Got Aarti's intro — thanks again."*

### Scene 4 (60s) — Inbound reply → scheduling → feedback
- Show seeded reply landing
- Show scheduler agent drafting 3 slots
- Approval, send
- Cut forward: interview happens, flip to done
- Cut to Slack: interviewer Priya gets the DM, fills the form
- Scorecard written

### Scene 5 (45s) — The candidate-side view
- *"And this is what Aarti sees from her side."*
- Open `/c/aarti-x82k` on phone
- Read: *"Round 2 scheduled. Awaiting team feedback. Typical response time: 48 hours."*
- *"No other recruiting tool does this."*

### Scene 6 (30s) — Monday morning
- Cut to phone WhatsApp: the Monday digest
- Read it on camera
- Tap to make one decision inline

### Scene 7 (30s) — Close
> *"Built in 6 days. Solo. On Lemma. Pod is exportable — I can hand it to any other founder tonight. Here's what we'd build next."*
- Slide: 4 bullets from roadmap (§13)

## 20. Writeup template (for the submission form)

### Problem
*Founder-led hiring at 5–50 person startups happens across LinkedIn, Gmail, Slack, Notion, Cal.com, and the founder's head. State is scattered, follow-ups slip, scorecards never get written. We lose candidates not because we judge badly but because we coordinate badly.*

### Solution
*Hiremind is a Lemma pod that gives a single founder a real hiring operations system: every candidate is a row, every conversation a workflow, every external action gated by founder approval. WhatsApp is the primary surface — the web app is the deep-dive.*

### What we built (the core loop)
- Voice-note candidate intake via WhatsApp
- Auto-triage with dossier generation + role-fit scoring
- Founder-voice outreach drafting with explicit approval gate
- Inbound reply handling + interview scheduling
- Slack-DM-based interviewer feedback collection
- Monday/Friday WhatsApp pipeline digest
- Operator Kanban app + candidate-side public view
- Referrer auto-update loop

### Lemma SDK usage
*7 tables, 6 agents, 6 workflows, 5 functions, 3 surfaces (WhatsApp + Gmail + Slack), 2 deployed apps, fine-grained per-agent permissions, approval gates on every outbound external action, delegation tokens for the candidate-side view. Lemma's WhatsApp surface + approval gates were the difference between this being a Notion clone and being a real operations layer.*

### What we'd build next
- Cold-reach warm-angle agent (6x response rate from public signals)
- Reverse pipeline (proactive sourcing instead of reactive)
- Auto-debrief from interview recordings
- 6-month performance feedback loop that refines the rubric over time

### Demo
*[link to screen recording]*

### Team
*Naitik — solo*

## 21. Submission checklist

- [ ] Demo recording uploaded (publicly viewable URL)
- [ ] Writeup completed
- [ ] Pod exportable: `lemma pod export ./hiremind-export` succeeds clean
- [ ] Pod re-importable on a fresh stack: `lemma pod import ./hiremind-export` succeeds
- [ ] README has 60-second setup instructions for the Lemma team to try it
- [ ] All secrets removed from pod export (verify with `grep -r "sk-" hiremind-export`)
- [ ] Submission form filled (problem / solution / demo / team)
- [ ] Posted in hackathon Discord

## 22. Critical-path & dependencies

```
Day 1: Pod + tables + agent configs           [ALL OTHER DAYS BLOCKED IF NOT DONE]
   ↓
Day 2: Core loop (intake → outreach → send)   [Demo blocked if not done]
   ↓
Day 3: WhatsApp + Slack surfaces              [Days 4–5 depend on this]
   │
   ├── Day 4 (parallel): Apps + reply handler + scheduler
   │
   └── Day 5: Seed data + demo (BLOCKS on Day 4 apps)
              ↓
              Day 6: Buffer + submit
```

**Hard rule:** Day 2 end-of-day must have the spine working with synthetic data. If it doesn't, drop one surface from Day 3 (probably Slack) and absorb the slip.

## 23. Decisions still owed

1. **Local stack or lemma.work cloud?** — recommendation: lemma.work cloud first (faster setup), local stack as Day 1 evening setup task if there's time.
2. **Model: Anthropic or OpenAI?** — recommendation: Anthropic Claude Sonnet for outreach (better voice mimicry), OpenAI fallback if rate-limited.
3. **WhatsApp via Twilio (Composio) or WhatsApp Business directly?** — recommendation: whatever ships easiest on Day 3 morning.
4. **Founder voice sample** — need 3 real messages from Naitik. Without this, outreach quality drops 40%.

---

## Appendix A — Naming alternatives

If "Hiremind" doesn't land:
- **Fold** — "fold this person into your team"
- **Vouch** — referral DNA built in
- **Anchor** — already used in earlier brainstorm, redirect
- **Pipeline** — too generic
- **Cohort** — too academic
- **Receiver** — too sports
- **Beacon** — works
- **Tally** — works but small

Recommendation: ship as **Hiremind** unless a better one lands by Day 4.

## Appendix B — What Lemma SDK gives us that nobody else does

| Capability | What it unlocks for Hiremind |
|---|---|
| Multi-actor pod | Founder + interviewers + referrers + candidates as different roles in one workspace |
| WhatsApp surface | Voice-note intake — the killer demo moment |
| Approval gates in workflows | The trust posture that makes this safe to use in production |
| Delegation tokens | Candidate-side view without auth — the novel product moment |
| Pod export/import | A founder can hand the whole system to another founder in one command |
| Multi-surface ingress | Same data, four channels, no glue code |
| Native scheduling | Cron-triggered digests with no external scheduler |
| Per-agent permissions | Blast radius of any one prompt jailbreak is one table |

Without these, Hiremind would be a Notion + Zapier + 200 lines of glue. With them, it's a coherent system that ships in a week.

---

*End of document.*
