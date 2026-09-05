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
      // Dedicated test database — never the dev DB. See apps/api/scripts/dev-mysql-sandbox.sh
      // (creates both gym_dev and gym_test) or infrastructure/docker/docker-compose.yml.
      DATABASE_URL: "mysql://gym_app:gym_app_dev_pw@127.0.0.1:3307/gym_test",
    },
    // Module CRUD tests hit a real MySQL database and share tables — run test files serially
    // to avoid cross-file interference (e.g. two files both testing "list all organizations").
    fileParallelism: false,
  },
});
