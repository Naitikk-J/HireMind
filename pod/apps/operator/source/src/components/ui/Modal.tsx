import { useEffect, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Modal({
  open,
  onClose,
  children,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  size?: "md" | "lg" | "xl";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center px-4 sm:px-6 pt-[10vh] sm:pt-0"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-ink/70 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        aria-hidden
      />
      <div
        className={cn(
          "relative bg-surface border border-border-strong rounded-lg shadow-popover w-full animate-pop-in",
          size === "xl" ? "max-w-4xl" : size === "lg" ? "max-w-2xl" : "max-w-md",
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function ModalHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="px-6 pt-5 pb-4 border-b border-border">
      <h2 className="text-md font-semibold text-fg leading-tight tracking-tight">{title}</h2>
      {subtitle ? <p className="text-xs text-muted mt-1.5 leading-relaxed">{subtitle}</p> : null}
    </div>
  );
}

export function ModalBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("p-6", className)}>{children}</div>;
}

export function ModalFooter({ children }: { children: ReactNode }) {
  return (
    <div className="px-6 py-3.5 border-t border-border flex items-center justify-end gap-2 bg-bg/40">
      {children}
    </div>
  );
}
