import type { Candidate, Role, Message, Interview, Task } from "./types";

const now = Date.now();
const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString();
const daysAgo = (d: number) => new Date(now - d * 86400_000).toISOString();

export const mockRoles: Role[] = [
  {
    id: "role-ai-pm",
    title: "AI Product Engineer",
    slug: "ai-pm",
    status: "open",
    must_haves: ["Shipped AI feature to production", "End-to-end ownership", "Strong writing"],
    nice_haves: ["Agentic framework experience", "Eval instinct"],
    rubric_file: "/knowledge/roles/ai-pm/rubric.md",
    pitch_file: "/knowledge/roles/ai-pm/pitch.md",
  },
  {
    id: "role-senior-fe",
    title: "Senior Frontend Engineer",
    slug: "senior-fe",
    status: "open",
    must_haves: ["5+ yrs production React", "Live URL of polished work", "TypeScript fluency"],
    nice_haves: ["Design systems", "Animation chops"],
    rubric_file: "/knowledge/roles/senior-fe/rubric.md",
  },
  {
    id: "role-founding-de",
    title: "Founding Design Engineer",
    slug: "founding-de",
    status: "open",
    must_haves: ["Designs AND ships own code", "Strong taste in motion/typography"],
    nice_haves: ["Editorial design background"],
    rubric_file: "/knowledge/roles/founding-de/rubric.md",
  },
];

export const mockCandidates: Candidate[] = [
  {
    id: "c-001", number: 1,
    name: "Aarti Krishnan",
    email: "aarti.k@example.com",
    linkedin_url: "https://linkedin.com/in/aartikrishnan",
    source: "linkedin", role_id: "role-ai-pm",
    stage: "replied", status: "active", score: 8.6,
    next_action: "Reply with 3 slots", last_contact: hoursAgo(20),
    public_token: "aarti-krishnan-9k2hxp",
    dossier_path: "/candidates/c-001/dossier.md",
    referrer_id: null,
    created_at: daysAgo(3), updated_at: hoursAgo(20),
  },
  {
    id: "c-002", number: 2,
    name: "Vikram Mehta",
    email: "vikram@example.com",
    linkedin_url: "https://linkedin.com/in/vikrammehta",
    source: "referral", role_id: "role-ai-pm",
    source_meta: { referrer_name: "Rohit Pandey" },
    stage: "offer", status: "active", score: 9.1,
    next_action: "Decide on offer (decision pending)",
    last_contact: hoursAgo(36),
    public_token: "vikram-mehta-44tbjm",
    dossier_path: "/candidates/c-002/dossier.md",
    referrer_id: "ref-rohit",
    created_at: daysAgo(14), updated_at: hoursAgo(36),
  },
  {
    id: "c-003", number: 3,
    name: "Priyanka Singh",
    email: "priyanka.s@example.com",
    linkedin_url: "https://linkedin.com/in/priyankasingh",
    source: "linkedin", role_id: "role-senior-fe",
    stage: "intro_sent", status: "active", score: 7.4,
    next_action: "Wait for reply (3 days)",
    last_contact: daysAgo(3),
    public_token: "priyanka-singh-x8na4f",
    dossier_path: "/candidates/c-003/dossier.md",
    referrer_id: null,
    created_at: daysAgo(5), updated_at: daysAgo(3),
  },
  {
    id: "c-004", number: 4,
    name: "Ankit Rao",
    email: "ankit@example.com",
    source: "twitter", role_id: "role-ai-pm",
    stage: "sourced", status: "active", score: 7.8,
    next_action: "Review dossier and draft intro",
    last_contact: null, public_token: "ankit-rao-22mq91",
    dossier_path: "/candidates/c-004/dossier.md",
    referrer_id: null,
    created_at: hoursAgo(4), updated_at: hoursAgo(4),
  },
  {
    id: "c-005", number: 5,
    name: "Meera Joshi",
    email: "meera.j@example.com",
    linkedin_url: "https://linkedin.com/in/meerajoshi",
    source: "referral", role_id: "role-founding-de",
    source_meta: { referrer_name: "Anika Sehgal" },
    stage: "screen_done", status: "active", score: 8.2,
    next_action: "Schedule founder chat",
    last_contact: daysAgo(1),
    public_token: "meera-joshi-71fnp3",
    dossier_path: "/candidates/c-005/dossier.md",
    referrer_id: "ref-anika",
    created_at: daysAgo(10), updated_at: daysAgo(1),
  },
  {
    id: "c-006", number: 6,
    name: "Karthik Iyer",
    email: "karthik@example.com",
    linkedin_url: "https://linkedin.com/in/karthikiyer",
    source: "linkedin", role_id: "role-senior-fe",
    stage: "reviewed", status: "active", score: 6.9,
    next_action: "Pass — not enough shipped signal",
    last_contact: null, public_token: "karthik-iyer-1qa8tn",
    dossier_path: "/candidates/c-006/dossier.md",
    referrer_id: null,
    created_at: daysAgo(2), updated_at: daysAgo(2),
  },
  {
    id: "c-007", number: 7,
    name: "Devika Nair",
    email: "devika@example.com",
    linkedin_url: "https://linkedin.com/in/devikanair",
    source: "inbound_email", role_id: "role-ai-pm",
    stage: "onsite_done", status: "active", score: 8.9,
    next_action: "Compile scorecards (2 pending)",
    last_contact: daysAgo(2),
    public_token: "devika-nair-bn4jc2",
    dossier_path: "/candidates/c-007/dossier.md",
    referrer_id: null,
    created_at: daysAgo(12), updated_at: daysAgo(2),
  },
];

