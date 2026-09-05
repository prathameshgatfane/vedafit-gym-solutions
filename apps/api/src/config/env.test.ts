import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";

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
    }
  });

  it("succeeds and applies defaults when all required vars are present", () => {
    const env = loadEnv({
      PORT: "4000",
      CORS_ORIGIN: "http://localhost:5173",
      DATABASE_URL: "mysql://user:pass@localhost:3307/db",
    });

    expect(env.PORT).toBe(4000);
    expect(env.CORS_ORIGIN).toBe("http://localhost:5173");
    expect(env.DATABASE_URL).toBe("mysql://user:pass@localhost:3307/db");
    expect(env.NODE_ENV).toBe("development"); // default applied
    expect(env.LOG_LEVEL).toBe("info"); // default applied
  });

  it("rejects a non-numeric PORT", () => {
    expect(() =>
      loadEnv({
        PORT: "not-a-number",
        CORS_ORIGIN: "http://localhost:5173",
        DATABASE_URL: "mysql://user:pass@localhost:3307/db",
      }),
    ).toThrow();
  });

  it("rejects a DATABASE_URL that isn't a mysql:// connection string", () => {
    expect(() =>
      loadEnv({
        PORT: "4000",
        CORS_ORIGIN: "http://localhost:5173",
        DATABASE_URL: "postgres://user:pass@localhost:5432/db",
      }),
    ).toThrow(/DATABASE_URL/);
  });
});
