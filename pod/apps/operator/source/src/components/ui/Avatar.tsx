import { cn, initials } from "@/lib/utils";

// Linear-style: filled, slightly desaturated, no border
const PALETTE = [
  "bg-[#3A3870] text-[#C8C2FF]",  // violet
  "bg-[#1F4A33] text-[#9BE6B5]",  // green
  "bg-[#4D2E5C] text-[#E5BFFF]",  // purple
  "bg-[#3D3A1F] text-[#E5D38E]",  // amber
  "bg-[#1F3A4D] text-[#A5D3FF]",  // sky
  "bg-[#4B2828] text-[#FFB5B5]",  // red
  "bg-[#2E4A4D] text-[#9EDDDF]",  // teal
];

function hashIndex(name: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(h) % mod;
}

export function Avatar({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const dimensions = {
    xs: "h-5 w-5 text-[9px]",
    sm: "h-6 w-6 text-2xs",
    md: "h-8 w-8 text-xs",
    lg: "h-11 w-11 text-sm",
    xl: "h-14 w-14 text-md",
  }[size];
  const tint = PALETTE[hashIndex(name, PALETTE.length)];
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full font-semibold tracking-tight select-none",
        tint,
        dimensions,
        className,
      )}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}
