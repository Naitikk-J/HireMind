import { Link } from "react-router-dom";
import { Avatar } from "./ui/Avatar";
import { cn, formatRelative, scoreTone } from "@/lib/utils";
import type { Candidate, Role } from "@/lib/types";

const SOURCE_LABEL: Record<string, string> = {
  linkedin: "LinkedIn",
  referral: "Referral",
  inbound_email: "Inbound",
  twitter: "Twitter",
  site: "Site",
  manual: "Manual",
};

export function CandidateCard({
  candidate,
  role,
  selectable = false,
  selected = false,
  onToggleSelect,
}: {
  candidate: Candidate;
  role?: Role;
  // Compare-mode props. When `selectable` is true, the card sprouts a small
  // checkbox in the top-right corner. Clicking the checkbox (or the card
  // when selectable=true) toggles the candidate in the compare set instead
  // of navigating to their detail page. Pipeline.tsx owns this state.
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const tone = scoreTone(candidate.score);
  const scoreColor =
    tone === "high" ? "text-success" :
    tone === "mid"  ? "text-fg" :
    tone === "low"  ? "text-warning" :
                      "text-faint";

  // When the kanban is in compare-select mode, the card swaps from a Link to
  // a button — clicking anywhere toggles selection rather than navigating.
  // We still keep the card affordances (hover ring, checkbox) so the user
  // sees their selection accumulate.
  const cardClasses = cn(
    "block bg-surface border rounded-md p-3 transition-colors duration-100 ease-soft focus-ring group relative",
    selectable
      ? selected
        ? "border-accent ring-2 ring-accent/30 bg-accent/[0.04]"
        : "border-border hover:border-border-strong hover:bg-surface2"
      : "border-border hover:border-border-strong hover:bg-surface2",
  );

  const inner = (
    <>
      {selectable ? (
        <span
          className={cn(
            "absolute top-2 right-2 w-4 h-4 rounded-[4px] border flex items-center justify-center text-2xs",
            selected
              ? "bg-accent border-accent text-white"
              : "bg-surface border-border-strong text-transparent",
          )}
          aria-hidden
        >
          ✓
        </span>
      ) : null}
      <div className="flex items-start gap-2.5">
        <Avatar name={candidate.name} size="sm" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-fg truncate leading-tight">
            {candidate.name}
          </h3>
          <div className="text-xs text-muted truncate mt-0.5">
            {role ? role.title : <span className="text-faint">No role yet</span>}
          </div>
        </div>
        {candidate.score != null && !selectable ? (
          <span
            className={cn(
              "shrink-0 inline-flex items-center justify-center rounded-md h-6 min-w-[30px] px-1.5 num text-xs font-semibold bg-bg chip-inset",
              scoreColor,
            )}
          >
            {candidate.score.toFixed(1)}
          </span>
        ) : null}
      </div>

      <div className="mt-2.5 text-xs text-fg/80 line-clamp-2 min-h-[2.2em] leading-relaxed text-pretty">
        {candidate.next_action || <span className="text-faint italic">No next action set.</span>}
      </div>

      <div className="mt-2.5 pt-2.5 border-t border-border flex items-center justify-between gap-2">
        <span className="text-2xs text-faint uppercase tracking-widest font-medium">
          {SOURCE_LABEL[candidate.source] || candidate.source}
        </span>
        <span className="text-2xs text-faint num">
          {candidate.last_contact ? formatRelative(candidate.last_contact) : "no contact"}
        </span>
      </div>
    </>
  );

  if (selectable) {
    return (
      <button
        type="button"
        onClick={() => onToggleSelect?.(candidate.id)}
        className={cn(cardClasses, "text-left w-full")}
        aria-pressed={selected}
      >
        {inner}
      </button>
    );
  }

  return (
    <Link to={`/candidates/${candidate.id}`} className={cardClasses}>
      {inner}
    </Link>
  );
}
