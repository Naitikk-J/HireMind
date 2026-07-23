# Hiremind — A Week in the Life

**A scenario-based pitch. One founder, one role, one week.
Every feature of Hiremind on stage, in context, in the order it actually happens.**

Read this front-to-back and you have the full demo script.

---

## The setup

**Meet Naitik.**
He's the technical co-founder of a 4-person AI infra startup. They just closed
a seed, and now he needs to hire the first **Founding Engineer — LLM Apps**.
Target profile: someone who has shipped a real LLM product end-to-end, not
just fine-tuned a model.

He has:
- A rough idea of what he wants
- 8 half-remembered LinkedIn URLs in his phone
- A Gmail inbox with 3 resumes he never got back to
- 15 hours a week he doesn't have

He does *not* have:
- A recruiter (would flood him with noise)
- A hiring team (there is no team yet)
- Time to type outreach emails himself

He opens Hiremind.

---

## Monday, 09:14 — Setup (2 minutes)

Naitik opens the operator app. New pod, empty kanban. He types a role in
plain English:

> *"Founding Engineer — LLM Apps. Someone who has shipped an LLM product to
> real users, not a Kaggle notebook. Python + TypeScript. Bay Area or remote.
> Comp band $180–220k + 0.8–1.5% equity."*

Hiremind's `create_role` function turns that paragraph into:
- A role rubric (must-haves, nice-to-haves, deal-breakers)
- A `/knowledge/roles/founding-llm/pitch.md` (one-sentence pitch,
  three-sentence longer pitch, deal points, comp band)
- A kanban column layout: `Sourced → Reviewed → Replied → Screen → Onsite → Offer → Hired`

Total time: **2 minutes.**
Old way: 45 minutes writing a Notion doc no one reads.

> **Beat 1:** *"Notice — the founder didn't write a job description. He
> described the shape of the person he wants. The AI turned it into a
> rubric that every downstream step will evaluate against."*

---

## Monday, 11:42 — First candidate (WhatsApp intake)

Between builds, Naitik gets a LinkedIn URL over Twitter DM. He forwards it to
the Hiremind WhatsApp bot:

> *"@Naitik — check this person out for the founding role. She was PM at
> Notion, now doing something with LLMs at a stealth company. Referred by
> Priya. Score her honest."*

30 seconds later, WhatsApp replies:

> **Aditi Rao — 8.7 / 10 for Founding Engineer — LLM Apps**
>
> Added to Reviewed. Strong overlap on shipping — she launched Notion Q&A (LLM search
> over workspace docs) and led it from spec to GA. Referral note recorded.
> One gap: no evidence of Python depth (all past work is TS). Dossier saved.
>
> Draft intro is waiting in your Drafts queue.

Behind the scenes, in ~28 seconds:

1. `pipe_to_intake` → creates the intake message row.
2. `whatsapp_intake` agent → reads Naitik's note, parses "referred by Priya."
3. `parse_intake` function → scrapes LinkedIn, scores against the role rubric,
   generates a full dossier at `/candidates/<id>/dossier.md`.
4. `enrich_linkedin` (new!) → pulls Aditi's real headline, positions, education
   directly from LinkedIn's API. Appends a `## LinkedIn signal` section to
   the dossier.
5. `create_candidate` → inserts the row with `stage=reviewed`, `score=8.7`.
6. `triage_and_notify` → sends Naitik a Gmail summary of the verdict.
7. `draft_outreach` → composes the first-touch email in Naitik's exact voice,
   using the actual observation ("saw you ship Notion Q&A"), quotes the role's
   pitch line, and drops it into the founder's Drafts queue.

> **Beat 2:** *"In 30 seconds — WhatsApp forward to a fully-scored candidate
> with a dossier, a summary email, and a draft outreach ready for founder
> approval. Zero code writing. Zero LinkedIn tabs."*

---

## Monday, 11:44 — The founder-approval gate

Naitik opens the Drafts tab. There's Aditi's draft:

> **Subject:** *"notion q&a — quick thought"*
>
> **Body:**
> Hey Aditi — saw you ship Notion Q&A from spec to GA at Notion. That kind of
> insertion-point thinking is exactly what I'm trying to hire for.
>
> Priya mentioned you might be open to a conversation, but figured I'd reach
> out directly rather than play telephone.
>
> Founding Engineer — LLM Apps, founding team. We're building infra that
> makes shipping LLM apps a weekend, not a quarter.
>
> Worth 25 minutes next week to see if it's a fit either way?
>
> Naitik