export const mockMessages: Message[] = [
  {
    id: "m-001",
    candidate_id: "c-004",
    direction: "outbound", channel: "email",
    subject: "that thread on agent harnesses",
    body:
      "Hey Ankit — saw your thread last week on why agent harnesses keep losing context across hand-offs. The thing you said about the state primitive being the actual product, not the model, is exactly the bet we're making here.\n\nWe're hiring an AI Product Engineer — founding team, ships product not roadmaps. Worth 25 minutes next week to see if it's a fit either way?\n\nNaitik",
    status: "awaiting_approval",
    created_by: "outreach_drafter",
    created_at: hoursAgo(1),
  },
  {
    id: "m-002",
    candidate_id: "c-001",
    direction: "outbound", channel: "email",
    subject: "Friday 3pm or Monday 11am?",
    body:
      "Hey Aarti — three options for the intro chat:\n\n• Thu 25 Jun, 3:00pm IST\n• Fri 26 Jun, 11:00am IST\n• Mon 29 Jun, 4:30pm IST\n\nAll 30 min. Reply with whichever and I'll send a calendar invite.\n\nNaitik",
    status: "awaiting_approval",
    created_by: "scheduler",
    created_at: hoursAgo(2),
  },
  {
    id: "m-003",
    candidate_id: "c-001",
    direction: "inbound", channel: "email",
    body:
      "Hey Naitik — yes interested. Send me a few times that work for you and I'll pick one.",
    status: "received",
    created_at: hoursAgo(20),
  },
  {
    id: "m-004",
    candidate_id: "c-001",
    direction: "outbound", channel: "email",
    subject: "that formula explanations bit",
    body:
      "Hey Aarti — I saw the Copilot for Excel formula explanations launch and the way you snuck an agent into a place nobody expected one. That's exactly the insertion-point thinking I'm trying to hire for.\n\nAI PM role, founding team, ships product not roadmaps. 25 minutes next week to see if it's a fit either way?\n\nNaitik",
    status: "sent",
    sent_at: daysAgo(3),
    created_at: daysAgo(3),
  },
];

