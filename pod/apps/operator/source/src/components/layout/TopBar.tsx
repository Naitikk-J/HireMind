import { type ReactNode } from "react";

export function TopBar({
  title,
  eyebrow,
  subtitle,
  actions,
}: {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="px-7 pt-5 pb-4 border-b border-border bg-bg/80 backdrop-blur-md sticky top-0 z-10">
      <div className="flex items-center justify-between gap-6 min-h-[36px]">
        <div className="min-w-0 flex items-center gap-3">
          {eyebrow ? (
            <>
              <span className="text-xs text-muted font-medium tracking-tight">{eyebrow}</span>
              <span className="text-faint">/</span>
            </>
          ) : null}
          <h1 className="text-md font-semibold text-fg leading-none tracking-tight truncate">{title}</h1>
        </div>
        {actions ? (
          <div className="flex items-center gap-2 shrink-0">{actions}</div>
        ) : null}
      </div>
      {subtitle ? (
        <p className="text-xs text-muted mt-2 max-w-2xl text-pretty leading-relaxed">{subtitle}</p>
      ) : null}
    </header>
  );
}