Naitik reads it. Tightens one line. Taps **Approve & send**.

`send_outreach` fires. Email leaves via the Gmail connector, in Naitik's
own thread, from his own address, at 11:44 AM Pacific.

> **Beat 3:** *"This is the critical part. **The AI drafted, the founder
> decided.** The email cannot send without that Approve tap — it's not a
> convention, it's a Lemma FORM node. The workflow is architecturally
> incapable of skipping approval. That guarantee is why a founder can
> actually trust this with their voice."*

---

## Tuesday, 08:03 — Community sourcing (Discord)

Overnight, Naitik decides he wants more top-of-funnel. He opens the role
detail page and taps **`Broadcast to Discord`**. A channel picker appears —
he selects `#hiring` in the *AI Infrastructure Founders* Discord (2,400
members).

`discord_broadcast` (new!) fires:

> **Hiring — no recruiters, no bullshit.**
>
> Role: **Founding Engineer — LLM Apps** · founding team.
>
> We're building infra that makes shipping LLM apps a weekend, not a quarter.
>
> If you're interested (or know someone who is), reply here or DM me — I'll
> get back within a day with a real conversation, not a phone screen.

Message posts. The `messages` table now has a `direction=outbound,
channel=discord` row so it's part of Naitik's audit trail.

By 09:30 that morning, 6 people have replied in-thread. Naitik copies their
GitHub URLs into WhatsApp:

> *"Score these 6 for the founding role. Same rubric."*

Six candidates arrive on the kanban in under 3 minutes.

> **Beat 4:** *"One tap = a warm sourcing broadcast to a 2,400-person
> community. Try doing that in Greenhouse."*

---

## Tuesday, 14:21 — GitHub enrichment

One of the Discord referrals is Marco. His dossier score is 6.9 — the
LinkedIn signal is thin.

But Naitik looks at the dossier and taps **`Enrich GitHub`**.

`enrich_github` (new!) fires with Marco's handle. 4 seconds later, a
`## GitHub signal` section appears in his dossier:

> **GitHub signal**
>
> - Handle: [@marcod-ai](https://github.com/marcod-ai)
> - Bio: "Shipping LLM tools that don't suck. Ex-Anthropic, ex-Vercel."
> - Followers: 1,842 · Public repos: 47
> - **Signal score (0–10): 8.4**
> - Top languages: Python (18), TypeScript (12), Rust (5)
>
> ### Recent repos
> - `marcod-ai/promptrouter` · ★ 3,200 · Python — Fast LLM router with
>   built-in observability
> - `marcod-ai/embedcache` · ★ 812 · Rust — Local-first embedding cache
> - `marcod-ai/gh-code-review` · ★ 341 · TypeScript — Bot that reviews PRs
>   with LLMs

Marco just went from "6.9, probably pass" to "actually one of the strongest
in the pipeline." The candidate row now has `github_username=marcod-ai` and
`github_score=8.4`.

Naitik taps **`Draft intro outreach`**. `draft_outreach` picks up the new
signal and writes:

> *"Hey Marco — saw promptrouter. That's exactly the taste level I'm trying
> to hire for..."*

Draft in Drafts queue. Naitik approves. Email sends.

> **Beat 5:** *"For engineers, the resume lies. The GitHub doesn't. One
> button, and the dossier now cites specific repos with real star counts
> and languages — and the AI-drafted outreach references them by name."*

---

## Tuesday, 17:45 — First reply comes in

`poll_replies` runs on a 2-minute schedule. It reads Naitik's Gmail
inbox, looks for messages threading to any outbound Hiremind sent, and
runs them through the `reply_classifier` agent.

Aditi (from Monday) replied 6 hours after the outreach:

> *"Hey Naitik — thanks for the note. Actually interesting timing —
> I'm exploring what's next. Free Thursday PM if you want to chat?"*

Classifier verdict: `positive_reply, wants_call`. Candidate stage
auto-advances `reviewed → replied`. Kanban card lights up. A Slack
notification hits Naitik:

> *"Aditi Rao replied positive — wants a Thursday PM call.
> `[Book screen]`"*

He taps `Book screen`.

---

## Wednesday, 09:12 — Scheduling (Google Calendar + Meet)

Naitik opens Aditi's card. Under "Next steps" there are 3 suggested slots
computed by `propose_slots`, which checked his Google Calendar for
free/busy windows.

- Thursday 15:00–15:25 PT
- Thursday 16:30–16:55 PT
- Friday 10:00–10:25 PT

He taps the first. `schedule_screen` fires:

1. `GOOGLECALENDAR_CREATE_EVENT` — event created on his primary calendar
   with `create_meeting_room=true`. Google mints a Meet link automatically.
2. Aditi gets a real calendar invite in her inbox with the Meet URL.
3. An `interviews` row is written: `round=screen, scheduled_at=…, meet_url=…`.
4. Kanban card updates: *"Screen booked Thu 3pm · Meet link attached."*

Zero manual back-and-forth. Zero "what timezone are you in?" emails.

---

## Wednesday, 22:30 — SMS reminder scheduled

Naitik has a founder rule: text every candidate 30 min before their screen.
It cuts no-shows dramatically. But he always forgets.

Now he doesn't have to. The moment `schedule_screen` writes the interview
row, a Lemma schedule + `send_sms_reminder` (new!) fires 30 minutes before
`scheduled_at`.

Aditi's phone buzzes at 14:30 PT Thursday:

> *"Hi Aditi — quick reminder: our chat is at Thu Jul 17 at 15:00 PDT.
> Join: https://meet.google.com/xyz-abcd-efg — Naitik"*

Uses Twilio's REST API directly (Twilio isn't in Lemma's connector catalog,
so `send_sms_reminder` handles the Basic-auth POST itself). Credentials
come from three pod secrets: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
`TWILIO_FROM_NUMBER`. Message row written to `messages` for the audit
trail.

