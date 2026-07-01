import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { TopBar } from "@/components/layout/TopBar";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { getClient } from "@/lib/client";
import { formatRelative, cn } from "@/lib/utils";
import type { Candidate, Interview, Message } from "@/lib/types";

type EventKind = "candidate_added" | "message_sent" | "message_received" | "interview_done";

type Event =
  | { kind: "candidate_added"; at: string; candidate: Candidate }
  | { kind: "message_sent"; at: string; candidate?: Candidate; message: Message }
  | { kind: "message_received"; at: string; candidate?: Candidate; message: Message }
  | { kind: "interview_done"; at: string; candidate?: Candidate; interview: Interview };

const FILTER_LABELS: Record<EventKind | "all", string> = {
  all: "All",
  candidate_added: "Added",
  message_sent: "Sent",
  message_received: "Received",
  interview_done: "Interviews",
};

export function Activity() {
  const [loading, setLoading] = useState(true);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [filter, setFilter] = useState<EventKind | "all">("all");

  useEffect(() => {
    (async () => {
      const client = await getClient();
      const [c, m, iv] = await Promise.all([
        client.records.list<Candidate>("candidates", { limit: 500 }),
        client.records.list<Message>("messages", { limit: 500 }),
        client.records.list<Interview>("interviews", { limit: 200 }),
      ]);
      setCandidates(c.items);
      setMessages(m.items);
      setInterviews(iv.items);
      setLoading(false);
    })();
  }, []);

  const events = useMemo<Event[]>(() => {
    const byId = Object.fromEntries(candidates.map((c) => [c.id, c]));
    const list: Event[] = [];
    candidates.forEach((c) => list.push({ kind: "candidate_added", at: c.created_at, candidate: c }));
    messages.forEach((m) => {
      const at = m.sent_at || m.created_at;
      if (m.direction === "outbound" && m.status === "sent") {
        list.push({ kind: "message_sent", at, candidate: byId[m.candidate_id], message: m });
      } else if (m.direction === "inbound") {
        list.push({ kind: "message_received", at, candidate: byId[m.candidate_id], message: m });
      }
    });
    interviews.filter((i) => i.status === "done").forEach((i) => {
      list.push({ kind: "interview_done", at: i.scheduled_at || new Date().toISOString(), candidate: byId[i.candidate_id], interview: i });
    });
    list.sort((a, b) => b.at.localeCompare(a.at));
    return list.slice(0, 100);
  }, [candidates, messages, interviews]);

  const filtered = useMemo(
    () => filter === "all" ? events : events.filter((e) => e.kind === filter),
    [events, filter],
  );

  return (
    <>
      <TopBar
        eyebrow="Operations"
        title="Activity"
        subtitle="Every candidate added, every outbound sent, every reply received. The audit trail for the whole hiring loop."
      />

      <div className="px-7 pt-3 pb-2 flex items-center gap-1.5 flex-wrap">
        {(["all", "candidate_added", "message_sent", "message_received", "interview_done"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md h-7 px-2.5 text-xs",
              "transition-colors duration-100 ease-soft focus-ring",
              filter === k
                ? "bg-fg text-bg"
                : "bg-surface border border-border text-muted hover:text-fg hover:border-border-strong",
            )}
          >
            <span className="font-medium tracking-tight">{FILTER_LABELS[k]}</span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-3xl mx-auto px-7 py-5">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-muted text-sm gap-2">
              <Spinner size={13} /> Loading…
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState title="Quiet pod" description="Events will appear here in real time." />
          ) : (
            <ol className="bg-surface border border-border rounded-lg overflow-hidden">
              {filtered.map((e, i) => (
                <li
                  key={i}
                  className="px-4 py-2.5 border-b border-border last:border-0 flex items-center gap-3 hover:bg-surface2 transition-colors"
                >
                  <Marker kind={e.kind} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-fg leading-tight">{renderLabel(e)}</div>
                    {"message" in e && e.message.subject ? (
                      <div className="text-xs text-muted truncate mt-1">{e.message.subject}</div>
                    ) : null}
                  </div>
                  <span className="text-2xs text-faint num shrink-0">{formatRelative(e.at)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </>
  );
}

function renderLabel(e: Event) {
  const name = "candidate" in e && e.candidate
    ? <Link to={`/candidates/${e.candidate.id}`} className="font-medium hover:underline underline-offset-4">{e.candidate.name}</Link>
    : <span className="text-faint">(unknown)</span>;
  switch (e.kind) {
    case "candidate_added":   return <>Added {name} <span className="text-muted">to the pipeline</span></>;
    case "message_sent":      return <>Sent outbound to {name}</>;
    case "message_received":  return <>Received reply from {name}</>;
    case "interview_done":    return <>{name} <span className="text-muted">finished</span> {e.interview.round.replace(/_/g, " ")}</>;
  }
}

function Marker({ kind }: { kind: EventKind }) {
  const tone =
    kind === "candidate_added"  ? "bg-accent-soft text-accent-2 border-accent-line" :
    kind === "message_sent"     ? "bg-subtle text-muted border-border" :
    kind === "message_received" ? "bg-success-soft text-success border-success/30" :
                                  "bg-warning-soft text-warning border-warning/30";
  return (
    <span className={cn(
      "h-5 w-5 shrink-0 rounded-full flex items-center justify-center border",
      tone,
    )}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
    </span>
  );
}
