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
      CORS_ORIGIN: "http://localhost:5173,http://localhost:5174",
      LOG_LEVEL: "silent",
      // Dedicated test database — never the dev DB. See apps/api/scripts/dev-mysql-sandbox.sh
      // (creates both gym_dev and gym_test) or infrastructure/docker/docker-compose.yml.
      // An externally-set DATABASE_URL wins so CI can point at its own service container.
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "mysql://gym_app:gym_app_dev_pw@127.0.0.1:3307/gym_test",
      // Auth secrets are test-only fixtures; production values come from the deploy env.
      JWT_SECRET: "test-jwt-secret-not-used-outside-vitest-0123456789",
      JWT_ACCESS_TTL: "15m",
      REFRESH_TOKEN_TTL_DAYS: "30",
      PASSWORD_RESET_TTL_MINUTES: "30",
      // The whole suite shares one source IP, so the coarse global limiter has to be out of the
      // way. The login limiter is deliberately left at its real value — auth.test.ts asserts it.
      GLOBAL_RATE_LIMIT_MAX: "1000000",
      REDIS_URL: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
      QUEUE_PREFIX: "gym-test",
      NOTIFICATION_BACKOFF_MS: "1",
      NOTIFICATION_ATTEMPTS: "3",
    },
    // Module CRUD tests hit a real MySQL database and share tables — run test files serially
    // to avoid cross-file interference (e.g. two files both testing "list all organizations").
    fileParallelism: false,
    // The 5s default assumes pure-logic tests. These do real MySQL round trips and, on the auth
    // paths, deliberately-slow bcrypt hashing; a login test can pass alone and time out when
    // `pnpm -r test` runs admin-web's suite on the same cores. Raised so a busy machine reports
    // real failures rather than contention.
    testTimeout: 30_000,
  },
});
