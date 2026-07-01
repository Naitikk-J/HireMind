import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "link" | "accent";
type Size = "xs" | "sm" | "md" | "lg";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  kbd?: string;
}

const VARIANT = {
  primary:
    "bg-fg text-bg hover:bg-white active:bg-fg/90 disabled:bg-surface3 disabled:text-faint disabled:cursor-not-allowed",
  accent:
    "bg-accent text-white hover:bg-accent-2 active:bg-accent disabled:opacity-40 disabled:cursor-not-allowed shadow-glow",
  secondary:
    "bg-surface2 text-fg border border-border hover:border-border-strong hover:bg-surface3 active:bg-surface3 disabled:opacity-40 disabled:cursor-not-allowed",
  ghost:
    "bg-transparent text-muted hover:text-fg hover:bg-surface2 active:bg-surface2/70 disabled:opacity-40 disabled:cursor-not-allowed",
  danger:
    "bg-danger text-white hover:bg-danger/90 active:bg-danger/95 disabled:opacity-40 disabled:cursor-not-allowed",
  link:
    "bg-transparent text-fg underline underline-offset-4 decoration-border hover:decoration-fg p-0 h-auto",
} satisfies Record<Variant, string>;

const SIZE = {
  xs: "h-6 px-2 text-2xs rounded-sm gap-1",
  sm: "h-7 px-2.5 text-xs rounded-md gap-1.5",
  md: "h-8 px-3 text-sm rounded-md gap-2",
  lg: "h-10 px-4 text-md rounded-md gap-2.5",
} satisfies Record<Size, string>;

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "secondary", size = "md", iconLeft, iconRight, kbd, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center font-medium tracking-tight",
        "transition-colors duration-100 ease-soft",
        "focus-ring whitespace-nowrap",
        variant !== "link" && SIZE[size],
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {iconLeft ? <span className="-ml-0.5 flex">{iconLeft}</span> : null}
      <span>{children}</span>
      {iconRight ? <span className="-mr-0.5 flex">{iconRight}</span> : null}
      {kbd ? <kbd className="ml-1.5 -mr-0.5">{kbd}</kbd> : null}
    </button>
  );
});
