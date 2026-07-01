import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { TopBar } from "@/components/layout/TopBar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { Avatar } from "@/components/ui/Avatar";
import { getClient } from "@/lib/client";
import { cn, formatRelative } from "@/lib/utils";
import type { Candidate, Interview, Message } from "@/lib/types";

type Tab = "voice" | "reply" | "feedback" | "digest";

const TABS: Array<{ id: Tab; label: string; prd: string; surface: string }> = [
  { id: "voice",    label: "Voice intake",        prd: "§9.1 Flow A", surface: "WhatsApp" },
  { id: "reply",    label: "Inbound reply",       prd: "§9.2 Flow B", surface: "Gmail" },
  { id: "feedback", label: "Interview feedback",  prd: "§9.3 Flow C", surface: "Slack" },
  { id: "digest",   label: "Monday digest",       prd: "§9.4 Flow D", surface: "WhatsApp" },
];

export function Demo() {
  const [params, setParams] = useSearchParams();
  const initial = (params.get("run") as Tab | null) || "voice";
  const [tab, setTab] = useState<Tab>(TABS.find((t) => t.id === initial)?.id || "voice");

  useEffect(() => {
    if (params.get("run")) {
      params.delete("run");
      setParams(params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <TopBar
        eyebrow="Operations"
        title="Simulators"
        subtitle="Run every PRD demo flow end-to-end. These stand in for WhatsApp / Gmail / Slack until real connectors are wired."
      />

      <div className="px-7 pt-3 pb-2 flex items-center gap-1.5 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "inline-flex items-center gap-2 rounded-md h-8 px-3 text-xs",
              "transition-colors duration-100 ease-soft focus-ring",
              tab === t.id
                ? "bg-fg text-bg"
                : "bg-surface border border-border text-muted hover:text-fg hover:border-border-strong",
            )}
          >
            <span className="font-medium tracking-tight">{t.label}</span>
            <span className={cn("text-3xs font-mono", tab === t.id ? "text-bg/65" : "text-faint")}>{t.prd}</span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-3xl mx-auto px-7 py-6">
          {tab === "voice"    ? <VoiceIntakePanel /> : null}
          {tab === "reply"    ? <ReplyPanel /> : null}
          {tab === "feedback" ? <FeedbackPanel /> : null}
          {tab === "digest"   ? <DigestPanel /> : null}
        </div>
      </div>
    </>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   Flow A — Voice-note intake (WhatsApp simulator)
   ────────────────────────────────────────────────────────────────────────── */
function VoiceIntakePanel() {
  const SAMPLES = [
    "Aarti Mehta from Microsoft, AI PM role, referred by Rohit Sharma. She's been at Copilot for two years, shipped the in-product agent stack. I should reach out today.",
    "Got Vikram Iyer on the line — ex-founder, two acquisitions, currently advising a few seed-stage shops. Was thinking about him for the AI PM slot.",
    "Quick one for the founding design engineer role: Devika Nair, used to be at Linear, now consulting. Worth a chat.",
  ];
  const [transcript, setTranscript] = useState(SAMPLES[0]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ runId?: string; error?: string } | null>(null);

  async function run() {
    setBusy(true); setResult(null);
    try {
      const client = await getClient();
      const run = await client.workflows.run("intake", {
        data: { raw: transcript, channel_hint: "whatsapp_voice" },
      });
      setResult({ runId: run?.run_id });
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : "Unknown error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PRDCallout
        flow="§9.1 Flow A — Voice-note sourcing"
        body="Founder, in an Uber, sends a WhatsApp voice note. Lemma's voice transcription would normally feed the intake workflow. Here we paste the transcript directly to simulate that surface."
      />
      <SimSurface tag="WhatsApp" me="Naitik">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            {SAMPLES.map((s, i) => (
              <button
                key={i}
                onClick={() => setTranscript(s)}
                className="text-2xs text-muted hover:text-fg bg-surface2 border border-border rounded-md px-2 py-1 transition-colors"
              >
                Sample {i + 1}
              </button>
            ))}
          </div>
          <Textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            rows={6}
            className="font-mono leading-relaxed"
            placeholder="Paste a WhatsApp voice-note transcript…"
          />
          <div className="flex items-center justify-between">
            <span className="text-2xs text-faint">
              Runs the <code className="font-mono text-fg/80">intake</code> workflow → triage agent → dossier.
            </span>
            <Button variant="accent" size="sm" onClick={run} disabled={busy || !transcript.trim()}>
              {busy ? <><Spinner size={11} className="border-white/30 border-t-white mr-1.5" />Running intake…</> : "Trigger intake"}
            </Button>
          </div>
        </div>
      </SimSurface>

      {result ? <ResultBanner result={result} kind="intake" /> : null}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   Flow B — Inbound reply simulator (Gmail)
   ────────────────────────────────────────────────────────────────────────── */
function ReplyPanel() {
  const [candidateId, setCandidateId] = useState<string>("");
  const [body, setBody] = useState(
    "Hey Naitik — sounds interesting. Happy to chat. Friday afternoon works on my end. Best, A",
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ messageId?: string; error?: string } | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);

  useEffect(() => {
    (async () => {
      const client = await getClient();
      const c = await client.records.list<Candidate>("candidates", { limit: 100 });
      const eligible = c.items.filter((x) => ["intro_sent", "replied", "sourced"].includes(x.stage));
      setCandidates(eligible);
      if (eligible[0]) setCandidateId(eligible[0].id);
    })();
  }, []);

  async function run() {
    if (!candidateId) return;
    setBusy(true); setResult(null);
    try {
      const client = await getClient();
      // Insert an inbound message directly. The reply_handler workflow is triggered on table event.
      const created = await client.records.create<Message>("messages", {
        candidate_id: candidateId,
        direction: "inbound",
        channel: "email",
        body,
        subject: "Re: Hiremind",
        status: "received",
        created_by: "demo:reply_simulator",
        thread_ref: `demo-${Date.now()}`,
      });
      setResult({ messageId: created?.id });
      // Also advance the candidate stage so it lands in "replied"
      await client.records.update("candidates", candidateId, {
        stage: "replied",
        last_contact: new Date().toISOString(),
        next_action: "Reply received — propose scheduling slots",
      });
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : "Unknown error" });
    } finally {
      setBusy(false);
    }
  }

  const selected = candidates.find((c) => c.id === candidateId);

  return (
    <div className="space-y-4">
      <PRDCallout
        flow="§9.2 Flow B — Inbound reply → scheduled interview"
        body="A candidate replies to your outreach. Reply handler classifies as 'interest', scheduler proposes 3 slots, founder approves, calendar invite sent."
      />
      <SimSurface tag="Gmail" me="Inbox">
        <div className="space-y-3">
          <div>
            <label className="label block mb-1.5">From</label>
            <select
              value={candidateId}
              onChange={(e) => setCandidateId(e.target.value)}
              className="w-full h-8 rounded-md border border-border bg-surface2 px-2.5 text-sm text-fg focus:outline-none focus:border-accent/60 focus:shadow-focus"
            >
              <option value="">Pick a candidate…</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>{c.name} {c.email ? `<${c.email}>` : ""}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label block mb-1.5">Reply body</label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              className="font-mono leading-relaxed"
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-2xs text-faint">
              Writes an inbound <code className="font-mono">messages</code> row → triggers <code className="font-mono">reply_handler</code>.
            </span>
            <Button variant="accent" size="sm" onClick={run} disabled={busy || !candidateId || !body.trim()}>
              {busy ? <><Spinner size={11} className="border-white/30 border-t-white mr-1.5" />Sending inbound…</> : "Send as inbound reply"}
            </Button>
          </div>
        </div>
      </SimSurface>

      {result ? (
        <ResultBanner
          result={result}
          kind="reply"
          extra={selected ? <>Stage advanced to <Badge tone="success" dot>replied</Badge> for <strong className="text-fg">{selected.name}</strong>. Open Today to see it.</> : null}
        />
      ) : null}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   Flow C — Interview feedback (Slack)
   ────────────────────────────────────────────────────────────────────────── */
function FeedbackPanel() {
  const [interviewId, setInterviewId] = useState<string>("");
  const [interviews, setInterviews] = useState<Array<Interview & { candidateName?: string }>>([]);
  const [strengths, setStrengths] = useState("Clear thinker. Spoke about her shipped agent stack with crisp owner-language. Knew the rough edges as well as the wins.");
  const [concerns, setConcerns] = useState("Hasn't lived inside the founder-stage chaos — coming from Microsoft. Wants to see if she can hold the bar without a 30-person org around her.");
  const [recommendation, setRecommendation] = useState<"strong_hire" | "hire" | "no_hire" | "strong_no_hire">("hire");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ scorecardId?: string; error?: string } | null>(null);

  useEffect(() => {
    (async () => {
      const client = await getClient();
      const [iv, c] = await Promise.all([
        client.records.list<Interview>("interviews", { limit: 50 }),
        client.records.list<Candidate>("candidates", { limit: 200 }),
      ]);
      const byId = Object.fromEntries(c.items.map((x) => [x.id, x.name]));
      const list = iv.items
        .filter((x) => x.status === "done" || x.status === "scheduled")
        .map((x) => ({ ...x, candidateName: byId[x.candidate_id] }));
      setInterviews(list);
      if (list[0]) setInterviewId(list[0].id);
    })();
  }, []);

  async function run() {
    if (!interviewId) return;
    setBusy(true); setResult(null);
    try {
      const client = await getClient();
      // Mark the interview as done if it isn't already
      await client.records.update("interviews", interviewId, { status: "done" });
      // Use the record_scorecard function directly (skip the Slack DM half)
      // Write a scorecard row directly (mirrors what the Slack form submission would do).
      const created = await client.records.create<Record<string, unknown> & { id?: string }>(
        "scorecards",
        {
          interview_id: interviewId,
          strengths,
          concerns,
          recommendation,
          notes: "Submitted via Hiremind operator simulator.",
          submitted_at: new Date().toISOString(),
          submitted_by: "demo:slack_simulator",
        },
      );
      setResult({ scorecardId: created?.id });
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : "Unknown error" });
    } finally {
      setBusy(false);
    }
  }

  const selected = interviews.find((i) => i.id === interviewId);

  return (
    <div className="space-y-4">
      <PRDCallout
        flow="§9.3 Flow C — Post-interview feedback"
        body="30 minutes after an interview flips to done, the feedback agent sends a Slack DM to the interviewer with a 4-field form. Here we render that form directly."
      />
      <SimSurface tag="Slack" me="Hiremind app">
        <div className="space-y-3">
          <div>
            <label className="label block mb-1.5">Interview</label>
            <select
              value={interviewId}
              onChange={(e) => setInterviewId(e.target.value)}
              className="w-full h-8 rounded-md border border-border bg-surface2 px-2.5 text-sm text-fg focus:outline-none focus:border-accent/60 focus:shadow-focus"
            >
              <option value="">Pick an interview…</option>
              {interviews.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.candidateName || i.candidate_id} — {i.round.replace(/_/g, " ")} ({i.status})
                </option>
              ))}
            </select>
          </div>
          {selected ? (
            <div className="text-2xs text-faint border border-dashed border-border rounded-md px-3 py-2 leading-relaxed">
              <span className="text-fg/80">Quick scorecard for {selected.candidateName} — {selected.round.replace(/_/g, " ")}.</span>{" "}
              Slack would show this as a DM with a form. Fill it out and submit.
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label block mb-1.5">Strengths</label>
              <Textarea value={strengths} onChange={(e) => setStrengths(e.target.value)} rows={4} />
            </div>
            <div>
              <label className="label block mb-1.5">Concerns</label>
              <Textarea value={concerns} onChange={(e) => setConcerns(e.target.value)} rows={4} />
            </div>
          </div>
          <div>
            <label className="label block mb-1.5">Recommendation</label>
            <div className="flex items-center gap-1.5">
              {(["strong_hire", "hire", "no_hire", "strong_no_hire"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setRecommendation(r)}
                  className={cn(
                    "h-7 px-2.5 rounded-md text-xs border transition-colors",
                    recommendation === r
                      ? r === "strong_hire" || r === "hire"
                        ? "bg-success-soft border-success/40 text-success"
                        : "bg-danger-soft border-danger/40 text-danger"
                      : "bg-surface border-border text-muted hover:text-fg hover:border-border-strong",
                  )}
                >
                  {r.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between pt-1">
            <span className="text-2xs text-faint">Writes a <code className="font-mono">scorecards</code> row + notifies founder.</span>
            <Button variant="accent" size="sm" onClick={run} disabled={busy || !interviewId}>
              {busy ? <><Spinner size={11} className="border-white/30 border-t-white mr-1.5" />Submitting…</> : "Submit scorecard"}
            </Button>
          </div>
        </div>
      </SimSurface>

      {result ? <ResultBanner result={result} kind="feedback" /> : null}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   Flow D — Monday digest (WhatsApp)
   ────────────────────────────────────────────────────────────────────────── */
function DigestPanel() {
  const [busy, setBusy] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { runLocalCompose().catch(() => {}); /* eslint-disable-next-line */ }, []);

  async function runLocalCompose() {
    setBusy(true); setError(null);
    try {
      const client = await getClient();
      const [c, m, iv, t] = await Promise.all([
        client.records.list<Candidate>("candidates", { limit: 500 }),
        client.records.list("messages", { limit: 500 }) as Promise<{ items: any[] }>,
        client.records.list("interviews", { limit: 200 }) as Promise<{ items: any[] }>,
        client.records.list("tasks", { limit: 200 }) as Promise<{ items: any[] }>,
      ]);
      setContent(composeDigest(c.items, m.items, iv.items, t.items));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PRDCallout
        flow="§9.4 Flow D — Monday morning digest"
        body="Mon 9am & Fri 9am, cron triggers the digest workflow. The digest_composer agent rolls up pipeline state into a single WhatsApp message — max 8 bullets, prioritized: overdue → pending decisions → wins → coming up."
      />
      <SimSurface tag="WhatsApp" me="Hiremind → Naitik">
        {busy && !content ? (
          <div className="flex items-center gap-2 text-muted text-sm py-6 justify-center">
            <Spinner size={13} /> Composing digest from live pipeline state…
          </div>
        ) : error ? (
          <div className="text-xs text-danger">{error}</div>
        ) : content ? (
          <div className="bg-bg/40 rounded-md p-4 border border-border">
            <pre className="text-sm text-fg/95 leading-relaxed whitespace-pre-wrap font-sans">{content}</pre>
          </div>
        ) : null}
        <div className="flex items-center justify-between mt-3">
          <span className="text-2xs text-faint">Reads all tables, applies PRD §7.5 output contract.</span>
          <Button variant="secondary" size="sm" onClick={runLocalCompose} disabled={busy}>
            {busy ? <><Spinner size={11} className="mr-1.5" />Refreshing…</> : "Recompose now"}
          </Button>
        </div>
      </SimSurface>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   Shared bits
   ────────────────────────────────────────────────────────────────────────── */

function PRDCallout({ flow, body }: { flow: string; body: string }) {
  return (
    <div className="bg-accent-soft/40 border border-accent-line rounded-md px-4 py-3 flex items-start gap-3">
      <span className="text-2xs font-mono uppercase tracking-widest text-accent-2 shrink-0 mt-0.5">PRD</span>
      <div className="min-w-0">
        <div className="text-sm font-medium text-fg leading-tight tracking-tight">{flow}</div>
        <p className="text-xs text-muted mt-1 leading-relaxed text-pretty">{body}</p>
      </div>
    </div>
  );
}

function SimSurface({ tag, me, children }: { tag: string; me: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-border flex items-center justify-between bg-bg/40">
        <div className="flex items-center gap-2.5">
          <Avatar name={tag} size="xs" />
          <span className="text-xs font-medium text-fg">{tag}</span>
          <span className="text-2xs text-faint">·</span>
          <span className="text-2xs text-muted">{me}</span>
        </div>
        <Badge tone="muted">Simulator</Badge>
      </header>
      <div className="p-4">{children}</div>
    </div>
  );
}

function ResultBanner({
  result, kind, extra,
}: {
  result: { runId?: string; messageId?: string; scorecardId?: string; error?: string };
  kind: "intake" | "reply" | "feedback";
  extra?: React.ReactNode;
}) {
  if (result.error) {
    return (
      <div className="rounded-md border border-danger/40 bg-danger-soft text-danger text-xs px-3.5 py-2.5 leading-relaxed">
        {result.error}
      </div>
    );
  }
  const labels: Record<typeof kind, string> = {
    intake: "Intake workflow started — candidate will appear in Today within a few seconds.",
    reply: "Inbound reply written.",
    feedback: "Scorecard written.",
  } as never;
  const id = result.runId || result.messageId || result.scorecardId || "";
  return (
    <div className="rounded-md border border-success/40 bg-success-soft text-success px-3.5 py-3 text-xs leading-relaxed">
      <div className="flex items-start gap-2">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-success shrink-0 mt-0.5">
          <path d="m3.5 8 3 3 6-6" />
        </svg>
        <div className="text-success">
          <div className="font-medium">{labels[kind]}</div>
          {extra ? <div className="text-fg/85 mt-1">{extra}</div> : null}
          {id ? <div className="font-mono text-3xs text-success/70 mt-1">{id}</div> : null}
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   Local digest composer — deterministic, matches PRD §7.5 output contract.
   ────────────────────────────────────────────────────────────────────────── */
function composeDigest(
  candidates: Candidate[],
  messages: Array<{ status: string; direction: string; created_at: string; candidate_id: string }>,
  interviews: Array<{ status: string; scheduled_at?: string | null; candidate_id: string; round: string }>,
  tasks: Array<{ status: string; type: string; title: string }>,
): string {
  const candById = Object.fromEntries(candidates.map((c) => [c.id, c]));
  const active = candidates.filter((c) => c.status === "active");
  const drafts = messages.filter((m) => m.status === "awaiting_approval");
  const inbound = messages.filter((m) => m.direction === "inbound" && m.status !== "ignored");
  const fourDaysAgo = Date.now() - 4 * 86_400_000;
  const overdue = active.filter((c) => c.stage === "intro_sent" && c.last_contact && new Date(c.last_contact).getTime() < fourDaysAgo);
  const offer = active.filter((c) => c.stage === "offer");
  const upcoming = interviews
    .filter((i) => i.status === "scheduled" && i.scheduled_at && new Date(i.scheduled_at).getTime() > Date.now())
    .sort((a, b) => (a.scheduled_at || "").localeCompare(b.scheduled_at || ""))
    .slice(0, 2);
  const pendingFb = tasks.filter((t) => t.type === "submit_feedback" && t.status === "pending");

  const bullets: string[] = [];
  if (drafts.length > 0)  bullets.push(`${drafts.length} draft${drafts.length > 1 ? "s" : ""} on your tap (open Drafts)`);
  if (inbound.length > 0) bullets.push(`${inbound.length} inbound repl${inbound.length > 1 ? "ies" : "y"} need triage`);
  if (overdue.length > 0) bullets.push(`${overdue.length} candidate${overdue.length > 1 ? "s" : ""} overdue for follow-up`);
  if (pendingFb.length > 0) bullets.push(`${pendingFb.length} scorecard${pendingFb.length > 1 ? "s" : ""} not in yet`);
  if (offer.length > 0)   bullets.push(`Decision pending: ${offer.slice(0, 2).map((c) => c.name).join(", ")} at offer stage`);
  upcoming.forEach((iv) => {
    const c = candById[iv.candidate_id];
    if (!c) return;
    const when = iv.scheduled_at ? new Date(iv.scheduled_at).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "—";
    bullets.push(`${iv.round.replace(/_/g, " ")} with ${c.name} — ${when}`);
  });
  if (bullets.length === 0) bullets.push("Quiet week. No urgent taps needed.");

  const day = new Date().toLocaleDateString(undefined, { weekday: "long" });
  return [
    `📊 Hiremind — ${day}`,
    ...bullets.slice(0, 8).map((b) => `• ${b}`),
    "",
    `${active.length} active across the pipeline · tap to open`,
  ].join("\n");
}

// keep import side-effects minimal
void formatRelative;
