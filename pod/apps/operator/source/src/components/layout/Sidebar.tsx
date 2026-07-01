import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";

const ICON = "h-[15px] w-[15px]";

function HomeIcon() {
  return (
    <svg className={ICON} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 6.5 8 2l5.5 4.5V13a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V6.5Z" />
      <path d="M6.5 14V9.5h3V14" />
    </svg>
  );
}
function PipelineIcon() {
  return (
    <svg className={ICON} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3.5" width="3" height="9" rx="1" />
      <rect x="6.5" y="3.5" width="3" height="6.5" rx="1" />
      <rect x="11" y="3.5" width="3" height="4" rx="1" />
    </svg>
  );
}
function DraftIcon() {
  return (
    <svg className={ICON} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3h7l3 3v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M5 8h6M5 10.5h6M5 13h3.5" />
    </svg>
  );
}
function CandidatesIcon() {
  return (
    <svg className={ICON} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5.5" cy="6" r="2.4" />
      <path d="M1.5 13.5c0-2 1.7-3.4 4-3.4s4 1.5 4 3.4" />
      <path d="M10.5 4.2a2.4 2.4 0 0 1 0 4" />
      <path d="M14.5 12.5c0-1.4-1.1-2.6-2.7-2.9" />
    </svg>
  );
}
function RolesIcon() {
  return (
    <svg className={ICON} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="12" height="9.5" rx="1.5" />
      <path d="M5 7h6M5 9.5h4" />
    </svg>
  );
}
function ActivityIcon() {
  return (
    <svg className={ICON} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 8.5h2.2l1.3-3.5L8 12l1.5-3.5h4.5" />
    </svg>
  );
}
function SimulatorIcon() {
  return (
    <svg className={ICON} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="12" height="8.5" rx="1.5" />
      <path d="M6 14h4M8 11.5V14" />
      <circle cx="8" cy="7.25" r="1.2" />
    </svg>
  );
}

const founderName = (import.meta.env.VITE_HIREMIND_FOUNDER_NAME as string | undefined) || "Naitik";

const sections: Array<{
  label?: string;
  items: Array<{ to: string; label: string; icon: React.ReactNode; end?: boolean; kbd?: string }>;
}> = [
  {
    items: [
      { to: "/", label: "Today", icon: <HomeIcon />, end: true, kbd: "G T" },
      { to: "/drafts", label: "Drafts", icon: <DraftIcon />, kbd: "G D" },
    ],
  },
  {
    label: "Pipeline",
    items: [
      { to: "/pipeline", label: "Kanban", icon: <PipelineIcon />, kbd: "G K" },
      { to: "/candidates", label: "Candidates", icon: <CandidatesIcon />, kbd: "G C" },
      { to: "/roles", label: "Roles", icon: <RolesIcon />, kbd: "G R" },
    ],
  },
  {
    label: "Operations",
    items: [
      { to: "/activity", label: "Activity", icon: <ActivityIcon />, kbd: "G A" },
      { to: "/demo", label: "Simulators", icon: <SimulatorIcon />, kbd: "G S" },
    ],
  },
];

export function Sidebar({ openCommandPalette }: { openCommandPalette?: () => void }) {
  return (
    <aside className="w-[228px] shrink-0 border-r border-border bg-surface/40 backdrop-blur-sm flex flex-col z-10">
      {/* Brand */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-2.5 select-none">
          <div className="h-7 w-7 rounded-md bg-fg flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="1" y="3" width="2" height="8" rx="0.6" fill="#7C70FF" />
              <rect x="4.5" y="3" width="2" height="6" rx="0.6" fill="#7C70FF" fillOpacity="0.7" />
              <rect x="8" y="3" width="2" height="4" rx="0.6" fill="#7C70FF" fillOpacity="0.45" />
              <rect x="11.5" y="3" width="2" height="2.5" rx="0.6" fill="#7C70FF" fillOpacity="0.25" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-fg tracking-tight leading-none">Hiremind</div>
            <div className="text-3xs text-faint uppercase tracking-widest mt-1">Founder pod</div>
          </div>
        </div>
      </div>

      {/* Cmd+K trigger */}
      <div className="px-3 pb-3 pt-1">
        <button
          onClick={openCommandPalette}
          className="w-full h-8 px-2.5 rounded-md bg-subtle border border-border hover:border-border-strong text-faint hover:text-muted text-xs flex items-center justify-between gap-2 transition-colors duration-100 ease-soft focus-ring"
        >
          <span className="flex items-center gap-2">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <circle cx="7" cy="7" r="4.5" />
              <path d="m13.5 13.5-3-3" />
            </svg>
            <span>Search or run…</span>
          </span>
          <span className="kbd-pair">
            <kbd>⌘</kbd><kbd>K</kbd>
          </span>
        </button>
      </div>

      {/* Sections */}
      <div className="flex-1 overflow-y-auto scrollbar-thin pb-3">
        {sections.map((sec, sIdx) => (
          <div key={sIdx} className={cn("px-3", sIdx > 0 ? "mt-5" : "mt-1")}>
            {sec.label ? (
              <div className="label px-2 mb-1.5">{sec.label}</div>
            ) : null}
            <nav className="flex flex-col gap-px">
              {sec.items.map((it) => (
                <NavLink
                  key={it.to}
                  to={it.to}
                  end={it.end}
                  className={({ isActive }) =>
                    cn(
                      "group flex items-center gap-2.5 h-8 px-2 rounded-md text-sm",
                      "transition-colors duration-100 ease-soft focus-ring",
                      isActive
                        ? "bg-surface2 text-fg"
                        : "text-muted hover:bg-surface2/60 hover:text-fg",
                    )
                  }
                >
                  <span className="opacity-80">{it.icon}</span>
                  <span className="font-medium tracking-tight flex-1 min-w-0 truncate">{it.label}</span>
                  {it.kbd ? (
                    <span className="text-3xs text-faint opacity-0 group-hover:opacity-100 transition-opacity tracking-wider">
                      {it.kbd}
                    </span>
                  ) : null}
                </NavLink>
              ))}
            </nav>
          </div>
        ))}
      </div>

      {/* Footer — founder identity */}
      <div className="px-3 pb-3 pt-2 border-t border-border">
        <div className="flex items-center gap-2.5 px-1.5 py-1.5">
          <div className="h-6 w-6 rounded-full bg-accent-soft border border-accent-line flex items-center justify-center text-2xs font-semibold text-accent-2">
            {founderName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-fg leading-tight truncate">{founderName}</div>
            <div className="text-3xs text-faint truncate">Founder · approver</div>
          </div>
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
        </div>
      </div>
    </aside>
  );
}
