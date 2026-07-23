# Lemma, explained like you're pitching it

A ready-to-use script for explaining what Lemma is — in plain English, with
examples from Hiremind to make every abstract idea concrete.

---

## The 30-second version

> **Lemma is an operating system for building AI products end-to-end
> without a backend.** You describe your app as a bunch of *primitives* —
> tables, functions, workflows, agents, apps, chat surfaces — dropped into
> a single folder called a "pod." One command uploads that pod to Lemma's
> cloud, and you have a working product: database, business logic, LLM
> agents, human approval gates, a hosted UI, and WhatsApp / Gmail / Slack
> integrations. All typed, all persistent, all live in one deploy. No
> servers, no auth setup, no ORM, no queue, no hosting bill.

If someone gets that in 30 seconds, that's the pitch. Everything below is
proof.

---

## The mental model (in plain English)

Think of Lemma as **Notion for building software**.

- Notion says: give me a folder of pages and blocks, and I'll turn them
  into a working knowledge base.
- Lemma says: give me a folder of primitives, and I'll turn them into a
  working AI product.

The folder is called a **pod**. Everything you build lives inside one.
When you run `lemma pods import`, Lemma reads the folder, syncs every
primitive to the cloud, and your app is live.

That's it. That's the whole platform in one sentence.

---

## The primitives (with a Hiremind example for each)

Every Lemma product is built from **eight kinds of building blocks**. Here
they are, in the order you'd usually add them:

### 1. Tables — your database, but you never touch SQL

You describe a table in JSON — its columns and types — and Lemma creates
it, indexes it, and gives you `pod.table("candidates").create({...})`.

> **Hiremind example:** we have a `candidates` table with `name`, `email`,
> `linkedin_url`, `score`, `stage`, `dossier_path`. That's the whole
> database, and we never ran a migration.

### 2. Files — durable file storage, like Dropbox for your app

You can read and write files under `/candidates/…` or `/knowledge/…`.
Perfect for LLM-generated markdown that shouldn't live in a database row.

> **Hiremind example:** every candidate has a
> `/candidates/<id>/dossier.md` — a rich markdown profile the LLM writes
> on intake. It's a file, not a database row, because it's human-editable
> and diff-able.

### 3. Functions — Python code that runs on demand

You write a Python function with typed inputs and outputs, drop it in a
folder, `pods import`, and it's now callable — from the UI, from a chat
message, from a workflow, from a schedule. No Docker, no server, no
cold-start engineering.

> **Hiremind example:** `parse_intake()` takes a raw LinkedIn URL, scores
> the candidate against the role rubric, generates a dossier — a pure
> function. Also `send_outreach()`, `schedule_screen()`, `poll_replies()`.
> Each one is 100 lines of Python. Together they're the entire "backend."

### 4. Agents — LLMs with rules and permissions