> **Beat 6:** *"Hiremind reduced founder no-show anxiety to zero. And
> when Twilio wasn't in the connector library — no problem, one function,
> direct REST, done."*

---

## Thursday, 15:00 — The screen happens

The screen is 30 minutes over Google Meet. Naitik's on Otter, so the whole
thing gets transcribed. Aditi's brilliant.

At 15:32, Naitik hits **`Screen complete`** on the kanban. That triggers
`evaluate_interview`, which:

1. Reads the Otter transcript from `/candidates/<id>/screen_transcript.txt`.
2. Cross-references the role rubric.
3. Writes a scorecard row: strengths, gaps, verdict, recommended next step.
4. Advances stage `replied → screen_done`.

Kanban shows: *"Screen complete · Verdict: STRONG. Recommend onsite."*

---

## Thursday, 18:47 — Someone's resume in Naitik's Gmail

Meanwhile, in a totally separate thread, a candidate named Devon sent Naitik
a Drive link to his resume:

> *"Naitik — attached my CV. Would love to chat about the founding role."*

Naitik opens Devon's candidate card in Hiremind (auto-created by the
`whatsapp_intake` flow when he forwarded the URL earlier), taps
**`Paste Drive link`**, and pastes the URL.

`ingest_drive_resume` (new!) fires:

1. Parses the file_id from the URL.
2. `GOOGLEDRIVE_GET_FILE_METADATA` → sees it's a Google Doc.
3. `GOOGLEDRIVE_DOWNLOAD_FILE` with `mime_type: "application/pdf"` →
   Drive exports it to PDF and returns the bytes.
4. Saved to `/candidates/<devon-id>/resume.pdf` in Hiremind's own file store.
5. `candidate.resume_path` updated on the row.

The resume is now durable, part of the candidate record forever. Not
sitting in Gmail. Not sitting on Drive. Sitting on Hiremind, where every
future function can read it.

> **Beat 7:** *"Every founder has 40 resumes rotting in their Gmail. Hiremind
> pulls them into the durable candidate record with one paste."*

---

## Friday, 11:00 — Offer

Aditi's screen went great. Naitik meets his co-founder in person for
lunch, they agree — she's the one. Back at his desk at 15:00, he taps
**`Skip to offer`** on Aditi's card.

`draft_outreach` runs with `intent=offer_letter`:

