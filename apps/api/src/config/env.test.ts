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
    expect(env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS).toBe(5); // default applied
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
});
