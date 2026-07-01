import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { getClient } from "@/lib/client";
import { cn } from "@/lib/utils";
import type { Interview, Candidate } from "@/lib/types";

/**
 * Booking modal: pick one of the AI-proposed slots (free-busy aware) or
 * type a custom time, then fire `schedule_screen`. On success the Google
 * Calendar event is created with a Meet link auto-attached, the candidate
 * gets an actual invite in their inbox, and an `interviews` row is written
 * with `meet_url + calendar_event_id`.
 *
 * UX choices that took convincing:
 *
 *   - We render 3 slot cards first, "custom" second. The whole point of
 *     pre-computing slots is removing decision fatigue from the founder.
 *     Custom is a fallback, not the default.
 *
 *   - We expose the slot SOURCE (`calendar` / `fallback_no_auth` / etc.) as
 *     a subtle line under the buttons. If the connector isn't wired the
 *     founder needs to know they're picking guesses, not real free-busy.
 *
 *   - On submit we show the optimistic success state immediately and rely
 *     on the parent's `onScheduled` callback to refetch. Don't poll —
 *     `schedule_screen` is a synchronous API function, so by the time we
 *     get a response the event already exists in Google's system.
 *
 * Failure surface: if `schedule_screen` raises because the gcal connector
 * isn't wired, we render the error inline + show a "Connect Google
 * Calendar" hint pointing to the integrations panel.
 */

type ProposedSlot = {
  start: string;
  end: string;
  label: string;
};

type ProposeSlotsResult = {
  slots: ProposedSlot[];
  source: "calendar" | "fallback_no_auth" | "fallback_after_error" | "fallback_no_freebusy_data";
  timezone: string;
  note: string;
};

type ScheduleScreenResult = {
  interview_id: string;
  candidate_id: string;
  scheduled_at: string;
  meet_url: string;
  calendar_event_id: string;
  calendar_html_link: string;
  next_action: string;
  mode: string;
};

// Two ways to run the screen with a candidate: the original "human Meet"
// path (Calendar event + Google Meet link), or the new "AI video" path
// (the candidate runs through the AI interview on the public link, no
// founder time during the round). Modeled as a top-level toggle so all
// the slot-picker UI hides cleanly for the AI path.
type ScreenMode = "human" | "ai_video";

