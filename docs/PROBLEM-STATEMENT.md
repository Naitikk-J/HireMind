# Problem Statement — Hiremind

> **What we're solving, why it matters, and how Hiremind solves it.**
> A drop-in for hackathon / grant / accelerator submissions.

---

## The problem

Founder-led hiring is broken in a very specific way.

In the first ~50 hires of a company, the founder **is** the recruiter — nobody
else knows the taste bar, the voice, or the actual role well enough. But the
founder also has to build the product. So one of two things happens:

1. **They hire an external recruiter** — who doesn't know the founder's voice,
   sends templated outreach, floods the pipeline with noise, and the founder
   ends up rejecting 90% of what comes through. Net: expensive, slow, and
   candidates get a bad experience.
2. **They do it themselves** — and it eats 15–20 hours a week. LinkedIn open
   all day, half-drafted emails in Gmail, calendars a mess, referrals falling
   through the cracks, "I'll follow up tomorrow" turning into two weeks of
   silence.

The core issue: **every existing hiring tool is built for recruiters, not for
founders.** Greenhouse, Lever, and Ashby all assume a hiring team, a
coordinator, and a pipeline manager. A solo founder doesn't have any of that.
They just have a phone, a Gmail inbox, and taste.

Meanwhile, LLMs *can* do 80% of the work — parse a LinkedIn profile, score
against a rubric, draft outreach in the founder's voice, chase replies,
schedule screens. But no product actually puts those pieces together **with
the founder in the loop**, because the moment an AI sends an email in the
founder's name without approval, the whole thing collapses on trust.

---

## How Hiremind solves it

Hiremind is a **founder-led hiring OS with mandatory human approval at every
outbound step.**

- Forward a LinkedIn URL to a WhatsApp bot.
- Hiremind parses it, scores it against your role rubric, writes a candidate
  dossier, and drafts intro outreach in your voice.
- The draft lands in a **Drafts queue** in the operator app.
- You tap **Approve** — and only then does the email actually go.
- Same pattern for scheduling, screening questions, offer letters, and
  rejections.
- **The AI does the typing. The founder does the deciding.**

### The technical wedge

The "human in the loop" isn't a code convention we hope for — it's enforced
by the Lemma platform we're built on, via the **FORM node** primitive in a
workflow. The email *literally cannot send* without founder approval. That
architectural guarantee is what makes the product safe enough for a founder
to actually trust with their voice and their brand.

---

## Submission paragraph (copy-paste ready)

> Hiring the first 50 employees is founder work — no external recruiter knows
> the taste bar or the founder's voice well enough to represent them. But
> doing it yourself eats 15–20 hours a week: parsing LinkedIn URLs, drafting
> outreach, chasing replies, scheduling screens, sending rejections. LLMs can
> automate 80% of that today, but no product ships it safely — because a
> founder can't hand off their voice to an AI that might send the wrong
> thing. **Hiremind** is a founder-led hiring OS: forward a candidate to a
> WhatsApp bot, and the AI parses, scores, dossiers, drafts outreach, chases
> replies, and schedules screens in the founder's voice — but every outbound
> message pauses in a Drafts queue for founder approval before it actually
> sends. The AI does the typing; the founder does the deciding. Built on
> Lemma, where the human-approval gate is a platform primitive (the FORM
> node), so the guarantee "no email sends without founder approval" is
> enforced architecturally, not by convention.

---

## One-liner (for pitches, headers, decks)

> **Hiremind is Cursor for hiring — an AI hiring OS where every outbound
> action pauses for founder approval before it sends.**
