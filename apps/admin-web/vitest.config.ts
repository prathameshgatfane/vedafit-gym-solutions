import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
    // `e2e/` is deliberately excluded: those specs drive a real Chrome against a real API and
    // are run on demand via `pnpm e2e`, not as part of `pnpm test` or CI.
    include: ["src/**/*.test.{ts,tsx}"],
    // Modules read `import.meta.env` at import time; without this, importing api-client in a
    // test would throw the env-validation error before a single assertion runs.
    env: {
      VITE_API_URL: "http://localhost:4000/api/v1",
    },
  },
});
