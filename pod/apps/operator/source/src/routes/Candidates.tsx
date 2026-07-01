import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { TopBar } from "@/components/layout/TopBar";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { getClient } from "@/lib/client";
import { STAGE_LABELS, STAGE_ACCENT, cn, formatRelative, scoreTone } from "@/lib/utils";
import type { Candidate, Role, Stage } from "@/lib/types";

const STAGE_ORDER: Stage[] = [
  "sourced", "reviewed", "intro_sent", "replied",
  "screen_done", "onsite_done", "offer", "hired",
];

export function Candidates() {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<Stage | "all">("all");

  useEffect(() => {
    (async () => {
      const client = await getClient();
      const [c, r] = await Promise.all([
        client.records.list<Candidate>("candidates", { limit: 500 }),
        client.records.list<Role>("roles", { limit: 100 }),
      ]);
      setCandidates(c.items);
      setRoles(r.items);
    })();
  }, []);

  const rolesById = useMemo(
    () => Object.fromEntries(roles.map((r) => [r.id, r])),
    [roles],
  );

  const filtered = useMemo(() => {
    if (!candidates) return null;
    const q = search.trim().toLowerCase();
    return candidates
      .filter((c) => c.status === "active")
      .filter((c) => stageFilter === "all" || c.stage === stageFilter)
      .filter((c) => {
        if (!q) return true;
        return (
          c.name.toLowerCase().includes(q) ||
          (c.email?.toLowerCase().includes(q) ?? false) ||
          (c.next_action?.toLowerCase().includes(q) ?? false)
        );
      })
      .sort((a, b) => {
        const da = a.last_contact || a.created_at;
        const db = b.last_contact || b.created_at;
        return db.localeCompare(da);
      });
  }, [candidates, search, stageFilter]);

  const countsByStage = useMemo(() => {
    const m: Record<string, number> = { all: 0 };
    (candidates || []).filter((c) => c.status === "active").forEach((c) => {
      m.all = (m.all || 0) + 1;
      m[c.stage] = (m[c.stage] || 0) + 1;
    });
    return m;
  }, [candidates]);

  return (
    <>
      <TopBar
        eyebrow="Pipeline"
        title="Candidates"
        actions={
          <Input
            placeholder="Filter…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            iconLeft={
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="7" cy="7" r="4.5" />
                <path d="m13.5 13.5-3-3" />
              </svg>
            }
            className="w-64"
          />
        }
      />

      <div className="px-7 pt-3 pb-2 flex items-center gap-1.5 flex-wrap">
        <StageChip label="All" stage="all" active={stageFilter === "all"} onClick={() => setStageFilter("all")} count={countsByStage.all || 0} />
        {STAGE_ORDER.map((s) => (
          <StageChip
            key={s}
            label={STAGE_LABELS[s]}
            stage={s}
            active={stageFilter === s}
            onClick={() => setStageFilter(s)}
            count={countsByStage[s] || 0}
          />
        ))}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin px-7 pb-7">
        {filtered === null ? (
          <div className="flex items-center justify-center py-20 text-muted text-sm gap-2">
            <Spinner size={13} /> Loading candidates…
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState title="No candidates match" description="Adjust your filter or stage." />
        ) : (
          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            <div className="grid grid-cols-[24px_1fr_140px_120px_56px_120px_120px] gap-3 px-3 py-2 border-b border-border text-3xs uppercase tracking-widest text-faint font-medium">
              <span></span>
              <span>Candidate</span>
              <span>Role</span>
              <span>Stage</span>
              <span className="text-right">Score</span>
              <span>Last contact</span>
              <span>Source</span>
            </div>
            <ul>
              {filtered.map((c) => {
                const role = rolesById[c.role_id || ""];
                const tone = scoreTone(c.score);
                const scoreClass =
                  tone === "high" ? "text-success" :
                  tone === "mid"  ? "text-fg" :
                  tone === "low"  ? "text-warning" : "text-faint";
                const accent = STAGE_ACCENT[c.stage];
                return (
                  <li key={c.id}>
                    <Link
                      to={`/candidates/${c.id}`}
                      className={cn(
                        "grid grid-cols-[24px_1fr_140px_120px_56px_120px_120px] gap-3 px-3 py-2.5 items-center",
                        "border-b border-border last:border-0",
                        "hover:bg-surface2 transition-colors duration-75 ease-soft",
                      )}
                    >
                      <Avatar name={c.name} size="xs" />
                      <div className="min-w-0">
                        <div className="text-sm text-fg font-medium leading-none tracking-tight truncate">{c.name}</div>
                        {c.next_action ? (
                          <div className="text-2xs text-muted truncate mt-1 leading-tight">{c.next_action}</div>
                        ) : null}
                      </div>
                      <div className="text-xs text-muted truncate">{role?.title || <span className="text-faint">—</span>}</div>
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className={cn("h-1.5 w-1.5 rounded-full", accent.dot)} />
                        <span className="text-fg/85 truncate">{STAGE_LABELS[c.stage]}</span>
                      </div>
                      <div className={cn("text-right text-sm num font-medium", scoreClass)}>
                        {c.score != null ? c.score.toFixed(1) : "—"}
                      </div>
                      <div className="text-xs text-faint num truncate">{c.last_contact ? formatRelative(c.last_contact) : "—"}</div>
                      <div className="text-xs text-faint truncate capitalize">{c.source.replace(/_/g, " ")}</div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}

function StageChip({
  label, stage, active, onClick, count,
}: {
  label: string;
  stage: Stage | "all";
  active: boolean;
  onClick: () => void;
  count: number;
}) {
  const dotClass = stage === "all" ? "" : STAGE_ACCENT[stage].dot;
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md h-7 px-2.5 text-xs",
        "transition-colors duration-100 ease-soft focus-ring",
        active
          ? "bg-fg text-bg"
          : "bg-surface border border-border text-muted hover:text-fg hover:border-border-strong",
      )}
    >
      {stage !== "all" ? <span className={cn("h-1.5 w-1.5 rounded-full", dotClass)} /> : null}
      <span className="font-medium tracking-tight">{label}</span>
      <span className={cn("num text-2xs", active ? "text-bg/70" : "text-faint")}>{count}</span>
    </button>
  );
}
