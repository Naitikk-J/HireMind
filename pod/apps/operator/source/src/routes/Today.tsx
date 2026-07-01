import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { TopBar } from "@/components/layout/TopBar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { Avatar } from "@/components/ui/Avatar";
import { getClient } from "@/lib/client";
import { formatRelative, cn } from "@/lib/utils";
import type { Candidate, Interview, Message, Task } from "@/lib/types";

const founderName =
  (import.meta.env.VITE_HIREMIND_FOUNDER_NAME as string | undefined) || "Naitik";

export function Today() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);

  const refresh = async () => {
    const client = await getClient();
    const [c, m, iv, t] = await Promise.all([
      client.records.list<Candidate>("candidates", { limit: 500 }),
      client.records.list<Message>("messages", { limit: 500 }),
      client.records.list<Interview>("interviews", { limit: 200 }),
      client.records.list<Task>("tasks", { limit: 200 }),
    ]);
    setCandidates(c.items);
    setMessages(m.items);
    setInterviews(iv.items);
    setTasks(t.items);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, []);

  const candidateById = useMemo(
    () => Object.fromEntries(candidates.map((c) => [c.id, c])),
    [candidates],
  );

  const drafts = useMemo(
    () => messages.filter((m) => m.status === "awaiting_approval").sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [messages],
  );

  const inboundUnactioned = useMemo(
    () =>
      messages
        .filter((m) => m.direction === "inbound" && m.status !== "ignored")
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 4),
    [messages],
  );

  const overdueOutreach = useMemo(() => {
    // candidates in intro_sent for > 4 days with no reply
    const fourDaysAgo = Date.now() - 4 * 86_400_000;
    return candidates
      .filter((c) => c.status === "active" && c.stage === "intro_sent")
      .filter((c) => {
        const last = c.last_contact ? new Date(c.last_contact).getTime() : 0;
        return last > 0 && last < fourDaysAgo;
      })
      .slice(0, 5);
  }, [candidates]);

  const upcomingInterviews = useMemo(() => {
    const now = Date.now();
    return interviews
      .filter((i) => i.status === "scheduled" && i.scheduled_at && new Date(i.scheduled_at).getTime() > now)
      .sort((a, b) => (a.scheduled_at || "").localeCompare(b.scheduled_at || ""))
      .slice(0, 4);
  }, [interviews]);

  const pendingFeedback = useMemo(
    () => tasks.filter((t) => t.type === "submit_feedback" && t.status === "pending").slice(0, 4),
    [tasks],
  );

  const stats = useMemo(() => {
    const active = candidates.filter((c) => c.status === "active");
    return {
      total: active.length,
      drafts: drafts.length,
      inbound: inboundUnactioned.length,
      overdue: overdueOutreach.length,
      interviewing: active.filter((c) => ["screen_done", "onsite_done"].includes(c.stage)).length,
      offer: active.filter((c) => c.stage === "offer").length,
    };
  }, [candidates, drafts, inboundUnactioned, overdueOutreach]);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 5) return "Late one";
    if (h < 12) return "Morning";
    if (h < 17) return "Afternoon";
    if (h < 21) return "Evening";
    return "Late";
  }, []);

  const dayString = useMemo(
    () => new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }),
    [],
  );

  return (
    <>
      <TopBar
        title="Today"
        subtitle={`${greeting}, ${founderName}. Your hiring loop at a glance.`}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => navigate("/demo?run=digest")}>
              Run weekly digest
            </Button>
            <Button variant="accent" size="sm" onClick={() => navigate("/pipeline?new=1")}>
              + New candidate
            </Button>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-[1200px] mx-auto px-7 py-6">
          {/* Stats strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-7">
            <Stat label="Active" value={stats.total} tone="default" />
            <Stat label="Drafts to approve" value={stats.drafts} tone="warning" />
            <Stat label="Inbound replies" value={stats.inbound} tone="info" />
            <Stat label="Overdue follow-ups" value={stats.overdue} tone="danger" />
            <Stat label="Interviewing" value={stats.interviewing} tone="default" />
            <Stat label="Offer stage" value={stats.offer} tone="success" />
          </div>

          <div className="text-3xs text-faint uppercase tracking-widest mb-3 font-medium">
            {dayString}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20 text-muted text-sm gap-2">
              <Spinner size={13} /> Loading your pipeline…
            </div>
          ) : (
            <div className="grid grid-cols-12 gap-5">
              {/* Left column: action queues */}
              <div className="col-span-12 lg:col-span-8 space-y-5">
                {/* Drafts awaiting approval */}
                <Panel
                  title={`${drafts.length} ${drafts.length === 1 ? "draft" : "drafts"} on your tap`}
                  hint="Nothing leaves the pod without your approval."
                  action={
                    drafts.length > 0 ? (
                      <Link to="/drafts" className="text-xs text-accent-2 hover:underline">Open all →</Link>
                    ) : null
                  }
                  empty={drafts.length === 0 ? "Inbox zero — agents have nothing waiting on you." : undefined}
                >
                  <ul>
                    {drafts.slice(0, 4).map((m) => {
                      const c = candidateById[m.candidate_id];
                      return (
                        <li
                          key={m.id}
                          className="border-b border-border last:border-0 px-3 py-2.5 hover:bg-surface2/60 transition-colors duration-100 cursor-pointer"
                          onClick={() => navigate("/drafts")}
                        >
                          <div className="flex items-center gap-3">
                            <Avatar name={c?.name || m.candidate_id} size="sm" />
                            <div className="min-w-0 flex-1">
                              <div className="text-sm text-fg truncate font-medium leading-tight">
                                {c?.name || m.candidate_id}
                              </div>
                              <div className="text-xs text-muted truncate mt-0.5">
                                {m.subject || m.body.slice(0, 80) + "…"}
                              </div>
                            </div>
                            <Badge tone="warning" dot>awaiting</Badge>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </Panel>

                {/* Inbound replies */}
                <Panel
                  title="Recent inbound"
                  hint="Replies that need triage."
                  action={
                    inboundUnactioned.length > 0 ? (
                      <Link to="/activity" className="text-xs text-accent-2 hover:underline">See all →</Link>
                    ) : null
                  }
                  empty={inboundUnactioned.length === 0 ? "No new replies." : undefined}
                >
                  <ul>
                    {inboundUnactioned.map((m) => {
                      const c = candidateById[m.candidate_id];
                      return (
                        <li
                          key={m.id}
                          className="border-b border-border last:border-0 px-3 py-2.5 hover:bg-surface2/60 transition-colors duration-100 cursor-pointer"
                          onClick={() => c && navigate(`/candidates/${c.id}`)}
                        >
                          <div className="flex items-center gap-3">
                            <Avatar name={c?.name || m.candidate_id} size="sm" />
                            <div className="min-w-0 flex-1">
                              <div className="text-sm text-fg truncate font-medium leading-tight">
                                {c?.name || m.candidate_id}
                              </div>
                              <div className="text-xs text-muted truncate mt-0.5">{m.body.slice(0, 100)}</div>
                            </div>
                            <span className="text-2xs text-faint num shrink-0">{formatRelative(m.created_at)}</span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </Panel>

                {/* Overdue follow-ups */}
                <Panel
                  title="Overdue follow-ups"
                  hint="Sent intros with no reply in 4+ days."
                  empty={overdueOutreach.length === 0 ? "Nothing overdue." : undefined}
                >
                  <ul>
                    {overdueOutreach.map((c) => (
                      <li
                        key={c.id}
                        className="border-b border-border last:border-0 px-3 py-2.5 hover:bg-surface2/60 transition-colors duration-100 cursor-pointer"
                        onClick={() => navigate(`/candidates/${c.id}`)}
                      >
                        <div className="flex items-center gap-3">
                          <Avatar name={c.name} size="sm" />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm text-fg truncate font-medium leading-tight">{c.name}</div>
                            <div className="text-xs text-muted truncate mt-0.5">
                              last contact {formatRelative(c.last_contact)}
                            </div>
                          </div>
                          <Badge tone="danger" dot>follow up</Badge>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Panel>
              </div>

              {/* Right column: glance */}
              <div className="col-span-12 lg:col-span-4 space-y-5">
                <Panel
                  title="Up next"
                  hint="Scheduled interviews."
                  empty={upcomingInterviews.length === 0 ? "Nothing scheduled." : undefined}
                >
                  <ul>
                    {upcomingInterviews.map((iv) => {
                      const c = candidateById[iv.candidate_id];
                      const when = iv.scheduled_at
                        ? new Date(iv.scheduled_at).toLocaleString(undefined, {
                            weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                          })
                        : "—";
                      return (
                        <li key={iv.id} className="border-b border-border last:border-0 px-3 py-2.5">
                          <div className="text-sm text-fg leading-tight font-medium truncate">
                            {c?.name || iv.candidate_id}
                          </div>
                          <div className="text-xs text-muted capitalize mt-0.5">
                            {iv.round.replace(/_/g, " ")} · <span className="num">{when}</span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </Panel>

                <Panel
                  title="Awaiting scorecards"
                  hint="Interviews done; feedback not in."
                  empty={pendingFeedback.length === 0 ? "All scorecards in." : undefined}
                >
                  <ul>
                    {pendingFeedback.map((t) => (
                      <li key={t.id} className="border-b border-border last:border-0 px-3 py-2.5">
                        <div className="text-sm text-fg leading-tight font-medium truncate">{t.title}</div>
                        <div className="text-xs text-muted mt-0.5">due {formatRelative(t.due)}</div>
                      </li>
                    ))}
                  </ul>
                </Panel>

                <div className="bg-surface border border-border rounded-lg p-4">
                  <div className="label mb-2">PRD flows</div>
                  <p className="text-xs text-muted leading-relaxed mb-3">
                    The agent surfaces (WhatsApp, Gmail, Slack) need real connector accounts. Until those are wired,
                    use the simulators to demo every PRD flow end-to-end.
                  </p>
                  <div className="space-y-1.5">
                    <SimLink to="/demo?run=voice"    label="Voice-note intake"   prd="§9.1 Flow A" />
                    <SimLink to="/demo?run=reply"    label="Inbound reply → schedule" prd="§9.2 Flow B" />
                    <SimLink to="/demo?run=feedback" label="Interview feedback"  prd="§9.3 Flow C" />
                    <SimLink to="/demo?run=digest"   label="Monday digest"       prd="§9.4 Flow D" />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Stat({
  label, value, tone,
}: {
  label: string;
  value: number;
  tone: "default" | "warning" | "info" | "danger" | "success";
}) {
  const tint: Record<typeof tone, string> = {
    default: "text-fg",
    warning: "text-warning",
    info:    "text-info",
    danger:  "text-danger",
    success: "text-success",
  } as never;
  return (
    <div className="bg-surface border border-border rounded-md px-3 py-2.5">
      <div className="text-3xs text-faint uppercase tracking-widest font-medium">{label}</div>
      <div className={cn("text-xl font-semibold num mt-1 leading-none tracking-tight", tint[tone])}>
        {value}
      </div>
    </div>
  );
}

function Panel({
  title,
  hint,
  action,
  empty,
  children,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  empty?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-surface border border-border rounded-lg overflow-hidden">
      <header className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-fg leading-none tracking-tight">{title}</div>
          {hint ? <div className="text-2xs text-faint mt-1.5">{hint}</div> : null}
        </div>
        {action}
      </header>
      {empty ? (
        <div className="px-4 py-6 text-xs text-faint text-center">{empty}</div>
      ) : (
        children
      )}
    </section>
  );
}

function SimLink({ to, label, prd }: { to: string; label: string; prd: string }) {
  return (
    <Link
      to={to}
      className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-surface2 transition-colors text-xs"
    >
      <span className="text-fg/90">{label}</span>
      <span className="text-3xs text-faint font-mono">{prd}</span>
    </Link>
  );
}
