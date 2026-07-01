import { useEffect, useState, type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { CommandPalette } from "../CommandPalette";

export function AppShell({ children }: { children: ReactNode }) {
  const [cmdOpen, setCmdOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
      if (e.key === "Escape" && cmdOpen) setCmdOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cmdOpen]);

  return (
    <div className="h-full flex bg-bg top-wash grain">
      <Sidebar openCommandPalette={() => setCmdOpen(true)} />
      <main className="flex-1 min-w-0 flex flex-col relative z-[2]">{children}</main>
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
    </div>
  );
}