export const mockInterviews: Interview[] = [
  {
    id: "iv-001", candidate_id: "c-002",
    round: "founder_chat", status: "done",
    scheduled_at: daysAgo(2),
    interviewer_email: "naitik@example.com",
  },
  {
    id: "iv-002", candidate_id: "c-007",
    round: "product_judgment", status: "done",
    scheduled_at: daysAgo(3),
    interviewer_email: "priya@example.com",
  },
];

export const mockTasks: Task[] = [
  { id: "t-001", type: "decide_offer", candidate_id: "c-002",
    title: "Decide on offer for Vikram Mehta", status: "pending",
    due: hoursAgo(-12) },
  { id: "t-002", type: "needs_followup", candidate_id: "c-003",
    title: "Follow up with Priyanka Singh if no reply", status: "pending",
    due: hoursAgo(-24) },
];

export const mockDossier = (id: string): string => {
  const d: Record<string, string> = {
    "c-001": `## Snapshot
- Senior PM at Microsoft, 6 yrs experience
- Currently shipping Copilot integrations for Excel
- BS CMU, MBA Wharton
- Based in Bangalore (relocated from Seattle last year)

## Why interesting for this role
She shipped the Copilot for Excel *formula explanations* launch — agentic insertion into a surface where nobody expected an agent. The way she described the design choices in her thread suggests insertion-point thinking that maps exactly to what we need on the AI PM side. Also writes precisely and publicly.

## Concerns / things to watch
- Big-co tenure; needs validation she can ship without a platform team
- Not yet visible work outside Microsoft surface area

## Talking points (3)
1. The formula-explanations launch — what they cut to ship
2. Her thread on "the agent harness IS the product"
3. The Bangalore relocation — what she's looking for next

## Prep questions (3)
1. Last week you shipped X — what did you cut to ship?
2. Last hire you'd make if you ran a 5-person AI team?
3. What's the ugliest piece of code you've shipped to production?

## Confidence
8.6 / 10 fit. Biggest uncertainty: scrappiness under no-platform constraints.`,
    "c-002": `## Snapshot
- Founder of two prior startups, both acquired
- Built and sold a developer-tools company in 2023
- Princeton CS, Stanford GSB
- Currently advising 3 early-stage AI startups

## Why interesting for this role
Vikram is a founder-of-founders — he's been the AI PM at his own companies. The way he described our product direction in the first call was sharper than our own internal articulation. Strong taste, ships fast, comfortable with ambiguity at zero-to-one.

## Concerns / things to watch
- Has he had a peer in 5 years? Adjusting to non-CEO role is the real risk
- Comp expectations will likely be the conversation

## Talking points (3)
1. What he'd do in his first 30 days
2. What hires he'd make next
3. How he'd structure the agent roadmap

## Confidence
9.1 / 10 fit. Biggest uncertainty: equity vs cash trade-off.`,
    "c-004": `## Snapshot
- 8 yrs eng, 2 yrs OSS maintainer of an agent framework
- Currently solo at a small AI infra startup
- Writes the most precise technical posts on his timeline

## Why interesting for this role
That thread he posted on why agent harnesses keep losing context across hand-offs — the diagnosis is exactly the bet we're making. The state primitive IS the product, not the model. He'd ship the right thing first.

## Concerns / things to watch
- No PM title before; unproven on product-side judgment
- We'd need to validate he can drop into product-led mode, not infra-led

## Talking points (3)
1. The harness-thread — what's the deepest insertion point he didn't cover
2. What's the one thing he wishes more people building on agents understood
3. How he'd choose what NOT to ship in week one

## Prep questions (3)
1. Walk us through your most painful decision-to-ship
2. Tell us about something you DIDN'T ship and why
3. What's the worst PM you've worked with — what made them bad

## Confidence
7.8 / 10 fit. Biggest uncertainty: product-side judgment without prior PM role.`,
  };
  return d[id] || `## Snapshot\n_(Dossier not yet generated for this candidate.)_\n`;
};
