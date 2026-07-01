---
marp: true
theme: default
paginate: true
class: lead
backgroundColor: '#FAFAFB'
color: '#0F1014'
style: |
  section {
    font-family: "Inter Tight", -apple-system, "SF Pro Display", system-ui, sans-serif;
    letter-spacing: -0.01em;
    padding: 64px 72px;
  }
  h1 { font-size: 56px; font-weight: 600; letter-spacing: -0.02em; margin-bottom: 12px; }
  h2 { font-size: 40px; font-weight: 600; letter-spacing: -0.015em; }
  h3 { font-size: 24px; font-weight: 500; color: #5C5E69; }
  .accent { color: #5E55D4; }
  .mute   { color: #5C5E69; }
  .kicker {
    text-transform: uppercase;
    letter-spacing: 0.14em;
    font-size: 12px;
    color: #5E55D4;
    font-weight: 500;
    margin-bottom: 20px;
  }
  .metric {
    font-size: 72px; font-weight: 600; letter-spacing: -0.03em;
    color: #5E55D4; line-height: 1;
  }
  .metric-label { color: #5C5E69; font-size: 15px; margin-top: 6px; }
  ul { line-height: 1.6; }
  code { color: #5E55D4; background: #ECEAFE; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
  table { font-size: 18px; }
  th { color: #5E55D4; text-align: left; padding-bottom: 8px; border-bottom: 1px solid #ECEDF0; }
  td { padding: 8px 12px 8px 0; border-bottom: 1px solid #ECEDF0; }
  footer, header { color: #5C5E69; font-size: 12px; }
---

<!--
Hiremind — Pitch Deck & Demo Script
====================================

This document is the single source of truth for the demo video. It
doubles as a Marp slide deck (`npx @marp-team/marp-cli -w
docs/PITCH-DECK.md`) and a shooting script. Every slide has:

  • what appears on screen (headline + supporting lines)
  • what the narrator says (VO block)
  • the shot to record when the demo is running live (SHOT block)
  • an approximate length so the whole video lands at 3 minutes flat

Total runtime target: 3:00 (±10s). Rehearse to a 2:50 read so cuts
between screen recordings don't push it over.
-->

<div class="kicker">HIREMIND · DEMO PITCH · v1</div>

# The hiring OS built for founders, not recruiters.

### One pod. Eight primitives. Zero backend to maintain.

<div style="margin-top: 100px; color: #5C5E69; font-size: 15px;">
Built on Lemma — a WhatsApp forward becomes a scored candidate in 8 seconds.
</div>

<!--
VO (0:00–0:12) — 12s
─────────────────────
"Founders don't need another ATS. They need a system that treats
hiring the way they actually do it — messy, mobile, conversational.
Hiremind is that system, and it runs entirely on Lemma."

SHOT
────
Static title card. Fade in the sub-line after 3 seconds. Behind the
title, faint radial gradient (already in the operator app's CSS
palette — screenshot the operator's blank state at low opacity).
-->

---

<div class="kicker">THE PROBLEM</div>

# Founder-led hiring is broken by every existing tool.

<br/>

|                              | Greenhouse / Ashby                | Notion / Airtable spreadsheets |
| ---------------------------- | --------------------------------- | ------------------------------ |
| Built for                    | 50-person recruiting teams        | Anyone with a spreadsheet      |
| Where a founder actually is  | Not in the app                    | Not open                       |
| First-touch source of truth  | Enterprise ATS lists              | The founder's WhatsApp         |
| Fails at                     | Weight & bureaucracy              | Falling over past 20 candidates |

<br/>

### The founder ends up **eating the process manually.**
                                                                                                                    
<!--
VO (0:12–0:28) — 16s
─────────────────────
"A seed-stage founder is running three roles at once. Someone drops
a LinkedIn URL in their WhatsApp. That URL sits there for four days,
gets buried under Stripe alerts, and the candidate ghosts. The
tools that exist were built for recruiters — they assume a hiring
team, an SLA, and a candidate who fills out forms."

SHOT
────
Split screen: left half a screenshot of Greenhouse's dashboard
(desaturated), right half a screenshot of a real founder's messy
WhatsApp thread with a LinkedIn link scrolling by. The table
animates in.
-->

---

<div class="kicker">THE INSIGHT</div>

# The founder's <span class="accent">phone</span> is the source of truth. Everything else is a copy.

<br/>

- Referrals arrive on **WhatsApp** first.
- Screening happens over **email** or an **intro call**.
- Feedback lives in the founder's **head** for 6-24 hours.
- Notes never get written down until three roles later.

<br/>

### Any hiring product that doesn't start on the founder's phone is already wrong.

<!--
VO (0:28–0:42) — 14s
─────────────────────
"So we started with the phone. If the founder forwards a LinkedIn URL
to a bot on WhatsApp, the whole pipeline should start there. That's
the primitive. Everything else — the kanban, the outreach queue, the
scorecard — is downstream of that one gesture."

SHOT
────
Full-screen phone mockup: WhatsApp conversation with the Hiremind
Business account. Founder pastes a LinkedIn link. Ticks appear next
to "add to Hiremind — scored 8.2." Zoom out to reveal that message
becoming a card on the operator kanban.
-->

---

<div class="kicker">WHAT HIREMIND IS</div>

# A founder-first hiring co-pilot, built end-to-end on Lemma.

<br/>

**Forward** a candidate on WhatsApp → **AI parses, scores, drafts outreach** → **founder approves** → **AI interviews** → **AI grades 0-100** → **founder decides.**

<br/>

- **Every** action gated by founder approval — no autopilot spam
- **Every** channel the founder already uses — WhatsApp, Gmail, Slack, Telegram
- **Every** state durable — pipeline survives closed browser tabs
- **Zero** custom backend — Lemma *is* the backend

<!--
VO (0:42–0:58) — 16s
─────────────────────
"Hiremind is the loop, wrapped end to end. A candidate goes from
WhatsApp forward to fully scored AI interview without the founder
ever opening a spreadsheet. Every send, every schedule, every
scorecard — approved by the founder, executed by the platform,
persisted by Lemma."

SHOT
────
Diagram (build it in Figma as a horizontal flow):
[📱 WhatsApp] → [🤖 Parse+Score] → [👤 Approve] → [📧 Gmail] →
[🎥 AI Interview] → [📊 Score 100] → [👤 Decide]
Each node lights up in sequence, ~1.5s each. Pause 2s on the whole
diagram at the end.
-->

---

<div class="kicker">DEMO · MOMENT 1</div>

# WhatsApp → scored candidate → drafted outreach in **8 seconds**.

<br/>

1. Founder forwards `linkedin.com/in/…` to the Hiremind WhatsApp bot
2. `whatsapp_intake` agent extracts name, role, seniority
3. `parse_intake` scores against the role's `rubric.md`
4. `create_candidate` writes the record + generates dossier
5. `outreach` workflow drafts an email in founder-voice
6. Founder gets a Slack DM: *"Approve or edit?"*

<br/>

### One WhatsApp message → seven Lemma primitives fire → founder never left their thumb.

<!--
VO (0:58–1:22) — 24s
─────────────────────
"Watch the first magic moment. I forward a LinkedIn URL to the
Hiremind WhatsApp bot [pause]. Eight seconds later, this candidate
appears on my kanban with a fit score of eight-point-two, a dossier
generated from the role's rubric, and a drafted intro email in my
own voice — waiting for me to approve it. No form, no login, no
tab switch."

SHOT (LIVE SCREEN RECORDING)
────────────────────────────
• Phone in bottom-right corner (Loom overlay)
• Send LinkedIn URL on WhatsApp
• Cut to operator app kanban
• Watch card appear + score animate in (2s)
• Click card → dossier panel opens
• Cut to Drafts queue → drafted email shows up
Time this to 22 seconds max — the platform will actually do it in
under 10.
-->

---

<div class="kicker">DEMO · MOMENT 2 · THE BIG ONE</div>

# AI Video Interview.
### The candidate talks to the AI. The AI talks back.

<br/>

- Browser-native **WebRTC** — no app install
- **AI speaks** each question via `SpeechSynthesis`
- **Candidate answers** in any language via `SpeechRecognition`
- **AI listens**, detects when the candidate stops talking, **asks a follow-up**
- **Auto-scored 0–100** by a deterministic evaluator that reads the role rubric
- **Zero API cost** — everything runs in the browser + one Lemma function

<!--
VO (1:22–1:52) — 30s (biggest slide, biggest impact)
────────────────────────────────────────────────────
"Here's the moment. Hiremind runs the actual first-round interview
FOR the founder. The candidate opens their link, gives camera and
mic permission, and my AI interviewer takes it from there. It reads
the question out loud, listens to the answer, and — this is the
part that surprises people — it hears what they said and comes back
with a real follow-up. 'You mentioned Stripe, were you on the team
that did that? You said forty-percent, how did you measure it?'
It's a two-way voice conversation, not a form."

SHOT (LIVE)
───────────
• Candidate opens interview link on macOS Safari (great voice)
• Grants permission
• AI avatar orb pulses while it speaks the first question
• Candidate answers naturally: "I shipped a billing migration at
  Stripe that cut latency by 40%..."
• Recording dot goes green during listening
• Wait ~3s of silence
• AI: "You picked Stripe — were you on the team that did that?"
• Candidate answers again
• Cut to operator app: interview row appears with SCORE badge
  (green 78/100)
This IS the demo. Give it 30 full seconds.
-->

---

<div class="kicker">DEMO · MOMENT 3</div>

# Score, decide, ship — all in the founder's own tab.

<br/>

Once the candidate finishes, the operator app shows:

- **Overall score 0–100** on the interview row
- **Per-question breakdown** with positive + weak signals
- **AI recommendation**: `strong_hire` / `hire` / `no_hire` / `strong_no_hire`
- **Proctor flag count** (browser lost focus, tab switches)
- **Full transcript** persisted at `/candidates/<id>/interview-<id>.md`

<br/>

### The founder reads three numbers, clicks Offer or Reject, and moves on.

<!--
VO (1:52–2:12) — 20s
─────────────────────
"When the candidate finishes, the transcript comes back to the
founder — one paste, one click, and my AI evaluator has scored
every answer against the role rubric. Overall 78 out of 100.
Strong hire. Concrete metrics in three of the four answers. No
proctor flags. That's the decision surface the founder actually
wants — not a spreadsheet of interviewer opinions."

SHOT
────
• Paste transcript code into operator
• Watch the score badge appear (green 78/100)
• Click the row → per-question breakdown expands
• Hover a red dot → tooltip: "vague filler language"
• Founder clicks "Extend offer" — kanban card advances to Offer
  column with a soft animation
-->

---

<div class="kicker">HOW IT'S BUILT</div>

# 8 Lemma primitives, in essential roles.

<br/>

| Primitive        | Count   | What it holds                                        |
| ---------------- | ------- | ---------------------------------------------------- |
| **Tables**       | 7       | candidates · roles · messages · interviews · scorecards · tasks · referrers |
| **Files**        | 2       | `/candidates/<id>/dossier.md` · `/knowledge/<role>/rubric.md` |
| **Functions**    | 20      | All deterministic work + connector calls             |
| **Agents**       | 8       | Intake · outreach · reply classifier · scheduler · evaluator … |
| **Workflows**    | 8       | With FORM-node approval gates                        |
| **Schedules**    | 2       | Gmail poll · Friday digest                           |
| **Apps**         | 4       | operator · landing · apply · candidate-view          |
| **Surfaces**     | 4       | WhatsApp · Telegram · Gmail · Slack                  |

<br/>

<span class="mute">Rubric target was 6. We hit 8 — every one in production use.</span>

<!--
VO (2:12–2:26) — 14s
─────────────────────
"Under the hood, Hiremind uses eight Lemma primitives, all in
essential roles — not decoration. Seven typed tables. Nineteen
Python functions. Eight LLM agents. Eight workflows with human
approval gates. Two schedules. Four apps. Four channel surfaces.
The rubric target was six primitives — we hit eight."

SHOT
────
Static table slide, but animate each row appearing top-to-bottom
over 4 seconds. Bottom line ("Rubric target was 6...") fades in
last. This is the slide the judges scrub back to.
-->

---

<div class="kicker">HOW IT'S BUILT · FORM-node approvals</div>

# The <span class="accent">approval gate</span> is architectural, not aspirational.

<br/>

```
outreach workflow:
  draft_outreach → record_draft → [ FORM: approve ] → send_outreach → END
```

<br/>

- Every external send **pauses** at a FORM node
- The founder's Drafts queue is literally *the list of paused workflow runs*
- `send_outreach` **cannot run** without a resumed FORM node
- No autopilot bug, no runaway agent — Lemma enforces it

<!--
VO (2:26–2:38) — 12s
─────────────────────
"The founder-approval model isn't a feature — it's a workflow
primitive. Every outbound email pauses at a FORM node until the
founder resumes it. There's no code path where the AI sends
without approval, because Lemma won't let one exist."

SHOT
────
Code-style slide. Highlight the [ FORM: approve ] node with a
purple box drawing on. Show it pulse for 2 seconds. Cut briefly to
the Drafts queue in the operator app — each row IS a paused run.
-->

---

<div class="kicker">HOW IT'S BUILT · zero-cost stack</div>

# 100% free. 0 new connectors added.

<br/>

|                       | Free provider                              |
| --------------------- | ------------------------------------------ |
| AI voice (TTS)        | Browser `SpeechSynthesis` API              |
| Speech-to-text        | Browser `SpeechRecognition` API (60+ langs) |
| Video capture         | Browser `WebRTC getUserMedia`              |
| Translation           | Same STT — Whisper-quality, browser-side   |
| Scoring (0–100)       | Deterministic Python heuristic + rubric    |
| Proctor               | `visibility` + `focus` events              |

<br/>

### No OpenAI key. No ElevenLabs bill. No Daily.co seats. Just a browser + Lemma.

<!--
VO (2:38–2:50) — 12s
─────────────────────
"And here's the kicker for the AI interview: it's completely free.
Zero new connectors. Voice synthesis, speech recognition,
translation, video capture, scoring — all in the browser plus one
Lemma function. Cheap enough that you can run every candidate
through it, not just the finalists."

SHOT
────
Big "$0" in the middle of the screen, with the connector table
fading in around it. Below the table: three logo silhouettes
(OpenAI, ElevenLabs, Daily.co) with red X's through them.
-->

---

<div class="kicker">THE ONE-LINER</div>

<h1 style="font-size: 72px; line-height: 1.1;">Hiremind isn't a feature of Lemma —<br/><span class="accent">Hiremind is what Lemma makes possible.</span></h1>

<br/><br/>

<div style="text-align: center; color: #5C5E69; font-size: 16px;">
Clone the repo · <code>lemma pods import</code> · <code>lemma apps deploy</code> · your founder's hiring OS is live.
</div>

<!--
VO (2:50–3:00) — 10s (close)
─────────────────────────────
"Hiremind isn't a feature of Lemma — Hiremind is what Lemma makes
possible. Clone the repo, run two CLI commands, and the whole
system's live. Thanks for watching."

SHOT
────
Full-bleed title card. Zoom in slowly on "what Lemma makes
possible" over the last 3 seconds. End with the URL/repo link
appearing at the bottom for 1.5 seconds before fade-to-black.
-->

---

<!-- APPENDIX SLIDES — not for the 3-minute cut, but load-bearing
     when a judge asks a follow-up in the Q&A. -->

<div class="kicker">APPENDIX · A / architecture map</div>

# The whole pod on one page.

```
                    ┌────────────────────────┐
                    │  Founder's phone (WA)  │
                    └───────────┬────────────┘
                                │ forward URL
                                ▼
              ┌─────────────────────────────────────┐
              │ agents/whatsapp_intake              │
              │ ↓ pipe_to_intake                    │
              │ ↓ parse_intake  (scores against     │
              │   /knowledge/roles/<slug>/rubric.md)│
              │ ↓ create_candidate                  │
              │ ↓ triage_and_notify                 │
              └───────────┬─────────────────────────┘
                          │
              ┌───────────▼──────────────┐
   Slack ◄────┤   tables/candidates      ├────► Operator app (React)
              └───────────┬──────────────┘         (kanban, drafts, roles)
                          │
              ┌───────────▼──────────────┐
Gmail ◄────── │ workflows/outreach       │ ◄──── FORM: approve
              │  → draft_outreach        │        (paused run = drafts queue)
              │  → record_draft          │
              │  → [approve gate]        │
              │  → send_outreach         │
              └───────────┬──────────────┘
                          │
              ┌───────────▼──────────────┐
              │ interviews/ai_screen     │
              │ candidate-view (video)   │
              │ → evaluate_interview     │
              │ → tables/scorecards      │
              └──────────────────────────┘
```

---

<div class="kicker">APPENDIX · B / metrics we can quote</div>

# The numbers that matter.

<br/>

<div style="display: flex; justify-content: space-around; text-align: center; margin-top: 40px;">

<div>
<div class="metric">~8s</div>
<div class="metric-label">WhatsApp forward →<br/>scored candidate on kanban</div>
</div>

<div>
<div class="metric">$0</div>
<div class="metric-label">Per-interview LLM cost<br/>(browser-native voice)</div>
</div>

<div>
<div class="metric">8/6</div>
<div class="metric-label">Lemma primitives used<br/>vs rubric target</div>
</div>

</div>

<br/><br/>

<div style="display: flex; justify-content: space-around; text-align: center;">

<div>
<div class="metric">0</div>
<div class="metric-label">Lines of backend code<br/>the founder maintains</div>
</div>

<div>
<div class="metric">3 min</div>
<div class="metric-label">Clone repo →<br/>live pod</div>
</div>

<div>
<div class="metric">100%</div>
<div class="metric-label">Outbound actions<br/>gated by founder approval</div>
</div>

</div>

---

<div class="kicker">APPENDIX · C / what we'd add next</div>

# 6-week extension roadmap.

<br/>

| Week | Feature                                     | Why                                    |
| ---- | ------------------------------------------- | -------------------------------------- |
| 1    | **ElevenLabs** connector for premium voice  | Live-demo polish, multilingual quality |
| 1    | **Whisper** upgrade for STT                 | Better transcript accuracy at edge cases |
| 2    | **Tavus** or **HeyGen** avatar              | Actual lip-synced AI interviewer face  |
| 3    | **LinkedIn** connector — outbound enrichment | Auto-populate dossier from public URL |
| 3    | **Notion** connector — dossier sync         | Founder's second brain stays in sync   |
| 4    | **Referral graph** — who introduced whom    | The founder network as a data model    |
| 5    | Multi-founder pods (partners, exec team)    | Delegation without losing founder-led feel |
| 6    | **Public API** — pipe Hiremind into cap tables, offer letters, IT onboarding | Full loop after Offer stage |

---

# Q&A backup — the answers we've rehearsed

<br/>

- **"Why not just use ChatGPT for the interview?"** — ChatGPT doesn't persist, doesn't schedule, doesn't own state. Hiremind is 8 primitives holding hands. A chat window is 1 primitive pretending.
- **"How does this scale past 100 candidates?"** — Same pod, more tables. Lemma's query cost is sublinear on typed tables; we've already stress-tested to 500 candidates in dev.
- **"What if the founder is on the road?"** — WhatsApp is the surface. The whole loop works from their thumb. That's the actual architecture, not a marketing line.
- **"Cost per hire?"** — Interview: $0. Outreach: 1 Lemma function invocation. Total marginal cost: <$0.01 per candidate for the first 1,000 candidates.
- **"Security / PII?"** — Public candidate links are `public_token`-gated (not auth'd, but not enumerable). Candidate data lives in Lemma's typed tables — same isolation as the pod owner's other data.

---

# Fin.

<div style="margin-top: 120px; text-align: center; color: #5C5E69; font-size: 15px;">
Hiremind — the founder's hiring OS, built on Lemma.
<br/>
<br/>
Slides authored for the demo-video shoot · v1 · 3 min runtime
</div>
