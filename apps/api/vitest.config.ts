import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // Hermetic env for tests — does not depend on a developer's local .env file existing,
    // so `pnpm test` behaves identically in CI and locally.
    env: {
      NODE_ENV: "test",
      PORT: "4000",
      CORS_ORIGIN: "http://localhost:5173",
      LOG_LEVEL: "silent",
    },
  },
});
