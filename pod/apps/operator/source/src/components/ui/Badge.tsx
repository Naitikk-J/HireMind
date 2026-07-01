import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "muted" | "info";

const TONE = {
  neutral: "bg-surface2 text-fg border border-border",
  accent:  "bg-accent-soft text-accent-2 border border-accent-line",
  success: "bg-success-soft text-success border border-success/20",
  warning: "bg-warning-soft text-warning border border-warning/20",
  danger:  "bg-danger-soft text-danger border border-danger/20",
  muted:   "bg-subtle text-muted border border-border",
  info:    "bg-info-soft text-info border border-info/20",
} satisfies Record<Tone, string>;

const DOT = {
  neutral: "bg-fg",
  accent:  "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger:  "bg-danger",
  muted:   "bg-faint",
  info:    "bg-info",
} satisfies Record<Tone, string>;

export function Badge({
  tone = "neutral",
  children,
  dot = false,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-2xs font-medium tracking-tight whitespace-nowrap",
        TONE[tone],
        className,
      )}
    >
      {dot ? <span className={cn("inline-block h-1.5 w-1.5 rounded-full", DOT[tone])} /> : null}
      {children}
    </span>
  );
}