> **Subject:** *"the offer for Aditi — founding engineer — llm apps"*
>
> Hey Aditi — short and direct.
>
> We'd like to make you an offer for Founding Engineer — LLM Apps.
> Formal letter with comp, equity, start date, and the usual paperwork
> is in a separate follow-up — this is the heads-up so you can think
> about it without a PDF in your face.
>
> Headline terms (the letter has the full version):
> - Title and scope as we discussed.
> - Cash + equity band already shared in the screen — happy to revisit
>   any piece if your situation needs it.
> - Start date: ideally within 4 weeks; flexible if you have a notice
>   period to honour.
>
> Take a week to sit with it. If you want a call to ask anything — comp,
> the team, what the first 90 days actually look like — just say when and
> I'll find time.
>
> Either way, no awkward silence. Looking forward to your reply.
>
> Naitik

Drafts queue. Approve. Send.

Kanban: *"Offer sent · stage=offer · 1 week response window."*

Aditi replies 4 days later: *"I'm in."*

Naitik marks her `hired`. Confetti optional.

---

## Friday, 17:00 — The Friday digest

At 17:00 PT Friday, `send_digest` fires on a schedule. Gmail summary lands
in Naitik's inbox:

> **Hiremind — week of Jul 14**
>
> **Pipeline movement**
> - Sourced: 14 (+ 8 from Discord broadcast)
> - Reviewed: 12 → 6 pass through
> - Replied: 4 (33% intro reply rate — above trend)
> - Screened: 3
> - Offer: 1 (Aditi — founding engineer)
> - Hired: 1 🎉
>
> **Ready for you Monday**
> - 2 candidates need an intro reviewed
> - Marco's dossier now has GitHub signal (score 8.4) — worth reading
> - 3 Discord replies waiting in the inbox — piped in but not yet triaged
>
> **The AI did**
> - Parsed 14 candidates
> - Drafted 11 outreach emails
> - Scheduled 3 screens
> - Sent 3 SMS reminders (0 no-shows this week)
> - Wrote 3 scorecards from screen transcripts
>
> **You did**
> - Approved 11 drafts (median edit: 1 sentence)
> - Took 3 screens
> - Made 1 offer
>
> That's ~2.5 hours of your time this week. Old flow: ~18 hours.

---

## The wrap — say this at the end

> *"That's Hiremind. One founder. One role. One week. **One hire.**
>
> The AI did the sourcing scoring, the enrichment, the drafting, the
> scheduling, the reminders, the transcript scoring, the digest. The
> founder did **exactly one thing** — decide. Every outbound message
> paused for approval. The AI could not send a single email in his
> voice without him tapping approve.
>
> The whole product is a pod: **20 functions, 4 agents, 6 workflows,
> 8 connectors, 4 apps, all in one folder, deployed with one command.**
> No servers, no auth setup, no ORM, no queue, no hosting bill.
>
> Naitik saved 15 hours a week. Aditi got a warm, specific, human-voiced
> outreach in 30 seconds instead of a template three days later.
>
> That's what an AI hiring OS looks like when the founder is in the loop
> and the platform is built for it. **That's Hiremind.**"*

---

## Feature map — every Hiremind feature demonstrated in this scenario

| Feature | Beat |
|---|---|
| Plain-English role setup → auto rubric + pitch.md | Mon 09:14 |
| WhatsApp intake surface | Mon 11:42 |
| `parse_intake` LLM scoring + dossier | Mon 11:42 |
| `enrich_linkedin` (new connector!) | Mon 11:42 |
| Founder-voice outreach drafting | Mon 11:42 |
| **FORM-node approval gate** | Mon 11:44 |
| Gmail connector (send + poll) | Mon 11:44, Tue 17:45 |
| `discord_broadcast` (new connector!) | Tue 08:03 |
| `enrich_github` (new connector!) | Tue 14:21 |
| `reply_classifier` agent + auto stage advance | Tue 17:45 |
| Slack notification surface | Tue 17:45 |
| `propose_slots` (Google Calendar free/busy) | Wed 09:12 |
| `schedule_screen` (Google Calendar + Meet) | Wed 09:12 |
| `send_sms_reminder` via Twilio REST (new!) | Wed 22:30 |
| `evaluate_interview` (transcript → scorecard) | Thu 15:32 |
| `ingest_drive_resume` (new connector!) | Thu 18:47 |
| Offer-letter drafting flow | Fri 11:00 |
| `send_digest` (Friday summary) | Fri 17:00 |

Nothing in this scenario is fake — every step maps to a real function or
agent in `pod/`. This is the demo. Follow it beat-by-beat and you'll show
every muscle Hiremind has.
