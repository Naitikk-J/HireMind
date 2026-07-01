import { cn } from "@/lib/utils";

export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      style={{ width: size, height: size, borderWidth: Math.max(1.5, size / 9) }}
      className={cn(
        "inline-block rounded-full border-fg/15 border-t-fg/85 animate-spin",
        className,
      )}
    />
  );
}
