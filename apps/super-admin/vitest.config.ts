import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
    // `e2e/` is excluded: headed Chrome against a real API, run via `pnpm e2e`.
    include: ["src/**/*.test.{ts,tsx}"],
    env: {
      VITE_API_URL: "http://localhost:4000/api/v1",
    },
  },
});
