import type { Stage } from "./types";

// Kanban column order — left to right. The terminal "Rejected" bucket
// (anyone passed at sourcing / screening / onsite / declined offer) reuses
// the existing `closed` enum value internally; we just relabel it in the UI.
// This keeps the schema migration-free while still giving the operator a
// dedicated column so nobody silently disappears from the board.
export const STAGES: Stage[] = [
  "sourced",
  "reviewed",
  "intro_sent",
  "replied",
  "screen_done",
  "onsite_done",
  "offer",
  "hired",
  "closed",
];

// Wire enum `onsite_done` is relabeled to "Interview" everywhere in the UI:
// this is the AI-driven interview stage the candidate runs through from
// their public status link. Same pattern as `closed`→"Rejected" — we
// preserve the schema enum, just change the human-facing label.
export const STAGE_LABELS: Record<Stage, string> = {
  sourced:     "Sourced",
  reviewed:    "Reviewed",
  intro_sent:  "Intro sent",
  replied:     "Replied",
  screen_done: "Screen done",
  onsite_done: "Interview",
  offer:       "Offer",
  hired:       "Hired",
  closed:      "Rejected",
};

export const STAGE_HINT: Record<Stage, string> = {
  sourced:     "Review dossier, then mark Reviewed",
  reviewed:    "Ready to draft intro outreach",
  intro_sent:  "Waiting on a reply",
  replied:     "Reply received — send screening or decide",
  screen_done: "Screen complete — interview next, or skip to offer",
  onsite_done: "Interview in progress — candidate runs the AI screen from their public link",
  offer:       "Offer out — 7-day response window",
  hired:       "Welcome aboard",
  closed:      "Passed or declined — kept for the record",
};

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || "")
    .join("");
}

export function formatRelative(iso?: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function scoreTone(score?: number | null): "high" | "mid" | "low" | "none" {
  if (score == null) return "none";
  if (score >= 8) return "high";
  if (score >= 6.5) return "mid";
  return "low";
}

// Per-stage accent dot color (dark-mode tuned).
export const STAGE_ACCENT: Record<Stage, { text: string; dot: string }> = {
  sourced:     { text: "text-faint",        dot: "bg-faint" },
  reviewed:    { text: "text-warning",      dot: "bg-warning" },
  intro_sent:  { text: "text-info",         dot: "bg-info" },
  replied:     { text: "text-accent-2",     dot: "bg-accent" },
  screen_done: { text: "text-accent-2",     dot: "bg-accent-2" },
  onsite_done: { text: "text-[#9486FF]",    dot: "bg-[#9486FF]" },
  offer:       { text: "text-success",      dot: "bg-success" },
  hired:       { text: "text-success",      dot: "bg-success" },
  closed:      { text: "text-danger",       dot: "bg-danger" },
};
