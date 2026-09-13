import type { Config } from "tailwindcss";

/** Same 1.14 brand palette as admin-web. Super-admin is a separate origin, not a second theme. */
const brand = {
  black: "#000000",
  "black-88": "#1F1F1F",
  green: "#C9FF1F",
  "green-muted": "#E9FFA5",
  white: "#FEF9F5",
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
