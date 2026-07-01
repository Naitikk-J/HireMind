import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { getClient } from "@/lib/client";
import type { Candidate, Role } from "@/lib/types";

type Item = {
  id: string;
  kind: "nav" | "candidate" | "role" | "action";
  label: string;
  hint?: string;
  icon?: string; // emoji-free; an svg id
  onSelect: () => void;
  keywords?: string;
};

const NAV: Array<Omit<Item, "onSelect">> = [
  { id: "nav-today",       kind: "nav", label: "Go to Today",       hint: "G T" },
  { id: "nav-drafts",      kind: "nav", label: "Go to Drafts",      hint: "G D" },
  { id: "nav-pipeline",    kind: "nav", label: "Go to Pipeline",    hint: "G K" },
  { id: "nav-candidates",  kind: "nav", label: "Go to Candidates",  hint: "G C" },
  { id: "nav-roles",       kind: "nav", label: "Go to Roles",       hint: "G R" },
  { id: "nav-activity",    kind: "nav", label: "Go to Activity",    hint: "G A" },
  { id: "nav-demo",        kind: "nav", label: "Go to Simulators",  hint: "G S" },
];

const NAV_PATHS: Record<string, string> = {
  "nav-today":      "/",
  "nav-drafts":     "/drafts",
  "nav-pipeline":   "/pipeline",
  "nav-candidates": "/candidates",
  "nav-roles":      "/roles",
  "nav-activity":   "/activity",
  "nav-demo":       "/demo",
};

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    setTimeout(() => inputRef.current?.focus(), 10);
    (async () => {
      const client = await getClient();
      const [c, r] = await Promise.all([
        client.records.list<Candidate>("candidates", { limit: 200 }),
        client.records.list<Role>("roles", { limit: 50 }),
      ]);
      setCandidates(c.items);
      setRoles(r.items);
    })().catch(() => { /* fine — palette still works for nav */ });
  }, [open]);

  const items: Item[] = useMemo(() => {
    const navItems: Item[] = NAV.map((it) => ({
      ...it,
      onSelect: () => { navigate(NAV_PATHS[it.id]); onClose(); },
    }));
    const candItems: Item[] = candidates.map((c) => ({
      id: `cand-${c.id}`,
      kind: "candidate" as const,
      label: c.name,
      hint: c.email ?? undefined,
      keywords: `${c.email ?? ""} ${c.stage ?? ""} ${c.next_action ?? ""}`,
      onSelect: () => { navigate(`/candidates/${c.id}`); onClose(); },
    }));
    const roleItems: Item[] = roles.map((r) => ({
      id: `role-${r.id}`,
      kind: "role",
      label: r.title,
      hint: r.slug ?? r.status,
      keywords: `${r.slug ?? ""} ${(r.must_haves ?? []).join(" ")}`,
      onSelect: () => { navigate(`/roles`); onClose(); },
    }));
    const actionItems: Item[] = [
      {
        id: "action-new-candidate", kind: "action",
        label: "New candidate — paste LinkedIn or transcript",
        hint: "Runs intake workflow",
        onSelect: () => { navigate("/pipeline?new=1"); onClose(); },
      },
      {
        id: "action-run-digest", kind: "action",
        label: "Generate weekly digest now",
        hint: "Simulator",
        onSelect: () => { navigate("/demo?run=digest"); onClose(); },
      },
      {
        id: "action-paste-reply", kind: "action",
        label: "Paste an inbound reply",
        hint: "Simulator — triggers reply_handler",
        onSelect: () => { navigate("/demo?run=reply"); onClose(); },
      },
      {
        id: "action-collect-feedback", kind: "action",
        label: "Collect interview feedback (Slack DM simulator)",
        hint: "Simulator",
        onSelect: () => { navigate("/demo?run=feedback"); onClose(); },
      },
    ];
    return [...navItems, ...actionItems, ...candItems, ...roleItems];
  }, [candidates, roles, navigate, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => {
      const hay = `${it.label} ${it.hint ?? ""} ${it.keywords ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [items, query]);

  useEffect(() => { setActive(0); }, [query]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const sel = filtered[active];
        if (sel) sel.onSelect();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, filtered, active]);

  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[10vh] px-4">
      <div className="absolute inset-0 bg-ink/70 backdrop-blur-md animate-fade-in" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-surface border border-border-strong rounded-lg shadow-popover overflow-hidden animate-pop-in">
        <div className="px-4 py-3 border-b border-border flex items-center gap-3">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="text-faint">
            <circle cx="7" cy="7" r="4.5" />
            <path d="m13.5 13.5-3-3" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search or run a command…"
            className="flex-1 bg-transparent text-sm text-fg placeholder:text-faint focus:outline-none"
          />
          <kbd>Esc</kbd>
        </div>

        <div ref={listRef} className="max-h-[440px] overflow-y-auto scrollbar-thin p-1.5">
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-xs text-faint">No matches.</div>
          ) : (
            <>
              {groupBy(filtered, "kind").map(([groupKind, groupItems]) => (
                <div key={groupKind} className="mb-1.5">
                  <div className="px-2 pt-2 pb-1 text-3xs uppercase tracking-widest text-faint font-medium">
                    {labelFor(groupKind)}
                  </div>
                  {groupItems.map((it) => {
                    const idx = filtered.indexOf(it);
                    return (
                      <button
                        key={it.id}
                        data-idx={idx}
                        onMouseEnter={() => setActive(idx)}
                        onClick={() => it.onSelect()}
                        className={cn(
                          "w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-left text-sm",
                          "transition-colors duration-75",
                          idx === active
                            ? "bg-surface2 text-fg"
                            : "text-fg/90 hover:bg-surface2/60",
                        )}
                      >
                        <KindIcon kind={it.kind} />
                        <span className="flex-1 min-w-0 truncate">{it.label}</span>
                        {it.hint ? (
                          <span className="text-2xs text-faint font-mono truncate max-w-[40%]">{it.hint}</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ))}
            </>
          )}
        </div>

        <div className="px-4 py-2.5 border-t border-border flex items-center justify-between text-2xs text-faint">
          <div className="flex items-center gap-3">
            <span className="kbd-pair"><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
            <span className="kbd-pair"><kbd>↵</kbd> select</span>
          </div>
          <span className="kbd-pair"><kbd>⌘</kbd><kbd>K</kbd> toggle</span>
        </div>
      </div>
    </div>
  );
}

function groupBy<T extends { kind: string }>(items: T[], _key: "kind"): Array<[string, T[]]> {
  const order = ["nav", "action", "candidate", "role"];
  const m = new Map<string, T[]>();
  for (const it of items) {
    if (!m.has(it.kind)) m.set(it.kind, []);
    m.get(it.kind)!.push(it);
  }
  return order.filter((k) => m.has(k)).map((k) => [k, m.get(k)!]);
}

function labelFor(kind: string): string {
  return {
    nav: "Navigate",
    action: "Actions",
    candidate: "Candidates",
    role: "Roles",
  }[kind] ?? kind;
}

function KindIcon({ kind }: { kind: Item["kind"] }) {
  const cls = "h-3.5 w-3.5 text-faint shrink-0";
  if (kind === "nav") return (
    <svg className={cls} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="m6 4 4 4-4 4" />
    </svg>
  );
  if (kind === "action") return (
    <svg className={cls} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2 4 9h3.5l-1 5L12 7H8.5l1-5Z" />
    </svg>
  );
  if (kind === "candidate") return (
    <svg className={cls} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="8" cy="6" r="2.7" />
      <path d="M3 13.5c0-2.2 2.2-3.8 5-3.8s5 1.6 5 3.8" />
    </svg>
  );
  return (
    <svg className={cls} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="12" height="9" rx="1.5" />
      <path d="M5 7h6M5 10h4" />
    </svg>
  );
}
