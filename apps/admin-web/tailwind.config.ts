import type { Config } from "tailwindcss";

/**
 * Brand color palette — see docs/architecture/DEVELOPMENT_PLAN.md Section 1.14.
 *
 * These are estimated from a visual reference, not eyedropper-exact — directionally correct,
 * not pixel-final. If/when exact values are confirmed, update ONLY this object; no component
 * should ever hardcode these hex values directly.
 *
 * Registered here in Phase 1; applied to real UI (login screen + app shell) as of Phase 3.
 */
const brand = {
  black: "#000000", // Primary background (dark)
  "black-88": "#1F1F1F", // Secondary dark surface
  green: "#C9FF1F", // Primary accent (brand green) — "Fit Green"
  "green-muted": "#E9FFA5", // Muted/tinted accent — "Fit Green 40%"
  white: "#FEF9F5", // Light surface / text-on-dark
} as const;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand,
      },
    },
  },
  plugins: [],
} satisfies Config;
