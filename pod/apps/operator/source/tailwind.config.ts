import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Linear-inspired dark palette
        bg:         "#08090B",   // page
        surface:    "#0E0F12",   // panels
        surface2:   "#16171B",   // raised
        surface3:   "#1D1E23",   // hover
        subtle:     "#1A1B20",   // chip background
        border:     "#23252B",   // 1px lines
        "border-strong": "#2E303A",
        line:       "#1A1C20",
        fg:         "#F4F4F6",   // primary text
        muted:      "#A6A7AE",
        faint:      "#5C5E69",
        dim:        "#3A3C45",
        accent:     "#7C70FF",   // signature indigo-violet (a touch brighter than #5E6AD2)
        "accent-2": "#9486FF",
        "accent-soft": "#1A1A3D",
        "accent-line": "#3A3870",
        success:    "#4ADE80",
        "success-soft": "#0F2A1A",
        warning:    "#FBBF24",
        "warning-soft": "#2A2010",
        danger:     "#F87171",
        "danger-soft": "#2A1414",
        info:       "#60A5FA",
        "info-soft": "#101E2E",
        // semantic
        ink:        "#020203",
        glow:       "#7C70FF",
      },
      fontFamily: {
        sans: [
          "Inter Variable",
          "Inter Tight",
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "system-ui",
          "sans-serif",
        ],
        // We keep a light serif option for ONE single hero moment per page
        display: ["Inter Variable", "Inter Tight", "Inter", "sans-serif"],
        mono: [
          "Berkeley Mono",
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      fontSize: {
        "3xs": ["9.5px",  { lineHeight: "1.5" }],
        "2xs": ["10.5px", { lineHeight: "1.45" }],
        xs:    ["11.5px", { lineHeight: "1.5" }],
        sm:    ["12.5px", { lineHeight: "1.55" }],
        base:  ["13.5px", { lineHeight: "1.6" }],
        md:    ["14.5px", { lineHeight: "1.55" }],
        lg:    ["16px",   { lineHeight: "1.5" }],
        xl:    ["19px",   { lineHeight: "1.35" }],
        "2xl": ["24px",   { lineHeight: "1.25" }],
        "3xl": ["32px",   { lineHeight: "1.15" }],
        "4xl": ["42px",   { lineHeight: "1.08" }],
        "5xl": ["56px",   { lineHeight: "1.02" }],
      },
      borderRadius: {
        xs:  "4px",
        sm:  "6px",
        DEFAULT: "8px",
        md:  "10px",
        lg:  "12px",
        xl:  "16px",
      },
      boxShadow: {
        // No big drop shadows — Linear stays flat. Only sharp inner rings.
        soft:    "0 1px 0 0 rgba(255, 255, 255, 0.03), 0 0 0 1px rgba(255, 255, 255, 0.025)",
        card:    "0 1px 0 0 rgba(255, 255, 255, 0.035), 0 0 0 1px rgba(255, 255, 255, 0.04)",
        raised:  "0 16px 40px -16px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.06)",
        popover: "0 24px 48px -16px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.08)",
        focus:   "0 0 0 2px rgba(124, 112, 255, 0.45), 0 0 0 3.5px rgba(124, 112, 255, 0.12)",
        glow:    "0 0 0 1px rgba(124, 112, 255, 0.4), 0 6px 20px -6px rgba(124, 112, 255, 0.5)",
        inset:   "inset 0 0 0 1px rgba(255, 255, 255, 0.06)",
      },
      letterSpacing: {
        tightest: "-0.025em",
        tighter:  "-0.018em",
        tight:    "-0.012em",
        wider:    "0.04em",
        widest:   "0.10em",
      },
      transitionTimingFunction: {
        soft: "cubic-bezier(0.32, 0.72, 0, 1)",
        snappy: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
      animation: {
        "fade-in": "fadeIn 120ms ease-out",
        "pop-in":  "popIn 180ms cubic-bezier(0.32, 0.72, 0, 1)",
        "slide-down": "slideDown 160ms cubic-bezier(0.32, 0.72, 0, 1)",
        shimmer:  "shimmer 2.2s linear infinite",
      },
      keyframes: {
        fadeIn:    { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        popIn:     { "0%": { opacity: "0", transform: "translateY(6px) scale(0.985)" },
                     "100%": { opacity: "1", transform: "translateY(0) scale(1)" } },
        slideDown: { "0%": { opacity: "0", transform: "translateY(-4px)" },
                     "100%": { opacity: "1", transform: "translateY(0)" } },
        shimmer:   { "0%": { backgroundPosition: "0% 0%" },
                     "100%": { backgroundPosition: "200% 0%" } },
      },
    },
  },
  plugins: [],
} satisfies Config;
