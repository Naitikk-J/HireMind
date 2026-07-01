import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { TopBar } from "@/components/layout/TopBar";
import { CandidateCard } from "@/components/CandidateCard";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { IntakeModal } from "@/components/IntakeModal";
import { getClient } from "@/lib/client";
import { STAGES, STAGE_LABELS, STAGE_HINT, STAGE_ACCENT, cn } from "@/lib/utils";
import type { Candidate, Role } from "@/lib/types";

const VISIBLE_STAGES = STAGES;

export function Pipeline() {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [search, setSearch] = useState("");
  const [activeRole, setActiveRole] = useState<string | "all">("all");
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [isMock, setIsMock] = useState(false);

  // Compare mode: when active, candidate cards become selectable buttons
  // (instead of detail-page links) and a floating action bar surfaces at
  // the bottom of the screen showing "N selected · [Compare]". Maxed at
  // 4 selections — beyond that side-by-side becomes unreadable.
  const [compareMode, setCompareMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const navigate = useNavigate();
  const COMPARE_MAX = 4;

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= COMPARE_MAX) return prev;
      return [...prev, id];
    });
  }

  function exitCompare() {
    setCompareMode(false);
    setSelectedIds([]);
  }

  const [params, setParams] = useSearchParams();

  useEffect(() => {
    if (params.get("new") === "1") {
      setIntakeOpen(true);
      params.delete("new");
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const refresh = async () => {
    const client = await getClient();
    setIsMock(client.isMock);
    const [c, r] = await Promise.all([
      client.records.list<Candidate>("candidates", { limit: 500 }),
      client.records.list<Role>("roles", { limit: 100 }),
    ]);
    setCandidates(c.items);
    setRoles(r.items);
  };

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    refresh();
    (async () => {
      const client = await getClient();
      cleanup = client.watchCandidates(refresh);
    })();
    return () => { cleanup?.(); };
  }, []);

  const rolesById = useMemo(
    () => Object.fromEntries(roles.map((r) => [r.id, r])),
    [roles],
  );

  const filtered = useMemo(() => {
    if (!candidates) return null;
    const q = search.trim().toLowerCase();
    return candidates.filter((c) => {
      if (activeRole !== "all" && c.role_id !== activeRole) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.email?.toLowerCase().includes(q) ?? false) ||
        (c.next_action?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [candidates, search, activeRole]);

  const byStage = useMemo(() => {
    const map = new Map<string, Candidate[]>();
    VISIBLE_STAGES.forEach((s) => map.set(s, []));
    (filtered || []).forEach((c) => {
      // Show on the kanban if:
      //   - they're active (in-flight pipeline), OR
      //   - they ended in a terminal stage we render explicitly (hired / rejected).
      // This is the trick that lets the Rejected column actually populate —
      // a rejected candidate has status=declined, which the old filter
      // skipped entirely.
      const isTerminalKept = c.stage === "closed" || c.stage === "hired";
      if (c.status !== "active" && !isTerminalKept) return;
      if (map.has(c.stage)) map.get(c.stage)!.push(c);
    });
    return map;
  }, [filtered]);

  return (
    <>
      <TopBar
        eyebrow="Pipeline"
        title="Kanban"
        actions={
          <>
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
              className="w-56 hidden md:block"
            />
            {isMock ? (
              <Badge tone="warning" dot>Demo data</Badge>
            ) : (
              <Badge tone="success" dot>Live</Badge>
            )}
            {compareMode ? (
              <Button variant="ghost" size="sm" onClick={exitCompare}>
                Cancel compare
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCompareMode(true)}
                title="Pick 2-4 candidates to view side by side"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5">
                  <rect x="3" y="3" width="7" height="18" />
                  <rect x="14" y="3" width="7" height="18" />
                </svg>
                Compare
              </Button>
            )}
            <Button variant="accent" size="sm" onClick={() => setIntakeOpen(true)} disabled={compareMode}>
              + New candidate
            </Button>
          </>
        }
      />

      <div className="px-7 pt-3 pb-2 flex items-center gap-1.5 flex-wrap">
        <FilterChip
          label="All roles"
          active={activeRole === "all"}
          onClick={() => setActiveRole("all")}
          count={candidates?.length ?? null}
        />
        {roles.map((r) => (
          <FilterChip
            key={r.id}
            label={r.title}
            active={activeRole === r.id}
            onClick={() => setActiveRole(r.id)}
            count={(candidates || []).filter((c) => c.role_id === r.id).length}
          />
        ))}
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-hidden scrollbar-thin px-7 pb-7 pt-2">
        {filtered === null ? (
          <div className="flex items-center justify-center h-64 text-muted text-sm gap-2">
            <Spinner size={13} /> Loading pipeline…
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title="Nothing here yet"
            description="Add a candidate from a LinkedIn URL, a voice-note transcript, or a referral note. The intake agent builds the dossier."
            action={
              <Button variant="accent" onClick={() => setIntakeOpen(true)}>+ Add a candidate</Button>
            }
          />
        ) : (
          <div className="flex gap-3 h-full min-h-[520px]">
            {VISIBLE_STAGES.map((stage) => {
              const items = byStage.get(stage) || [];
              const accent = STAGE_ACCENT[stage];
              return (
                <div key={stage} className="w-[268px] shrink-0 flex flex-col">
                  <div className="px-1 mb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={cn("h-1.5 w-1.5 rounded-full", accent.dot)} />
                        <div className="text-sm font-medium text-fg tracking-tight">
                          {STAGE_LABELS[stage]}
                        </div>
                      </div>
                      <span className="num text-2xs text-muted bg-surface2 px-1.5 py-0.5 rounded">{items.length}</span>
                    </div>
                    <div className="text-2xs text-faint mt-1 ml-3.5 leading-snug">
                      {STAGE_HINT[stage]}
                    </div>
                  </div>
                  <div className="flex-1 flex flex-col gap-2 pr-1 scrollbar-thin overflow-y-auto">
                    {items.length === 0 ? (
                      <div className="rounded-md border border-dashed border-border h-full min-h-[120px] flex items-center justify-center text-2xs text-faint uppercase tracking-widest">
                        empty
                      </div>
                    ) : (
                      items.map((c) => (
                        <CandidateCard
                          key={c.id}
                          candidate={c}
                          role={rolesById[c.role_id || ""]}
                          selectable={compareMode}
                          selected={selectedIds.includes(c.id)}
                          onToggleSelect={toggleSelect}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <IntakeModal open={intakeOpen} onClose={() => setIntakeOpen(false)} onCreated={refresh} />

      {/* Compare-mode HUD. Banner at the top of the board explains the
          mode; floating bar at the bottom shows the running selection and
          jumps to /compare when there are at least 2 picks. */}
      {compareMode ? (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 bg-fg text-bg shadow-xl rounded-full pl-4 pr-1.5 py-1.5 flex items-center gap-3 border border-fg">
          <span className="text-xs font-medium">
            {selectedIds.length === 0
              ? "Pick 2–4 candidates"
              : `${selectedIds.length} selected${selectedIds.length === COMPARE_MAX ? " (max)" : ""}`}
          </span>
          <Button
            variant="accent"
            size="sm"
            onClick={() => {
              if (selectedIds.length < 2) return;
              navigate(`/compare?ids=${selectedIds.join(",")}`);
            }}
            disabled={selectedIds.length < 2}
            className="bg-accent hover:bg-accent/90 text-white"
          >
            Compare →
          </Button>
        </div>
      ) : null}
    </>
  );
}

function FilterChip({
  label, active, onClick, count,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  count: number | null;
}) {
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
      <span className="font-medium tracking-tight">{label}</span>
      {count != null ? (
        <span className={cn("num text-2xs", active ? "text-bg/70" : "text-faint")}>
          {count}
        </span>
      ) : null}
    </button>
  );
}

