import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { TopBar } from "@/components/layout/TopBar";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { DossierView } from "@/components/DossierView";
import { StageActions } from "@/components/StageActions";
import { getClient } from "@/lib/client";
import { STAGES, STAGE_LABELS, STAGE_ACCENT, cn, formatRelative, scoreTone } from "@/lib/utils";
import type { Candidate, Interview, Message, Role, Stage } from "@/lib/types";

export function CandidateDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [loading, setLoading] = useState(true);
  const [enriching, setEnriching] = useState(false);
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [enrichSuccess, setEnrichSuccess] = useState<string | null>(null);

  const refresh = async () => {
    if (!id) return;
    const client = await getClient();
    try {
      const c = await client.records.get<Candidate>("candidates", id);
      setCandidate(c);
      if (c.role_id) {
        try { setRole(await client.records.get<Role>("roles", c.role_id)); } catch { /* */ }
      }
      const [m, iv] = await Promise.all([
        client.records.list<Message>("messages", { filter: { candidate_id: id } }),
        client.records.list<Interview>("interviews", { filter: { candidate_id: id } }),
      ]);
      setMessages(m.items.sort((a, b) => b.created_at.localeCompare(a.created_at)));
      setInterviews(iv.items.sort((a, b) => (b.scheduled_at || "").localeCompare(a.scheduled_at || "")));
    } finally { setLoading(false); }
  };

  useEffect(() => { setLoading(true); refresh(); }, [id]);

  async function enrichWithAi() {
    if (!candidate) return;
    setEnriching(true);
    setEnrichError(null);
    setEnrichSuccess(null);
    const prevScore = candidate.score ?? null;
    try {
      const client = await getClient();
      const { run_id } = await client.workflows.run(
        "enrich_candidate",
        { data: { candidate_id: candidate.id } },
      );
      await client.workflows.waitForRun(run_id, { timeoutMs: 180_000, pollMs: 2500 });
      const fresh = await client.records.get<Candidate>("candidates", candidate.id);
      setCandidate(fresh);
      const newScore = fresh.score ?? prevScore;
      setEnrichSuccess(
        prevScore !== null && newScore !== null
          ? `Re-analyzed. Score ${prevScore.toFixed(1)} → ${newScore.toFixed(1)}.`
          : newScore !== null
            ? `Re-analyzed. Score ${newScore.toFixed(1)}.`
            : "Re-analyzed."
      );
      setTimeout(() => setEnrichSuccess(null), 8000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Enrichment failed.";
      setEnrichError(
        /model|llm|provider|runtime|profile/i.test(msg)
          ? "No LLM model configured for this pod. Wire one in the runtime profile and try again."
          : msg
      );
    } finally {
      setEnriching(false);
    }
  }

  if (loading) {
    return (
      <>
        <TopBar title="Loading…" />
        <div className="flex-1 flex items-center justify-center text-muted text-sm gap-2">
          <Spinner size={13} /> Loading candidate…
        </div>
      </>
    );
  }
  if (!candidate) {
    return (
      <>
        <TopBar title="Not found" />
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
          <p className="text-xl font-semibold tracking-tight">Can't find that one</p>
          <p className="text-muted text-sm">The candidate may have been merged or deleted.</p>
          <Link to="/" className="text-sm underline underline-offset-4 text-accent-2">Back to Today</Link>
        </div>
      </>
    );
  }

  // For the progress bar denominator we want hired = 100%, not 87% — so we
  // count the forward-path stages (everything up to and including 'hired')
  // rather than the full STAGES list which now includes 'rejected' at the end.
  // 'rejected' is treated as off-track and skips the bar entirely below.
  const FORWARD_LAST = STAGES.indexOf("hired");
  const stageIdx = STAGES.indexOf(candidate.stage as never);
  const isOffTrack = candidate.stage === "closed";
  const tone = scoreTone(candidate.score);
  const scoreColor =
    tone === "high" ? "text-success" :
    tone === "mid"  ? "text-fg" :
    tone === "low"  ? "text-warning" : "text-faint";
  const accent = STAGE_ACCENT[candidate.stage];

  return (
    <>
      <TopBar
        eyebrow={role ? role.title : "Candidate"}
        title={candidate.name}
        actions={<Button variant="ghost" size="sm" onClick={() => navigate(-1)}>← Back</Button>}
      />

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-[1200px] mx-auto px-7 py-6">
          {/* Hero card */}
          <section className="bg-surface border border-border rounded-lg overflow-hidden mb-5">
            <div className="px-5 py-4 flex items-start gap-4 border-b border-border">
              <Avatar name={candidate.name} size="lg" />
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-semibold text-fg tracking-tight leading-tight">{candidate.name}</h2>
                <div className="text-xs text-muted mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <EmailField candidate={candidate} onSaved={refresh} />
                  {candidate.linkedin_url ? (
                    <a href={candidate.linkedin_url} target="_blank" rel="noreferrer"
                       className="underline underline-offset-4 decoration-border hover:decoration-fg">
                      LinkedIn
                    </a>
                  ) : null}
                  <span className="text-faint">·</span>
                  <span>Added {formatRelative(candidate.created_at)}</span>
                  <span className="text-faint">·</span>
                  <span className="capitalize">via {candidate.source.replace(/_/g, " ")}</span>
                </div>
                {candidate.next_action ? (
                  <div className="mt-3 text-sm text-fg/90 leading-relaxed text-pretty">
                    <span className="label mr-2">Next action</span>
                    {candidate.next_action}
                  </div>
                ) : null}
              </div>
              <div className="text-right pl-4 border-l border-border min-w-[88px]">
                <div className="label">Fit score</div>
                <div className={cn("text-3xl font-semibold num leading-none mt-1.5 tracking-tight", scoreColor)}>
                  {candidate.score?.toFixed(1) ?? "—"}
                </div>
                <div className="text-2xs text-faint mt-2">
                  {tone === "high" ? "strong" : tone === "mid" ? "promising" : tone === "low" ? "weak" : "unscored"}
                </div>
              </div>
            </div>

            <div className="px-5 py-3.5 border-b border-border flex items-center gap-2">
              <span className={cn("h-1.5 w-1.5 rounded-full", accent.dot)} />
              <span className="text-xs font-medium text-fg">{STAGE_LABELS[candidate.stage]}</span>
              {isOffTrack ? (
                <span className="text-2xs text-danger ml-3 uppercase tracking-widest font-medium">Off pipeline</span>
              ) : (
                <>
                  <span className="text-2xs text-faint ml-3">stage {stageIdx + 1} of {FORWARD_LAST + 1}</span>
                  <div className="flex-1 ml-3 h-1 bg-subtle rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent rounded-full"
                      style={{ width: `${Math.max(0, Math.min(100, ((stageIdx + 1) / (FORWARD_LAST + 1)) * 100))}%` }}
                    />
                  </div>
                </>
              )}
            </div>
          </section>

          {/* Stage-aware actions: only buttons that make sense for this candidate's
              current kanban column. Each transition is either a direct stage update or
              kicks off the outreach workflow with the matching intent. */}
          <section className="mb-5">
            <StageActions candidate={candidate} onChanged={refresh} />
          </section>

          <div className="grid grid-cols-12 gap-5">
            <section className="col-span-12 lg:col-span-8 space-y-5">
              <div className="bg-surface border border-border rounded-lg overflow-hidden">
                <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold leading-none tracking-tight">Dossier</div>
                    <div className="text-2xs text-faint mt-1 uppercase tracking-widest font-mono truncate">
                      {candidate.dossier_path || "—"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge tone="accent">agent-written</Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={enrichWithAi}
                      disabled={enriching}
                      title="Re-analyze with the LLM — refines the dossier, score, and next action."
                    >
                      {enriching ? (
                        <><Spinner size={11} className="mr-1.5" /> Analyzing…</>
                      ) : (
                        <>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5">
                            <path d="M12 3v3M12 18v3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M3 12h3M18 12h3M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
                          </svg>
                          Analyze with AI
                        </>
                      )}
                    </Button>
                  </div>
                </div>
                {enrichError ? (
                  <div className="px-5 py-2.5 border-b border-border bg-danger/10 text-2xs text-danger leading-relaxed">
                    {enrichError}
                  </div>
                ) : null}
                {enrichSuccess ? (
                  <div className="px-5 py-2.5 border-b border-border bg-success/10 text-2xs text-success leading-relaxed">
                    {enrichSuccess}
                  </div>
                ) : null}
                <div className="px-5 py-4">
                  <DossierView path={candidate.dossier_path} />
                </div>
              </div>
            </section>

            <aside className="col-span-12 lg:col-span-4 space-y-5">
              <div className="bg-surface border border-border rounded-lg overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
                  <div className="text-sm font-semibold leading-none tracking-tight">Conversation</div>
                  <Badge tone="muted">{messages.length}</Badge>
                </div>
                {messages.length === 0 ? (
                  <p className="text-xs text-faint italic px-4 py-5 text-center">No messages yet.</p>
                ) : (
                  <ul>
                    {messages.map((m) => (
                      <li key={m.id} className="px-4 py-3 border-b border-border last:border-0">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <Badge tone={m.direction === "outbound" ? "accent" : "success"} dot>
                            {m.direction === "outbound" ? "Sent" : "Received"}
                          </Badge>
                          <span className="text-2xs text-faint num">{formatRelative(m.sent_at || m.created_at)}</span>
                        </div>
                        {m.subject ? (
                          <div className="text-xs font-medium text-fg mb-0.5 truncate">{m.subject}</div>
                        ) : null}
                        <p className="text-2xs text-fg/80 line-clamp-3 leading-relaxed">{m.body}</p>
                        {m.status !== "sent" && m.status !== "received" ? (
                          <div className="mt-1.5">
                            <Badge tone={m.status === "awaiting_approval" ? "warning" : "muted"}>
                              {m.status.replace(/_/g, " ")}
                            </Badge>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <InterviewsPanel
                candidate={candidate}
                interviews={interviews}
                onChanged={refresh}
              />

              {candidate.public_token ? (
                <CandidateSidePreview
                  candidate={candidate}
                  role={role}
                />
              ) : null}
            </aside>
          </div>
        </div>
      </div>
    </>
  );
}

// Candidate-side stages — mirrors the timeline in `apps/candidate-view/html.html`.
// Kept short and candidate-facing (no "screening rejected", no internal jargon).
// `closed` is a terminal off-pipeline state and gets its own copy below.
const CANDIDATE_STAGES: { key: string; label: string; hint: string }[] = [
  { key: "sourced",     label: "Application received",  hint: "Founder is reviewing your profile" },
  { key: "reviewed",    label: "Profile reviewed",      hint: "Founder is preparing to reach out" },
  { key: "intro_sent",  label: "Initial outreach sent", hint: "Awaiting your reply" },
  { key: "replied",     label: "Conversation started",  hint: "Scheduling the intro call" },
  { key: "screen_done", label: "Screening complete",    hint: "Awaiting next-step decision" },
  { key: "onsite_done", label: "Deep dives complete",   hint: "Team is calibrating" },
  { key: "offer",       label: "Offer stage",           hint: "Decision pending" },
  { key: "hired",       label: "Welcome aboard",        hint: "We'll be in touch with logistics" },
];

/**
 * Build the publicly shareable candidate-status URL.
 *
 * Lemma's platform has no public, token-gated datastore read endpoint, so we
 * can't have the candidate page query the pod for live state — any backend
 * call would fail without an authenticated session.
 *
 * Workaround: encode a *snapshot* of the candidate's current state directly
 * into the URL hash, and have `apps/candidate-view/html.html` decode + render
 * it. The hash never leaves the browser (not sent to the server, not in our
 * access logs), so the candidate's name + stage stay out of any backend log.
 *
 * When the candidate is in the AI-interview stage (`onsite_done`), we
 * additionally bake the role's interview prompts into the URL so the public
 * page can run the chat-styled screen entirely offline. The prompts come
 * from `role.interview_questions` if set, else are derived from `must_haves`
 * by the small helper below — same source of truth, no LLM round-trip.
 *
 * Tradeoffs the operator should understand:
 *   - The link is a snapshot *as of when it was generated*. If you advance
 *     the candidate's stage, the previously-sent link still shows the old
 *     stage. Founder-led hiring naturally rotates links via outreach.
 *   - If you edit the role's must-haves after sharing the link, the
 *     candidate's already-open link keeps the *old* question set. Send a
 *     fresh link to force a refresh.
 */
const CANDIDATE_VIEW_ORIGIN = "https://c.apps.lemma.work";

// Stage where the candidate is expected to run the AI interview from their
// public link. Kept as a constant to mirror the same key the candidate-view
// HTML uses internally; if we ever add a "second-round" interview stage, this
// is the one place we'd extend.
const INTERVIEW_STAGE: Stage = "onsite_done";

// Generic fallback questions used when the role has neither
// `interview_questions` nor `must_haves`. These are intentionally founder-y
// rather than HR-y so the AI screen still feels like a real conversation
// even on a brand-new role with no rubric filled in yet.
const DEFAULT_INTERVIEW_QUESTIONS: string[] = [
  "Walk me through the project you're proudest of from the last two years — what did you build, what trade-offs did you make, and what would you do differently now?",
  "Tell me about the hardest technical (or operational) problem you've solved end-to-end. How did you debug it?",
  "Why this role specifically? What's the part of the job you'd find most energizing in the first six months?",
  "Describe a time you disagreed with a teammate or founder. How did you handle it and what was the outcome?",
  "What questions do you have for the founder about the team, the product, or how decisions get made here?",
];

function deriveInterviewQuestions(role: Role | null): string[] {
  // If the role explicitly declares interview questions on the row, those win.
  // Otherwise fall back to the must-haves, lightly rephrased so they read as
  // open-ended interview prompts rather than checkbox criteria. That keeps
  // the path from rubric → interview deterministic and editable in one place.
  if (role) {
    const explicit = (role as Role & { interview_questions?: string[] }).interview_questions;
    if (Array.isArray(explicit) && explicit.length > 0) {
      const cleaned = explicit.filter((q) => typeof q === "string" && q.trim().length > 0);
      if (cleaned.length > 0) return cleaned.slice(0, 6);
    }
    const musts = (role.must_haves || []).filter((m) => m && m.trim().length > 0).slice(0, 5);
    if (musts.length > 0) {
      return musts.map((m) => {
        const trimmed = m.trim().replace(/\.$/, "");
        if (/^(what|how|why|when|where|tell|describe|walk|share|give)/i.test(trimmed)) {
          return trimmed.endsWith("?") ? trimmed : `${trimmed}?`;
        }
        return `Tell me about your experience with: ${trimmed}.`;
      });
    }
  }
  // Defensive default — every Interview-stage link should carry at least
  // enough prompts for the screen to function, even if no role is attached
  // or its rubric is empty.
  return DEFAULT_INTERVIEW_QUESTIONS;
}

function buildCandidateStatusUrl(args: {
  candidate: Candidate;
  role: Role | null;
}): string {
  const { candidate, role } = args;
  // Always ship interview_questions in the payload — even when the candidate
  // isn't currently in the Interview stage. Reason: if the operator copies a
  // link now and advances the stage later, *that* link still won't help; but
  // links sent during/after the move will already have the questions ready,
  // even if a previous URL-build skipped them. Cost: ~150 extra bytes in the
  // hash, no PII.
  const payload: Record<string, unknown> = {
    v: 1,
    name: candidate.name,
    stage: candidate.stage,
    role_title: role?.title || null,
    public_token: candidate.public_token || null,
    founder_name: "the founder",
    typical_response_hours: 48,
    generated_at: new Date().toISOString(),
    interview_questions: deriveInterviewQuestions(role),
  };
  // URL-safe base64 of UTF-8 JSON. We strip `=` padding for prettiness; the
  // page accepts both padded and unpadded variants.
  const json = JSON.stringify(payload);
  const utf8 = new TextEncoder().encode(json);
  let binary = "";
  for (let i = 0; i < utf8.length; i++) binary += String.fromCharCode(utf8[i]);
  const b64 = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${CANDIDATE_VIEW_ORIGIN}/#d=${b64}`;
}

/**
 * Decode an interview-transcript share-code back into a structured object.
 * The candidate-view page builds this code with `b64uEncodeJson` over a
 * `{kind:"interview_transcript", answers:[{q,a,ts},…]}` envelope. We accept
 * both raw codes and codes that may have been pasted with surrounding
 * whitespace or quote marks.
 */
type InterviewTranscript = {
  kind: "interview_transcript";
  candidate_name?: string;
  public_token?: string | null;
  role_title?: string;
  completed_at?: string;
  answers: { q: string; a: string; ts?: string }[];
};

function decodeTranscriptCode(raw: string): InterviewTranscript | null {
  let s = raw.trim().replace(/^["'`]+|["'`]+$/g, "");
  if (!s) return null;
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const json = new TextDecoder("utf-8").decode(bytes);
    const obj = JSON.parse(json);
    if (
      obj && typeof obj === "object" &&
      obj.kind === "interview_transcript" &&
      Array.isArray(obj.answers)
    ) {
      return obj as InterviewTranscript;
    }
    return null;
  } catch {
    return null;
  }
}

function renderTranscriptMarkdown(t: InterviewTranscript, candidateName: string): string {
  const header =
    `# Interview transcript — ${candidateName}\n\n` +
    `*Completed ${t.completed_at ? new Date(t.completed_at).toLocaleString() : "(unknown)"} ` +
    `· Role: ${t.role_title || "—"}*\n\n---\n\n`;
  const body = t.answers
    .map((qa, i) => `## Q${i + 1}. ${qa.q}\n\n${qa.a.trim()}\n`)
    .join("\n");
  return header + body;
}

function CandidateSidePreview({
  candidate,
  role,
}: {
  candidate: Candidate;
  role: Role | null;
}) {
  const stage = candidate.stage;
  // 'closed' is the on-the-wire enum value the UI labels as "Rejected" —
  // see Stage in lib/types.ts.
  const isClosed = stage === "closed";
  const firstName = candidate.name.split(" ")[0] || "there";
  const roleTitle = role?.title || "an open role";
  const rank = CANDIDATE_STAGES.findIndex((s) => s.key === stage);
  const current = CANDIDATE_STAGES[rank] || CANDIDATE_STAGES[0];

  const statusUrl = buildCandidateStatusUrl({ candidate, role });
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(statusUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard write can fail in non-secure contexts or when the tab is
      // unfocused. Fall back to selecting the input so the operator can ⌘C.
      const el = document.getElementById("candidate-status-url") as HTMLInputElement | null;
      el?.select();
    }
  }

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-none tracking-tight">Candidate status link</div>
          <div className="text-2xs text-faint mt-1 leading-snug">
            Shareable link the candidate can open from anywhere — no login.
          </div>
        </div>
        <Badge tone="accent">Public</Badge>
      </div>

      {/* Shareable URL + copy affordance. The URL is the primary artifact of
          this panel; the preview below it shows what the candidate will see. */}
      <div className="px-4 pt-3 pb-2 border-b border-border">
        <div className="flex items-stretch gap-2">
          <input
            id="candidate-status-url"
            type="text"
            readOnly
            value={statusUrl}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 min-w-0 px-2.5 py-1.5 bg-bg border border-border rounded-md text-2xs font-mono text-fg/80 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40"
          />
          <Button variant="ghost" size="sm" onClick={copyLink} className="shrink-0">
            {copied ? "Copied" : "Copy"}
          </Button>
          <a
            href={statusUrl}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 inline-flex items-center justify-center px-2.5 py-1.5 text-2xs font-medium text-muted hover:text-fg border border-border rounded-md"
            title="Open in a new tab (logged-out works too)"
          >
            Open
          </a>
        </div>
        <p className="mt-2 text-2xs text-faint leading-relaxed">
          Snapshot of the candidate's current stage. Re-copy after each stage change so
          their next email contains a fresh link.
        </p>
        {stage === "onsite_done" ? (
          <p className="mt-1.5 text-2xs text-accent-2 leading-relaxed">
            Interview stage: this link shows a <span className="font-semibold">Start interview</span> button.
            Share <span className="font-mono">{statusUrl.slice(0, 56)}…</span> with the candidate.
          </p>
        ) : null}
      </div>

      {/* Cream-on-dark preview card — visually offset so the operator reads it
          as "what someone outside sees", not as another section of their own UI. */}
      <div className="p-4">
        <div className="bg-[#FAFAFB] text-[#0F1014] rounded-md border border-border p-4 font-[Inter_Tight,system-ui,sans-serif] leading-relaxed">
          <div className="text-2xs uppercase tracking-widest text-[#5C5E69] flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#5E55D4]" />
            Hiremind
          </div>
          <div className="text-lg font-semibold mt-2 tracking-tight">Hi {firstName} —</div>
          {isClosed ? (
            <>
              <p className="text-xs text-[#5C5E69] mt-1">
                Your application for {roleTitle} has been closed out.
              </p>
              <div className="mt-3 inline-flex items-center gap-1.5 bg-[#ECEAFE] text-[#5E55D4] text-xs font-medium rounded-full px-2.5 py-1">
                <span className="w-1 h-1 rounded-full bg-[#5E55D4]" />
                No longer in pipeline
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-[#5C5E69] mt-1">
                You're in the founder's hiring process for {roleTitle}.
              </p>
              <div className="mt-3 inline-flex items-center gap-1.5 bg-[#ECEAFE] text-[#5E55D4] text-xs font-medium rounded-full px-2.5 py-1">
                <span className="w-1 h-1 rounded-full bg-[#5E55D4]" />
                {current.label}
              </div>
              <div className="mt-2 text-2xs text-[#5C5E69]">{current.hint}</div>

              <div className="mt-3 pt-3 border-t border-[#ECEDF0] flex flex-col gap-1.5">
                {CANDIDATE_STAGES.map((s, i) => {
                  const state =
                    i < rank ? "done" :
                    i === rank ? "active" : "future";
                  return (
                    <div key={s.key} className="flex items-start gap-2.5">
                      <span
                        className={cn(
                          "w-2 h-2 rounded-full border mt-1 shrink-0",
                          state === "done" && "bg-[#5E55D4] border-[#5E55D4]",
                          state === "active" && "bg-white border-[#5E55D4] ring-2 ring-[#ECEAFE]",
                          state === "future" && "bg-white border-[#ECEDF0]",
                        )}
                      />
                      <span
                        className={cn(
                          "text-xs",
                          state === "future" ? "text-[#5C5E69]" : "text-[#0F1014]",
                        )}
                      >
                        {s.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Interviews panel — lists scheduled/done interview rounds and, for AI
 * interviews, exposes a "Paste transcript" affordance.
 *
 * The transcript flow is intentionally manual because Lemma doesn't yet have
 * a public, unauthenticated POST endpoint for the candidate-view to submit
 * back to. Instead:
 *   1. Candidate completes the in-browser interview on `c.apps.lemma.work`.
 *   2. The page renders a `b64u(JSON)` transcript code and prompts them to
 *      email it back to the founder.
 *   3. The founder pastes that code here. We decode it, render the
 *      transcript as markdown, write it to
 *      `/candidates/<id>/interview-<interview_id>.md`, and stash the path on
 *      the interviews row's `interviewer_email` field (the closest thing the
 *      current schema has to a freeform notes pointer — we re-purpose it so
 *      the row carries an "open me" link without a schema migration).
 *
 * When the transcript path is set, we show a "View transcript" link instead
 * of the paste form. The full file content is rendered inline via the
 * existing `DossierView` plumbing (or a thin wrapper if we want different
 * styling later).
 */
function InterviewsPanel({
  candidate,
  interviews,
  onChanged,
}: {
  candidate: Candidate;
  interviews: Interview[];
  onChanged: () => void | Promise<void>;
}) {
  const [pasteFor, setPasteFor] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submitTranscript(interview: Interview) {
    setBusy(true); setError(null); setSuccess(null);
    try {
      const decoded = decodeTranscriptCode(code);
      if (!decoded) {
        throw new Error(
          "That doesn't look like a Hiremind transcript code. Ask the candidate to copy the long code from the bottom of their interview page (between the dashed lines), and paste it here verbatim.",
        );
      }
      // Stamp the proctor signal into the markdown so the backend scorer
      // sees it. The candidate-view v2 sends `proctor_flag_count` alongside
      // the answers; older v1 codes simply omit it (treated as 0).
      const proctorLine = typeof (decoded as { proctor_flag_count?: number }).proctor_flag_count === "number"
        ? `*Proctor flags: ${(decoded as { proctor_flag_count?: number }).proctor_flag_count}*\n\n`
        : "";
      const md = proctorLine + renderTranscriptMarkdown(decoded, candidate.name);
      const path = `/candidates/${candidate.id}/interview-${interview.id}.md`;
      const client = await getClient();
      // Best-effort: persist the rendered markdown so the founder can re-read
      // the full transcript later AND so the backend scorer can read it.
      try {
        await client.files.writeText(path, md);
      } catch {
        // swallow — interview row update below is the source of truth
      }
      // Update the interview row so the AI evaluator function can locate
      // the markdown (it falls back to `interviewer_email` as a pointer
      // when an explicit path isn't passed in).
      await client.records.update<Interview>("interviews", interview.id, {
        status: "done",
        interviewer_email: path,
      });

      // Kick the AI evaluator. We treat this as best-effort: if the
      // function call fails (cold-start, platform hiccup, missing rubric)
      // the transcript is still saved and visible — the founder can retry
      // the eval from the panel below. The success message is tailored
      // to the outcome so the operator knows whether the score landed.
      let scoreLabel = "";
      try {
        const evalResult = await client.functions.run<{
          score: number;
          recommendation: string;
          summary: string;
        }>("evaluate_interview", { interview_id: interview.id });
        scoreLabel = ` Scored ${evalResult.score}/100 · ${evalResult.recommendation.replace(/_/g, " ")}.`;
      } catch (evalErr) {
        // Don't fail the whole flow — surface a soft note instead so the
        // founder can re-run scoring from the row later.
        scoreLabel = " Transcript saved, but the AI scorer didn't reach the pod — click 'Re-score' on the row to retry.";
      }

      // The evaluator function already nudges the candidate's next_action
      // when it succeeds. For the soft-fail case we leave a sensible
      // fallback hint so the kanban card doesn't go stale.
      if (!scoreLabel.startsWith(" Scored")) {
        await client.records.update<Candidate>("candidates", candidate.id, {
          next_action: "Review interview transcript and decide on offer",
        });
      }

      setSuccess("Transcript saved." + scoreLabel);
      setCode("");
      setPasteFor(null);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the transcript.");
    } finally {
      setBusy(false);
    }
  }

  // Re-run the evaluator on an interview that already has a transcript —
  // useful when the first eval call failed, or after the rubric changed.
  async function rescore(interview: Interview) {
    setBusy(true); setError(null); setSuccess(null);
    try {
      const client = await getClient();
      const evalResult = await client.functions.run<{
        score: number;
        recommendation: string;
      }>("evaluate_interview", { interview_id: interview.id });
      setSuccess(
        `Re-scored: ${evalResult.score}/100 · ${evalResult.recommendation.replace(/_/g, " ")}.`,
      );
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't re-score the interview.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
        <div className="text-sm font-semibold leading-none tracking-tight">Interviews</div>
        <Badge tone="muted">{interviews.length}</Badge>
      </div>

      {interviews.length === 0 ? (
        <p className="text-xs text-faint italic px-4 py-5 text-center">None scheduled.</p>
      ) : (
        <ul>
          {interviews.map((i) => {
            const isAi = i.round === "ai_screen";
            const hasTranscript = !!i.interviewer_email;
            // The score column lives on the interviews row, written by the
            // backend `evaluate_interview` function. Treat 0 as "explicitly
            // scored, the candidate did poorly" — not "no score". We hide
            // the badge only when the field is null/undefined.
            const hasScore = typeof i.score === "number" && !Number.isNaN(i.score);
            // Pick a tone for the score chip without inventing a new color:
            // green ≥ 70, accent 50–69, muted 35–49, danger < 35.
            const scoreTone: "success" | "accent" | "muted" | "danger" =
              !hasScore ? "muted"
              : (i.score as number) >= 70 ? "success"
              : (i.score as number) >= 50 ? "accent"
              : (i.score as number) >= 35 ? "muted"
              : "danger";
            return (
              <li key={i.id} className="px-4 py-2.5 border-b border-border last:border-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-fg capitalize flex items-center gap-2">
                      <span>{isAi ? "AI screen" : i.round.replace(/_/g, " ")}</span>
                      {hasScore ? (
                        <Badge tone={scoreTone} dot>
                          {Math.round(i.score as number)}/100
                        </Badge>
                      ) : null}
                    </div>
                    <div className="text-2xs text-faint num">
                      {hasTranscript ? (
                        <a
                          className="underline underline-offset-4 decoration-border hover:decoration-fg text-muted"
                          href="#"
                          onClick={(e) => { e.preventDefault(); alert(`Transcript saved at ${i.interviewer_email}`); }}
                          title={i.interviewer_email || ""}
                        >
                          Transcript saved
                        </a>
                      ) : i.scheduled_at ? (
                        new Date(i.scheduled_at).toLocaleString()
                      ) : (
                        "Awaiting candidate"
                      )}
                    </div>
                  </div>
                  <Badge tone={i.status === "done" ? "success" : i.status === "scheduled" ? "accent" : "muted"} dot>
                    {i.status}
                  </Badge>
                </div>

                {isAi && !hasTranscript ? (
                  <div className="mt-2">
                    {pasteFor === i.id ? (
                      <div className="space-y-2">
                        <textarea
                          value={code}
                          onChange={(e) => setCode(e.target.value)}
                          placeholder="Paste the transcript code the candidate sent…"
                          className="w-full text-2xs font-mono leading-snug bg-bg border border-border rounded-md px-2 py-1.5 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40 min-h-[88px]"
                        />
                        {error ? (
                          <div className="text-2xs text-danger leading-relaxed">{error}</div>
                        ) : null}
                        <div className="flex items-center gap-2">
                          <Button
                            variant="accent"
                            size="sm"
                            onClick={() => submitTranscript(i)}
                            disabled={busy || !code.trim()}
                          >
                            {busy ? <><Spinner size={11} className="mr-1.5" /> Saving + scoring…</> : "Save & score transcript"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { setPasteFor(null); setCode(""); setError(null); }}
                            disabled={busy}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setPasteFor(i.id); setError(null); setSuccess(null); }}
                      >
                        Paste transcript
                      </Button>
                    )}
                  </div>
                ) : null}

                {/* Re-score affordance for AI interviews that already have a
                    transcript on disk. Used after a soft-fail (eval didn't
                    reach the pod the first time) or when the rubric was
                    updated and the founder wants a fresh number. */}
                {isAi && hasTranscript ? (
                  <div className="mt-2 flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => rescore(i)}
                      disabled={busy}
                      title="Re-run the AI evaluator against the saved transcript"
                    >
                      {busy ? <><Spinner size={11} className="mr-1.5" /> Re-scoring…</> : (hasScore ? "Re-score" : "Score with AI")}
                    </Button>
                    {error ? (
                      <span className="text-2xs text-danger leading-relaxed">{error}</span>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {success ? (
        <div className="px-4 py-2 text-2xs text-success bg-success/10 border-t border-border">
          {success}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Inline email editor for the candidate hero. When `candidate.email` is set,
 * shows the address as a click-to-edit chip. When missing, shows a compact
 * "+ Add email" affordance that swaps in an input on click.
 *
 * Required by the outreach send path: `send_outreach` refuses to fire if the
 * candidate has no recipient, which surfaces in the UI as a cryptic
 * "Couldn't send" toast on the Drafts page. Letting the operator add the
 * email right where they're looking at the candidate is the cleanest fix —
 * one save, one re-render, one less mystery.
 */
function EmailField({ candidate, onSaved }: { candidate: Candidate; onSaved: () => void | Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(candidate.email || "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    const trimmed = value.trim();
    setErr(null);
    if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setErr("That doesn't look like an email.");
      return;
    }
    setSaving(true);
    try {
      const client = await getClient();
      await client.records.update("candidates", candidate.id, { email: trimmed || null });
      await onSaved();
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save the email.");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); void save(); }
            if (e.key === "Escape") { setEditing(false); setValue(candidate.email || ""); setErr(null); }
          }}
          placeholder="name@domain.com"
          className="h-7 text-xs font-mono w-[220px]"
          disabled={saving}
        />
        <button
          onClick={() => void save()}
          disabled={saving}
          className="text-2xs text-accent-2 hover:underline underline-offset-4 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          onClick={() => { setEditing(false); setValue(candidate.email || ""); setErr(null); }}
          disabled={saving}
          className="text-2xs text-faint hover:text-fg disabled:opacity-50"
        >
          Cancel
        </button>
        {err ? <span className="text-2xs text-danger ml-1">{err}</span> : null}
      </span>
    );
  }

  if (candidate.email) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="font-mono hover:underline underline-offset-4 decoration-border hover:decoration-fg"
        title="Click to edit"
      >
        {candidate.email}
      </button>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="inline-flex items-center gap-1 text-warning hover:underline underline-offset-4 decoration-warning/60"
      title="Required before any email outreach can send"
    >
      <span aria-hidden>＋</span> Add email
    </button>
  );
}
