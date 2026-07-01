import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { TopBar } from "@/components/layout/TopBar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { Avatar } from "@/components/ui/Avatar";
import { Textarea, Input } from "@/components/ui/Input";
import { getClient } from "@/lib/client";
import { formatRelative } from "@/lib/utils";
import type { Candidate, Message } from "@/lib/types";

export function Drafts() {
  const [drafts, setDrafts] = useState<Message[] | null>(null);
  const [candidatesById, setCandidatesById] = useState<Record<string, Candidate>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, { subject: string; body: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = async () => {
    const client = await getClient();
    const [m, c] = await Promise.all([
      client.records.list<Message>("messages", { filter: { status: "awaiting_approval" }, limit: 100 }),
      client.records.list<Candidate>("candidates", { limit: 500 }),
    ]);
    const sorted = m.items.sort((a, b) => a.created_at.localeCompare(b.created_at));
    setDrafts(sorted);
    setCandidatesById(Object.fromEntries(c.items.map((x) => [x.id, x])));
    if (sorted.length > 0 && !expanded) setExpanded(sorted[0].id);
  };

  useEffect(() => { refresh(); }, []);

  async function approveAndSend(msg: Message) {
    setBusyId(msg.id); setError(null);
    try {
      const client = await getClient();
      const edited = edits[msg.id];
      const subjectChanged = edited && edited.subject !== (msg.subject || "");
      const bodyChanged = edited && edited.body !== msg.body;
      await client.workflows.approveDraft(msg.id, {
        edited_subject: subjectChanged ? edited.subject : undefined,
        edited_body: bodyChanged ? edited.body : undefined,
      });
      await refresh();
    } catch (e: any) {
      setError(`Couldn't send: ${e?.message || String(e)}`);
    } finally { setBusyId(null); }
  }

  async function decline(msg: Message) {
    setBusyId(msg.id); setError(null);
    try {
      const client = await getClient();
      await client.workflows.declineDraft(msg.id, "operator declined in Drafts");
      await refresh();
    } catch (e: any) {
      setError(`Couldn't decline: ${e?.message || String(e)}`);
    } finally { setBusyId(null); }
  }

  return (
    <>
      <TopBar
        eyebrow="Approval gate"
        title="Drafts"
        actions={
          <Badge tone="muted">{drafts?.length ?? 0} waiting</Badge>
        }
      />

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-3xl mx-auto px-7 py-6 space-y-3">
          {error && (
            <div className="rounded-md border border-danger/40 bg-danger-soft text-danger text-xs px-3.5 py-2.5 leading-relaxed">
              {error}
            </div>
          )}
          {drafts === null ? (
            <div className="flex items-center justify-center py-20 text-muted text-sm gap-2">
              <Spinner size={13} /> Loading drafts…
            </div>
          ) : drafts.length === 0 ? (
            <EmptyState
              title="Inbox zero"
              description="Outreach and reply drafts land here. Each comes with full candidate context — dossier, role rubric, conversation history."
              action={<Link to="/" className="text-xs text-accent-2 hover:underline underline-offset-4">Back to Today →</Link>}
            />
          ) : (
            drafts.map((msg) => {
              const candidate = candidatesById[msg.candidate_id];
              const current = edits[msg.id] || { subject: msg.subject || "", body: msg.body };
              const words = current.body.trim().split(/\s+/).filter(Boolean).length;
              const inVoiceRange = words >= 80 && words <= 150;
              const isOpen = expanded === msg.id;
              return (
                <article
                  key={msg.id}
                  className={`bg-surface border rounded-lg overflow-hidden transition-colors duration-150 ${isOpen ? "border-border-strong" : "border-border hover:border-border-strong"}`}
                >
                  <button
                    onClick={() => setExpanded(isOpen ? null : msg.id)}
                    className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar name={candidate?.name || msg.candidate_id} size="sm" />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-fg truncate leading-tight">
                          {candidate ? candidate.name : msg.candidate_id}
                        </div>
                        <div className="text-2xs text-muted num mt-0.5 truncate">
                          {msg.channel} · {msg.created_by || "—"} · {formatRelative(msg.created_at)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted truncate hidden md:inline max-w-[280px]">
                        {msg.subject || msg.body.slice(0, 60) + "…"}
                      </span>
                      <Badge tone="warning" dot>awaiting</Badge>
                    </div>
                  </button>

                  {isOpen ? (
                    <>
                      <div className="px-4 py-3 border-t border-border space-y-3 animate-slide-down">
                        <div>
                          <label className="label block mb-1.5">Subject</label>
                          <Input
                            value={current.subject}
                            onChange={(e) => setEdits((p) => ({ ...p, [msg.id]: { ...current, subject: e.target.value } }))}
                          />
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <label className="label">Body</label>
                            <span className="text-2xs text-faint num">
                              {words} words
                              {inVoiceRange ? <span className="ml-1 text-success">· in voice range</span> : null}
                            </span>
                          </div>
                          <Textarea
                            rows={10}
                            value={current.body}
                            onChange={(e) => setEdits((p) => ({ ...p, [msg.id]: { ...current, body: e.target.value } }))}
                            className="font-mono leading-relaxed"
                          />
                        </div>
                      </div>
                      <footer className="px-4 py-3 border-t border-border flex items-center justify-between gap-2 bg-bg/40">
                        <span className="text-2xs text-faint leading-relaxed max-w-md">
                          {candidate && !candidate.email ? (
                            <span className="text-warning">
                              No email on file for {candidate.name}. Open the candidate and add one — Gmail can't send without a recipient.{" "}
                              <Link to={`/candidates/${candidate.id}`} className="underline underline-offset-4">Open candidate →</Link>
                            </span>
                          ) : (
                            "Your tap sends via Gmail, advances stage, and schedules a follow-up task."
                          )}
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button variant="ghost" size="sm" onClick={() => decline(msg)} disabled={busyId === msg.id}>
                            Decline
                          </Button>
                          <Button
                            variant="accent"
                            size="sm"
                            onClick={() => approveAndSend(msg)}
                            disabled={busyId === msg.id || (candidate && !candidate.email) || false}
                            title={candidate && !candidate.email ? "Add an email on the candidate detail page first — outreach can't send without a recipient." : undefined}
                          >
                            {busyId === msg.id ? (
                              <><Spinner size={11} className="border-white/30 border-t-white mr-1.5" /> Sending…</>
                            ) : "Approve & send"}
                          </Button>
                        </div>
                      </footer>
                    </>
                  ) : null}
                </article>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
