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
    const env = loadEnv({ PORT: "4000", CORS_ORIGIN: "http://localhost:5173" });

    expect(env.PORT).toBe(4000);
    expect(env.CORS_ORIGIN).toBe("http://localhost:5173");
    expect(env.NODE_ENV).toBe("development"); // default applied
    expect(env.LOG_LEVEL).toBe("info"); // default applied
  });

  it("rejects a non-numeric PORT", () => {
    expect(() =>
      loadEnv({ PORT: "not-a-number", CORS_ORIGIN: "http://localhost:5173" }),
    ).toThrow();
  });
});
