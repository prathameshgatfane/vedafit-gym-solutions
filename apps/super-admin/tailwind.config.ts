import type { Config } from "tailwindcss";

/** Same 1.14 brand palette as admin-web. Super-admin is a separate origin, not a second theme. */
const brand = {
  black: "#000000",
  "black-88": "#1F1F1F",
  green: "#C9FF1F",
  "green-muted": "#E9FFA5",
  white: "#FEF9F5",
  // Same locked muted token as admin-web (Slice 0, 2026-09-15 headed Chrome: 12.13:1 on black).
  "white-muted": "#C9C4BF",
} as const;

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
