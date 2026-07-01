import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { ScheduleScreenModal } from "@/components/ScheduleScreenModal";
import { cn } from "@/lib/utils";
import { getClient } from "@/lib/client";
import type { Candidate, OutreachIntent, Stage } from "@/lib/types";

/**
 * Stage-aware action panel on the candidate detail page.
 *
 * The kanban is a state machine: each column allows a specific set of
 * transitions. Rather than expose a single "Draft outreach" button that
 * silently does the wrong thing for the current stage, we render *only* the
 * actions that make sense right now and route each one through either:
 *   - `records.update("candidates", …)` for pure stage transitions
 *   - `workflows.run("outreach", …)` with an `intent` for drafted emails
 *
 * Wiring intent ➝ stage transitions lives server-side in `send_outreach`,
 * so the founder pressing "Draft offer letter" here ultimately lands the
 * candidate in `offer` only after the email is approved and sent — never
 * before. Front-end can't skip approval.
 */
export function StageActions({
  candidate,
  onChanged,
}: {
  candidate: Candidate;
  onChanged: () => void | Promise<void>;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Schedule-screen modal — only relevant from the `replied` stage but
  // mounted here so its state survives the dropdown closing.
  const [schedulingOpen, setSchedulingOpen] = useState(false);

  async function transition(updates: { stage?: Stage; status?: Candidate["status"]; next_action?: string }, opts?: { successMsg?: string; busyKey?: string }) {
    setBusy(opts?.busyKey || "transition");
    setErr(null);
    setSuccess(null);
    try {
      const client = await getClient();
      await client.records.update("candidates", candidate.id, updates);
      // Side-effect: when the operator moves the candidate INTO the
      // "Interview" stage (wire enum still `onsite_done`), we auto-create an
      // interviews row scoped to round=ai_screen so the candidate's public
      // status page can surface a Start Interview button gated by that row
      // existing. We do it best-effort — a failure here shouldn't block the
      // stage transition itself, since the operator can re-create the
      // interview row manually if needed.
      if (updates.stage === "onsite_done") {
        try {
          await client.records.create("interviews", {
            candidate_id: candidate.id,
            round: "ai_screen",
            status: "scheduled",
          });
        } catch {
          // swallow — the stage move already succeeded, surface only if
          // the operator pokes at the interviews panel and sees nothing
        }
      }
      await onChanged();
      if (opts?.successMsg) {
        setSuccess(opts.successMsg);
        setTimeout(() => setSuccess(null), 5000);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't update the candidate.");
    } finally {
      setBusy(null);
    }
  }

  async function startOutreach(intent: OutreachIntent, busyKey: string) {
    if (!candidate.email) {
      setErr("No email on file for this candidate. Add one above (\"+ Add email\") before drafting outreach — Gmail can't send to a missing recipient.");
      return;
    }
    setBusy(busyKey);
    setErr(null);
    setSuccess(null);
    try {
      const client = await getClient();
      await client.workflows.run("outreach", {
        data: { candidate_id: candidate.id, channel: "email", intent },
      });
      navigate("/drafts");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't kick off outreach.");
    } finally {
      setBusy(null);
    }
  }

  const stage = candidate.stage as Stage;
  const isBusy = (key: string) => busy === key;
  const noEmail = !candidate.email;
  // Tooltip used by every button whose action ends in a Gmail send — keeps
  // the message consistent and points the founder at the inline email field
  // on the candidate hero, where the fix lives in one click.
  const noEmailTip = "Add an email on the candidate card above before drafting — outreach can't send without a recipient.";

  // Each branch renders the buttons that move this stage forward. We keep the
  // markup repetitive (instead of data-driven) on purpose — every stage has
  // slightly different language, defaults, and intents, and matching the
  // user's mental model beats DRY here.
  const content = (() => {
    switch (stage) {
      case "sourced":
        return (
          <>
            <Header
              title="Sourced"
              subtitle="Read the dossier. If they're worth pursuing, mark Reviewed — that unlocks the intro outreach. Otherwise reject."
            />
            <Row>
              <Button
                variant="accent"
                size="sm"
                onClick={() => transition(
                  { stage: "reviewed", next_action: "Draft intro outreach" },
                  { successMsg: "Moved to Reviewed", busyKey: "reviewed" },
                )}
                disabled={!!busy}
              >
                {isBusy("reviewed") ? <Spinner size={11} className="mr-1.5" /> : null}
                Mark Reviewed
              </Button>
              <RejectButton candidate={candidate} disabled={!!busy} onTransition={transition} variant="ghost" />
            </Row>
          </>
        );

      case "reviewed":
        return (
          <>
            <Header
              title="Reviewed"
              subtitle="Ready for first-touch. Draft outreach uses the founder voice + role pitch; you'll review and approve before anything sends."
            />
            <Row>
              <Button
                variant="accent"
                size="sm"
                onClick={() => startOutreach("intro", "intro")}
                disabled={!!busy || noEmail}
                title={noEmail ? noEmailTip : undefined}
              >
                {isBusy("intro") ? <Spinner size={11} className="border-white/30 border-t-white mr-1.5" /> : null}
                Draft intro outreach
              </Button>
              <RejectButton candidate={candidate} disabled={!!busy} onTransition={transition} variant="ghost" />
            </Row>
          </>
        );

      case "intro_sent":
        return (
          <>
            <Header
              title="Intro sent"
              subtitle="Reply detection runs every 2 minutes — when they reply, this card moves to Replied automatically. If a reply came in via another channel, you can advance it manually."
            />
            <Row>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => transition(
                  { stage: "replied", next_action: "Decide next: send screening request or pass" },
                  { successMsg: "Marked as replied", busyKey: "replied" },
                )}
                disabled={!!busy}
              >
                {isBusy("replied") ? <Spinner size={11} className="mr-1.5" /> : null}
                Mark as Replied (manual)
              </Button>
              <RejectButton candidate={candidate} disabled={!!busy} onTransition={transition} variant="ghost" />
            </Row>
          </>
        );

      case "replied":
        return (
          <>
            <Header
              title="Replied"
              subtitle="They're in the conversation. Book a screen (auto-creates a Meet invite), send a screening request, or skip straight to a decision."
            />
            <Row>
              <Button
                variant="accent"
                size="sm"
                onClick={() => setSchedulingOpen(true)}
                disabled={!!busy || noEmail}
                title={noEmail ? noEmailTip : "Pulls your Google Calendar free-busy, proposes 3 slots, creates a real Calendar event with a Meet link and sends the candidate an invite."}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5">
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <path d="M16 2v4M8 2v4M3 10h18" />
                </svg>
                Book screen + Meet
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => startOutreach("screening_request", "screening_request")}
                disabled={!!busy || noEmail}
                title={noEmail ? noEmailTip : undefined}
              >
                {isBusy("screening_request") ? <Spinner size={11} className="mr-1.5" /> : null}
                Draft screening request
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => transition(
                  { stage: "screen_done", next_action: "Decide: onsite or jump straight to offer" },
                  { successMsg: "Screening marked complete", busyKey: "screen_done" },
                )}
                disabled={!!busy}
              >
                {isBusy("screen_done") ? <Spinner size={11} className="mr-1.5" /> : null}
                Screening complete
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => transition(
                  { stage: "closed", status: "declined", next_action: "Screening rejected" },
                  { successMsg: "Moved to Rejected", busyKey: "screen_rej" },
                )}
                disabled={!!busy}
                className="text-danger hover:text-danger"
              >
                {isBusy("screen_rej") ? <Spinner size={11} className="mr-1.5" /> : null}
                Screening rejected
              </Button>
            </Row>
          </>
        );

      case "screen_done":
        return (
          <>
            <Header
              title="Screen done"
              subtitle="Send them through the AI interview to capture role-fit signal, or skip straight to an offer if you already have enough."
            />
            <Row>
              <Button
                variant="accent"
                size="sm"
                onClick={() => transition(
                  { stage: "onsite_done", next_action: "Share status link — candidate runs the AI interview" },
                  { successMsg: "Moved to Interview — share their status link", busyKey: "onsite" },
                )}
                disabled={!!busy}
              >
                {isBusy("onsite") ? <Spinner size={11} className="border-white/30 border-t-white mr-1.5" /> : null}
                Move to Interview
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => startOutreach("offer_letter", "offer")}
                disabled={!!busy || noEmail}
                title={noEmail ? noEmailTip : undefined}
              >
                {isBusy("offer") ? <Spinner size={11} className="mr-1.5" /> : null}
                Skip to offer
              </Button>
              <RejectButton candidate={candidate} disabled={!!busy} onTransition={transition} variant="ghost" />
            </Row>
          </>
        );

      case "onsite_done":
        return (
          <>
            <Header
              title="Interview"
              subtitle="Share the candidate's public status link — they'll see a Start Interview button and run an AI screen in their browser. Paste their transcript on the Interviews panel when they're done, then mark interview complete."
            />
            <Row>
              <Button
                variant="accent"
                size="sm"
                onClick={() => transition(
                  { stage: "offer", next_action: "Send offer letter" },
                  { successMsg: "Interview marked complete", busyKey: "iv_done" },
                )}
                disabled={!!busy}
                title="Move to Offer once you've reviewed the interview transcript and decided to advance them."
              >
                {isBusy("iv_done") ? <Spinner size={11} className="border-white/30 border-t-white mr-1.5" /> : null}
                Interview complete → Offer
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => startOutreach("offer_letter", "offer")}
                disabled={!!busy || noEmail}
                title={noEmail ? noEmailTip : undefined}
              >
                {isBusy("offer") ? <Spinner size={11} className="mr-1.5" /> : null}
                Draft offer letter
              </Button>
              <RejectButton candidate={candidate} disabled={!!busy} onTransition={transition} variant="ghost" />
            </Row>
          </>
        );

      case "offer":
        return (
          <>
            <Header
              title="Offer out"
              subtitle="Seven-day response window. Mark Accepted when they sign, Declined if they pass."
            />
            <Row>
              <Button
                variant="accent"
                size="sm"
                onClick={() => transition(
                  { stage: "hired", status: "hired", next_action: "Send welcome + onboarding kickoff" },
                  { successMsg: "🎉 Marked as Hired", busyKey: "hired" },
                )}
                disabled={!!busy}
              >
                {isBusy("hired") ? <Spinner size={11} className="border-white/30 border-t-white mr-1.5" /> : null}
                Accepted (Hired)
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => transition(
                  { stage: "closed", status: "declined", next_action: "Offer declined by candidate" },
                  { successMsg: "Moved to Rejected (offer declined)", busyKey: "offer_declined" },
                )}
                disabled={!!busy}
                className="text-danger hover:text-danger"
              >
                {isBusy("offer_declined") ? <Spinner size={11} className="mr-1.5" /> : null}
                Declined by candidate
              </Button>
            </Row>
          </>
        );

      case "hired":
        return (
          <>
            <Header
              title="Hired"
              subtitle="Done. Keep the record here as the source of truth for onboarding."
            />
          </>
        );

      case "closed":
        return (
          <>
            <Header
              title="Rejected"
              subtitle="Out of the active pipeline. Reopen if you want to revisit them later."
            />
            <Row>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => transition(
                  { stage: "sourced", status: "active", next_action: "Re-triage — moved out of Rejected" },
                  { successMsg: "Reopened — back to Sourced", busyKey: "reopen" },
                )}
                disabled={!!busy}
              >
                {isBusy("reopen") ? <Spinner size={11} className="mr-1.5" /> : null}
                Reopen
              </Button>
            </Row>
          </>
        );

      default:
        return (
          <Header title={stage} subtitle="No actions available for this stage." />
        );
    }
  })();

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div className="px-5 py-3 border-b border-border">
        <div className="text-sm font-semibold leading-none tracking-tight">Next steps</div>
        <div className="text-2xs text-faint mt-1 leading-relaxed">
          What you can do from <span className="text-muted font-medium">{labelize(stage)}</span>.
        </div>
      </div>
      {noEmail ? (
        <div className="px-5 py-2.5 border-b border-border bg-warning/10 text-2xs text-warning leading-relaxed">
          No email on file. Outreach actions are disabled until you add one — click <span className="font-medium">+ Add email</span> on the card above.
        </div>
      ) : null}
      {err ? (
        <div className="px-5 py-2.5 border-b border-border bg-danger/10 text-2xs text-danger leading-relaxed">
          {err}
        </div>
      ) : null}
      {success ? (
        <div className="px-5 py-2.5 border-b border-border bg-success/10 text-2xs text-success leading-relaxed">
          {success}
        </div>
      ) : null}
      <div className="px-5 py-4">{content}</div>

      {schedulingOpen ? (
        <ScheduleScreenModal
          candidateId={candidate.id}
          candidateName={candidate.name}
          candidateTimezone={
            (candidate.source_meta && typeof candidate.source_meta === "object"
              ? (candidate.source_meta as Record<string, unknown>).timezone
              : undefined) as string | undefined
          }
          onClose={() => setSchedulingOpen(false)}
          onScheduled={async (r) => {
            setSchedulingOpen(false);
            setSuccess(
              r.meet_url
                ? `Screen booked · Meet link sent to ${candidate.name}.`
                : `Screen booked for ${candidate.name}.`,
            );
            setTimeout(() => setSuccess(null), 6000);
            try {
              await onChanged();
            } catch { /* parent will retry on its own */ }
          }}
        />
      ) : null}
    </div>
  );
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-3">
      <div className="text-xs font-medium text-fg uppercase tracking-widest">{title}</div>
      <p className="text-2xs text-muted leading-relaxed mt-1.5">{subtitle}</p>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