export function ScheduleScreenModal({
  candidateId,
  candidateName,
  candidateTimezone,
  onClose,
  onScheduled,
}: {
  candidateId: string;
  candidateName: string;
  // Optional — defaults to the candidate's source_meta.timezone, then to PT.
  candidateTimezone?: string;
  onClose: () => void;
  // Fired on a successful book — parent refetches the candidate so the
  // UI reflects the new next_action / interview row.
  onScheduled: (result: ScheduleScreenResult) => void;
}) {
  const [mode, setMode] = useState<ScreenMode>("human");
  const [slots, setSlots] = useState<ProposedSlot[] | null>(null);
  const [slotSource, setSlotSource] = useState<ProposeSlotsResult["source"] | null>(null);
  const [slotNote, setSlotNote] = useState("");
  const [selectedIndex, setSelectedIndex] = useState<number | "custom" | null>(null);
  const [customDateTime, setCustomDateTime] = useState<string>("");
  const [duration, setDuration] = useState(25);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Stores the interview row id we create for an AI-video screen so the
  // confirmation step can show a sensible "Share this link" CTA without
  // a refetch.
  const [aiResult, setAiResult] = useState<{ interview_id: string } | null>(null);

  useEffect(() => {
    // Only fetch slots when the operator's actually going to schedule a
    // human call — the AI-video path doesn't touch Calendar at all.
    if (mode !== "human") return;
    if (slots !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const client = await getClient();
        const r = await client.functions.run<ProposeSlotsResult>("propose_slots", {
          timezone: candidateTimezone || "America/Los_Angeles",
          duration_minutes: 25,
          slots_wanted: 3,
        });
        if (cancelled) return;
        setSlots(r.slots || []);
        setSlotSource(r.source);
        setSlotNote(r.note || "");
        // Pre-select the first slot — most-likely intent.
        if ((r.slots || []).length > 0) setSelectedIndex(0);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Couldn't load proposed slots.");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [candidateTimezone, mode, slots]);

  // Schedule an AI-driven video interview: create an `interviews` row in
  // `ai_screen` round, status=scheduled, no calendar event. The candidate
  // takes the interview at their convenience on `candidate-view`; when
  // they finish, the founder pastes the transcript code on the candidate
  // detail page and `evaluate_interview` scores it.
  async function submitAiVideo() {
    setError(null);
    setSubmitting(true);
    try {
      const client = await getClient();
      const created = await client.records.create<Interview>("interviews", {
        candidate_id: candidateId,
        round: "ai_screen",
        status: "scheduled",
      });
      // Move the candidate to the interview stage and leave a clear
      // next_action so the kanban card explains what's expected of the
      // founder. We don't ship the link from here — the candidate's
      // status URL on CandidateDetail already exposes a "Start interview"
      // button when stage === "onsite_done", so we just need to point
      // the candidate at it.
      await client.records.update<Candidate>("candidates", candidateId, {
        stage: "onsite_done",
        next_action: `Share AI interview link · awaiting transcript from ${candidateName}`,
      });
      setAiResult({ interview_id: created.id });
      // Surface success via the same callback the human path uses so the
      // parent re-renders. We synthesize a Calendar-shaped result with
      // empty Meet fields — the parent already tolerates these.
      onScheduled({
        interview_id: created.id,
        candidate_id: candidateId,
        scheduled_at: new Date().toISOString(),
        meet_url: "",
        calendar_event_id: "",
        calendar_html_link: "",
        next_action: "Share AI interview link · awaiting transcript",
        mode: "ai_video",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't queue the AI interview.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submit() {
    setError(null);
    let startIso = "";
    if (selectedIndex === "custom") {
      if (!customDateTime) {
        setError("Pick a date and time for the screen.");
        return;
      }
      // <input type="datetime-local"> gives 'YYYY-MM-DDTHH:MM' with NO
      // timezone — we treat it as the founder's local tz (browser's local).
      // Build an ISO with the browser's current offset attached so the
      // function receives an unambiguous instant.
      const d = new Date(customDateTime);
      if (isNaN(d.getTime())) {
        setError("That date/time doesn't parse. Try a different one.");
        return;
      }
      startIso = d.toISOString();
    } else if (typeof selectedIndex === "number" && slots && slots[selectedIndex]) {
      startIso = slots[selectedIndex].start;
    } else {
      setError("Pick one of the proposed slots, or enter a custom time.");
      return;
    }

    setSubmitting(true);
    try {
      const client = await getClient();
      const result = await client.functions.run<ScheduleScreenResult>("schedule_screen", {
        candidate_id: candidateId,
        start_iso: startIso,
        duration_minutes: duration,
        round: "screen",
      });
      onScheduled(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // The function raises a friendly message for the missing-auth case.
      // Other errors get the bare message; the modal stays open so the
      // founder can retry without losing their selection.
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-surface border border-border rounded-xl shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border">
          <div className="text-sm font-semibold tracking-tight">
            Screen {candidateName}
          </div>
          <div className="text-2xs text-faint mt-1 leading-relaxed">
            {mode === "human"
              ? "Picks a slot, creates a Google Calendar event with a Meet link, and sends a calendar invite to the candidate."
              : "Queues a self-serve AI video interview — the candidate takes it at their convenience and the AI scores it 0–100 once they send back the transcript."}
          </div>
        </div>

        {/* Mode toggle — sits above everything so the form/slot UI below
            re-renders cleanly when the founder flips it. */}
        <div className="px-5 pt-4">
          <div className="text-2xs uppercase tracking-widest text-muted font-medium mb-2">
            How are you screening?
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => { setMode("human"); setError(null); setAiResult(null); }}
              className={cn(
                "text-left rounded-md px-3 py-2.5 border transition-colors duration-100",
                mode === "human"
                  ? "border-accent ring-1 ring-accent/30 bg-accent/[0.04]"
                  : "border-border hover:border-border-strong hover:bg-surface2",
              )}
            >
              <div className="text-sm font-medium leading-tight">Human · Google Meet</div>
              <div className="text-2xs text-faint mt-0.5 leading-snug">
                Books a calendar slot. You meet live.
              </div>
            </button>
            <button
              type="button"
              onClick={() => { setMode("ai_video"); setError(null); setAiResult(null); }}
              className={cn(
                "text-left rounded-md px-3 py-2.5 border transition-colors duration-100",
                mode === "ai_video"
                  ? "border-accent ring-1 ring-accent/30 bg-accent/[0.04]"
                  : "border-border hover:border-border-strong hover:bg-surface2",
              )}
            >
              <div className="text-sm font-medium leading-tight">AI video interview</div>
              <div className="text-2xs text-faint mt-0.5 leading-snug">
                Self-serve. AI asks, AI scores 0–100.
              </div>
            </button>
          </div>
        </div>

        {mode === "ai_video" ? (
          // AI video path — no slot picker, no duration. Just a confirm
          // button that creates the interview row and bumps the candidate
          // to the interview stage. The shareable link lives on the
          // CandidateDetail page (`Candidate status link` panel) so we
          // surface a pointer to it on success rather than minting a
          // second URL here.
          <div className="px-5 py-4 space-y-4">
            <div className="text-2xs text-muted leading-relaxed">
              <p className="mb-2">The candidate runs the interview in their browser:</p>
              <ul className="list-disc pl-4 space-y-1">
                <li>AI avatar speaks each question out loud (no app install)</li>
                <li>Candidate answers on video, any language — live transcript</li>
                <li>Lightweight proctor: focus & visibility flags</li>
                <li>You paste the resulting transcript code on this candidate's page; the AI scorer rates each answer 0–100</li>
              </ul>
            </div>

            {aiResult ? (
              <div className="text-2xs text-success bg-success/10 border border-success/20 rounded-md px-3 py-2 leading-relaxed">
                AI interview queued. The candidate's <span className="font-medium">status link</span> now shows a <span className="font-medium">Start video interview</span> button — copy the link from the &ldquo;Candidate status link&rdquo; panel and send it however you like.
              </div>
            ) : null}

            {error ? (
              <div className="text-xs text-danger bg-danger/10 border border-danger/20 rounded-md px-3 py-2 leading-relaxed">
                {error}
              </div>
            ) : null}
          </div>
        ) : (
        <div className="px-5 py-4 space-y-4">
          {/* Slot picker */}
          <div>
            <div className="text-2xs uppercase tracking-widest text-muted font-medium mb-2">
              Proposed times
            </div>
            {slots === null ? (
              <div className="flex items-center gap-2 text-xs text-muted py-3">
                <Spinner size={12} />
                Reading your calendar…
              </div>
            ) : slots.length === 0 ? (
              <div className="text-xs text-faint italic">No slots returned. Use a custom time below.</div>
            ) : (
              <div className="space-y-1.5">
                {slots.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setSelectedIndex(i)}
                    className={cn(
                      "w-full text-left rounded-md px-3 py-2.5 border transition-colors duration-100 ease-soft",
                      selectedIndex === i
                        ? "border-accent ring-1 ring-accent/30 bg-accent/[0.04]"
                        : "border-border hover:border-border-strong hover:bg-surface2",
                    )}
                  >
                    <div className="text-sm font-medium leading-tight">{s.label}</div>
                    <div className="text-2xs text-faint mt-0.5">
                      {new Date(s.start).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                    </div>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setSelectedIndex("custom")}
                  className={cn(
                    "w-full text-left rounded-md px-3 py-2.5 border transition-colors duration-100 ease-soft",
                    selectedIndex === "custom"
                      ? "border-accent ring-1 ring-accent/30 bg-accent/[0.04]"
                      : "border-border hover:border-border-strong hover:bg-surface2 border-dashed",
                  )}
                >
                  <div className="text-sm font-medium leading-tight">Pick a custom time</div>
                  <div className="text-2xs text-faint mt-0.5">
                    Use this if none of the proposed times work.
                  </div>
                </button>
              </div>
            )}
            {slotSource && slotSource !== "calendar" ? (
              <div className="text-2xs text-warning mt-2 leading-snug">
                {slotNote || "Free-busy unavailable — proposals are heuristic. Connect Google Calendar for real availability."}
              </div>
            ) : slotSource === "calendar" ? (
              <div className="text-2xs text-faint mt-2 leading-snug">
                {slotNote}
              </div>
            ) : null}
          </div>

          {selectedIndex === "custom" ? (
            <div>
              <label className="text-2xs uppercase tracking-widest text-muted font-medium block mb-1.5">
                Custom date & time
              </label>
              <input
                type="datetime-local"
                value={customDateTime}
                onChange={(e) => setCustomDateTime(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus-ring"
              />
              <div className="text-2xs text-faint mt-1.5 leading-snug">
                Interpreted in your browser's local timezone.
              </div>
            </div>
          ) : null}

          <div>
            <label className="text-2xs uppercase tracking-widest text-muted font-medium block mb-1.5">
              Duration
            </label>
            <div className="flex gap-1.5">
              {[15, 25, 45, 60].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDuration(d)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs border transition-colors duration-100",
                    duration === d
                      ? "border-fg bg-fg text-bg"
                      : "border-border hover:border-border-strong",
                  )}
                >
                  {d} min
                </button>
              ))}
            </div>
          </div>

          {error ? (
            <div className="text-xs text-danger bg-danger/10 border border-danger/20 rounded-md px-3 py-2 leading-relaxed">
              {error}
            </div>
          ) : null}
        </div>
        )}

        <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
            {aiResult ? "Done" : "Cancel"}
          </Button>
          {mode === "human" ? (
            <Button
              variant="accent"
              size="sm"
              onClick={() => void submit()}
              disabled={submitting || selectedIndex === null}
            >
              {submitting ? <Spinner size={11} className="mr-1.5" /> : null}
              Book + send Meet invite
            </Button>
          ) : (
            <Button
              variant="accent"
              size="sm"
              onClick={() => void submitAiVideo()}
              disabled={submitting || aiResult !== null}
            >
              {submitting ? <Spinner size={11} className="mr-1.5" /> : null}
              {aiResult ? "Queued" : "Queue AI interview"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
