import type { Config } from "tailwindcss";

/**
 * Brand color palette — see docs/architecture/DEVELOPMENT_PLAN.md Section 1.14.
 *
 * These are estimated from a visual reference, not eyedropper-exact — directionally correct,
 * not pixel-final. If/when exact values are confirmed, update ONLY this object AND the matching
 * dark `:root` channels in `src/index.css`; no component should ever hardcode these hex values.
 *
 * Registered here in Phase 1; applied to real UI (login screen + app shell) as of Phase 3.
 * Slice A maps components to semantic `bg` / `fg` / `accent` tokens that read CSS variables.
 * `brand.*` stays as the named dark source so 1.14 is not overwritten.
 */
const brand = {
  black: "#000000", // Primary background (dark)
  "black-88": "#1F1F1F", // Secondary dark surface
  green: "#C9FF1F", // Primary accent (brand green) — "Fit Green" — fill only in light
  "green-muted": "#E9FFA5", // Muted/tinted accent — "Fit Green 40%"
  white: "#FEF9F5", // Light surface / text-on-dark
  // Solid muted text (not white@40%). Locked 2026-09-15 headed Chrome:
  // rgb(201, 196, 191) on rgb(0, 0, 0) = 12.13:1 (AA 4.5:1).
  "white-muted": "#C9C4BF",
} as const;

/** Tailwind opacity (`/10`, `/40`) needs space-separated channels, not hex. */
const rgb = (channel: string) => `rgb(var(${channel}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand,
        bg: rgb("--color-bg"),
        surface: rgb("--color-surface"),
        fg: rgb("--color-fg"),
        "fg-muted": rgb("--color-fg-muted"),
        border: "var(--color-border)",
        accent: rgb("--color-accent"),
        "accent-fg": rgb("--color-accent-fg"),
        "accent-text": rgb("--color-accent-text"),
        "accent-muted": rgb("--color-accent-muted"),
        danger: rgb("--color-danger"),
        warning: rgb("--color-warning"),
      },
    },
  },
  plugins: [],
} satisfies Config;