/**
 * Reject button — context-aware:
 *
 *   - For candidates the founder has NOT yet contacted (stages `sourced` /
 *     `reviewed`), there's no one on the other side waiting to hear back, so
 *     the only sensible action is a silent close-out (existing behaviour).
 *
 *   - For candidates already in the conversation (`intro_sent` through
 *     `offer`), the default action becomes "send a kind, AI-drafted
 *     rejection". Clicking the button kicks off the `outreach` workflow with
 *     `intent="rejection"`. The draft lands in the Drafts queue exactly like
 *     every other outbound message — same review-and-approve flow. On approve,
 *     `send_outreach` flips the candidate to `closed` / `declined`.
 *
 *     The founder always has the escape hatch ("Just close out — no email")
 *     in case the candidate was a no-show, ghosted, or otherwise doesn't
 *     warrant the email.
 *
 * The asymmetry is deliberate. Sending an unsolicited "we're rejecting you"
 * email to someone who never knew they were being considered would be the
 * single most cringe-worthy thing this product could do. We default-deny it.
 */
function RejectButton({
  candidate,
  disabled,
  onTransition,
  variant = "ghost",
}: {
  candidate: Candidate;
  disabled: boolean;
  variant?: "ghost" | "accent";
  onTransition: (
    updates: { stage?: Stage; status?: Candidate["status"]; next_action?: string },
    opts?: { successMsg?: string; busyKey?: string },
  ) => Promise<void>;
}) {
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<"draft" | "silent" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const hasBeenContacted = (
    ["intro_sent", "replied", "screen_done", "onsite_done", "offer"] as Stage[]
  ).includes(candidate.stage);
  const canEmail = !!candidate.email && hasBeenContacted;

  async function startRejectionDraft() {
    setBusy("draft");
    setErr(null);
    try {
      const client = await getClient();
      await client.workflows.run("outreach", {
        data: { candidate_id: candidate.id, channel: "email", intent: "rejection" },
      });
      // Mark the candidate's next_action so the kanban hint reflects the
      // pending review. We don't transition status/stage here — the send
      // step will do that atomically when the founder approves.
      await client.records.update<Candidate>("candidates", candidate.id, {
        next_action: "Rejection draft in queue — review and send",
      });
      setConfirm(false);
      navigate("/drafts");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't draft the rejection.");
    } finally {
      setBusy(null);
    }
  }

  async function silentClose() {
    setBusy("silent");
    setErr(null);
    try {
      await onTransition(
        {
          stage: "closed",
          status: "declined",
          next_action: `Rejected from ${labelize(candidate.stage)} — closed silently`,
        },
        { successMsg: "Moved to Rejected", busyKey: "reject" },
      );
      setConfirm(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't close out.");
    } finally {
      setBusy(null);
    }
  }

  if (confirm) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {canEmail ? (
          <Button
            variant="accent"
            size="sm"
            onClick={() => void startRejectionDraft()}
            disabled={disabled || !!busy}
            title="AI drafts a kind, specific rejection citing the actual gap from the dossier + rubric. Founder reviews and sends."
          >
            {busy === "draft" ? <Spinner size={11} className="mr-1.5" /> : null}
            Send kind rejection
          </Button>
        ) : null}
        <Button
          variant={canEmail ? "ghost" : "accent"}
          size="sm"
          onClick={() => void silentClose()}
          disabled={disabled || !!busy}
          className={canEmail ? undefined : "bg-danger hover:bg-danger/90 text-white"}
          title={
            hasBeenContacted
              ? "Skip the email — useful for ghosters, no-shows, or candidates who explicitly asked to be removed."
              : "Close out silently. No email — the candidate was never contacted."
          }
        >
          {busy === "silent" ? <Spinner size={11} className="mr-1.5" /> : null}
          {canEmail ? "Just close out — no email" : "Confirm reject"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirm(false)} disabled={!!busy}>
          Cancel
        </Button>
        {err ? (
          <div className="basis-full text-2xs text-danger leading-relaxed mt-1">{err}</div>
        ) : null}
      </div>
    );
  }
  return (
    <Button
      variant={variant}
      size="sm"
      onClick={() => setConfirm(true)}
      disabled={disabled}
      className={cn(variant === "ghost" && "text-faint hover:text-danger")}
    >
      Reject
    </Button>
  );
}

function labelize(stage: string): string {
  return stage.replace(/_/g, " ");
}
