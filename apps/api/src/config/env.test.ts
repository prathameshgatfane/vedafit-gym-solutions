import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";

/** The minimum set of vars that must be present for `loadEnv` to succeed. */
const requiredEnv = {
  PORT: "4000",
  CORS_ORIGIN: "http://localhost:5173",
  DATABASE_URL: "mysql://user:pass@localhost:3307/db",
  JWT_SECRET: "a-secret-that-is-at-least-32-characters-long",
};

describe("loadEnv", () => {
  it("throws a clear, readable error when a required var is missing", () => {
    expect(() => loadEnv({})).toThrowError(/CORS_ORIGIN|PORT/);
  });

  it("lists every missing/invalid var in one error, not just the first", () => {
    try {
      loadEnv({});
      expect.fail("loadEnv should have thrown");
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain("PORT");
      expect(message).toContain("CORS_ORIGIN");
      expect(message).toContain("JWT_SECRET");
    }
  });

  it("succeeds and applies defaults when all required vars are present", () => {
    const env = loadEnv(requiredEnv);

    expect(env.PORT).toBe(4000);
    expect(env.CORS_ORIGIN).toBe("http://localhost:5173");
    expect(env.DATABASE_URL).toBe("mysql://user:pass@localhost:3307/db");
    expect(env.NODE_ENV).toBe("development"); // default applied
    expect(env.LOG_LEVEL).toBe("info"); // default applied
    expect(env.JWT_ACCESS_TTL).toBe("15m"); // default applied
    expect(env.REFRESH_TOKEN_TTL_DAYS).toBe(30); // default applied
    expect(env.SIGNUP_RATE_LIMIT_MAX).toBe(5);
    expect(env.SIGNUP_RATE_LIMIT_WINDOW_MINUTES).toBe(15);
    expect(env.SAAS_TRIAL_DAYS).toBe(14);
    expect(env.REDIS_URL).toBe("redis://127.0.0.1:6379");
    expect(env.NOTIFICATION_ATTEMPTS).toBe(3);
    expect(env.NIGHTLY_LOCAL_HOUR).toBe(21);
  });

  it("rejects a non-numeric PORT", () => {
    expect(() => loadEnv({ ...requiredEnv, PORT: "not-a-number" })).toThrow();
  });

  it("rejects a DATABASE_URL that isn't a mysql:// connection string", () => {
    expect(() =>
      loadEnv({ ...requiredEnv, DATABASE_URL: "postgres://user:pass@localhost:5432/db" }),
    ).toThrow(/DATABASE_URL/);
  });

  it("rejects a JWT_SECRET shorter than 32 characters", () => {
    expect(() => loadEnv({ ...requiredEnv, JWT_SECRET: "too-short" })).toThrow(/JWT_SECRET/);
  });

  it("rejects a credentialed wildcard CORS_ORIGIN of *", () => {
    expect(() => loadEnv({ ...requiredEnv, CORS_ORIGIN: "*" })).toThrow(/CORS_ORIGIN/);
  });

  it("rejects * as one entry in a comma-separated CORS allowlist", () => {
    expect(() =>
      loadEnv({ ...requiredEnv, CORS_ORIGIN: "http://localhost:5173, * " }),
    ).toThrow(/CORS_ORIGIN/);
  });

  it("accepts a comma-separated allowlist of real browser origins", () => {
    const env = loadEnv({
      ...requiredEnv,
      CORS_ORIGIN:
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://localhost:8080",
    });
    expect(env.CORS_ORIGIN).toContain("5174");
    expect(env.CORS_ORIGIN).toContain("8080");
  });
});