Instead of raw `openai.chat()` calls sprinkled through your code, an
*agent* is a first-class thing: an instruction file (the personality), a
set of tool grants (which functions it's allowed to call), and a channel
it lives on. You can chat with it directly from Slack or WhatsApp, or
invoke it inside code.

> **Hiremind example:** the `whatsapp_intake` agent is a founder-facing
> chatbot. When someone forwards a LinkedIn URL to the Hiremind WhatsApp
> bot, that agent reads it, calls `parse_intake` and `create_candidate`,
> then replies "added Priya to Sourced, scored 8.1." Every part of that is
> one agent + two functions.

### 5. Workflows — visual pipelines with human approval gates (the killer primitive)

Workflows chain functions and agents together — but the important part is
the **FORM node**, which pauses the whole pipeline until a human clicks
approve. Lemma won't let a workflow skip a FORM node, so "human in the
loop" isn't a code convention you hope for, it's *guaranteed by the
platform.*

> **Hiremind example:** the `outreach` workflow is
> `draft_outreach → record_draft → [FORM: approve] → send_outreach → END`.
> The founder's Drafts inbox is literally the list of paused workflow
> runs. There is no code path where `send_outreach` runs without founder
> approval, because Lemma physically won't let one exist.

### 6. Schedules — cron, but you don't set up a server

A schedule points at a function and fires on a cadence. No Kubernetes
cron job to manage.

> **Hiremind example:** `poll_replies` fires every 2 minutes to check the
> founder's Gmail for candidate replies. `fri_digest` fires every Friday
> at 5pm to email the founder the week's hiring summary. Zero infra.

### 7. Apps — a full web frontend, hosted on Lemma

You build a React/Vite app in the pod folder, run `lemma apps deploy`,
and it's live at `<name>.apps.lemma.work` — with the pod's SDK preloaded
so the app can talk to your tables and functions natively. No Vercel, no
Netlify, no CORS setup.

> **Hiremind example:** we have four apps — `operator` (the founder's
> kanban desk app), `landing` (public marketing page), `apply` (public
> application form), `candidate-view` (a per-candidate status page that
> also runs the AI interview). All served by Lemma. Zero hosting bill.

### 8. Surfaces — plug your product into WhatsApp, Slack, Telegram, Gmail

A surface tells Lemma: "this agent is the WhatsApp bot for phone number
+1-555…". Now every message to that number becomes an agent invocation.
Same for Slack DMs, Telegram bots, or Gmail replies.

> **Hiremind example:** four surfaces. WhatsApp (founder-facing intake),
> Telegram (referral pipe), Gmail (reads candidate replies), Slack
> (notifies the team). All the messy webhook plumbing that would normally
> take a week is one JSON file.

---

## How they compose — one real Hiremind flow, end to end

To make it click, here's what happens the moment a founder forwards a
LinkedIn URL to the Hiremind WhatsApp bot. All the primitives on stage at
once:

```
📱 Founder forwards URL to WhatsApp
   │
   ▼
[SURFACE: whatsapp] delivers the message to
[AGENT: whatsapp_intake]
   │
   ▼ agent has permission to call
[FUNCTION: parse_intake]  →  reads role rubric from
                              [FILE: /knowledge/roles/founding-ai.md]
                              writes candidate dossier to
                              [FILE: /candidates/<id>/dossier.md]
                              scores 0–10
   │
   ▼
[FUNCTION: create_candidate]  →  inserts into
                                  [TABLE: candidates]
   │
   ▼
[FUNCTION: triage_and_notify]  →  Gmail founder-notification
   │
   ▼
[WORKFLOW: outreach] starts
   ├─ draft_outreach  (LLM writes intro email in founder voice)
   ├─ record_draft    (persists to [TABLE: messages])
   ├─ [FORM: approve] ⟵  ⏸ pauses until founder taps in the operator app
   └─ send_outreach   (Gmail actually sends)
   │
   ▼
[APP: operator] shows the new card on the kanban in real time via a
                 live table watcher
```

Total code we wrote: about **1,500 lines of Python + 3,000 lines of
React**. Total code we *didn't* write: an ORM, an auth server, a webhook
router, a cron system, a job queue, an approval mechanism, a WhatsApp
integration, a Gmail integration, a deploy pipeline, a hosting setup.
That's the leverage.

---

## Why this is different (the "aha" for the audience)

Explain it as three punchlines:

1. **"It's Firebase for AI products."** Firebase gave you a database +
   auth + hosting so you could ship a mobile app in a weekend. Lemma
   gives you database + LLM agents + workflows + chat surfaces so you can
   ship an AI product in a weekend.

2. **"Human-in-the-loop is architectural, not aspirational."** Every
   AI-agent platform *claims* it has human approval. Lemma is the only
   one where the platform *enforces* it — via the FORM node. The AI
   literally cannot send the email until you tap approve. That's a huge
   trust wedge for regulated / high-stakes domains (hiring, legal,
   medical, finance).

3. **"One folder, one command."** Every other stack asks you to think
   about hosting, secrets, deploy targets, environment variables, and
   infrastructure separately. Lemma collapses all of it into
   `lemma pods import`. The whole product is code, not config.

---

## When would someone use Lemma?

Great uses (say these out loud in the pitch):

- **Hiring** — Hiremind (what we built)
- **Customer support triage** — inbound WhatsApp/Slack → LLM drafts
  response → agent approves → sent
- **Sales SDR co-pilot** — LinkedIn URL comes in → enrichment → drafted
  outreach → founder approves
- **Legal doc review** — contract dropped in Slack → LLM redlines →
  lawyer approves changes → returned
- **Medical intake** — patient describes symptoms → triage agent → nurse
  approves → routed
- **Anything with a chat surface + AI + a human who has to sign off**

Bad uses (be honest — this is what makes you trustworthy):

- Consumer social apps (Lemma isn't a mobile SDK).
- Games (real-time, high-frequency).
- Anything that needs its own physical deploy target for latency reasons
  (edge compute).

---

## The one-liner to close on

> **"On any other stack, the primitives that make an AI product real —
> agents, approval gates, chat surfaces, durable state — sit in five
> different vendors. Lemma is the first platform where they're the same
> primitives in the same folder, deployed with the same command.
> Everything I just showed you shipped in a single weekend. That's the
> pitch."**

Speak that line at the end. It's the whole thing.
