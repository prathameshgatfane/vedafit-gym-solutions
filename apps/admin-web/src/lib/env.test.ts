import { describe, expect, it } from "vitest";
import { getEnv } from "./env";

describe("getEnv", () => {
  it("throws a clear, readable error when VITE_API_URL is missing", () => {
    expect(() => getEnv({})).toThrowError(/VITE_API_URL/);
  });

  it("throws when VITE_API_URL is not a valid URL", () => {
    expect(() => getEnv({ VITE_API_URL: "not-a-url" })).toThrow();
  });

  it("succeeds when VITE_API_URL is a valid URL", () => {
    const env = getEnv({ VITE_API_URL: "http://localhost:4000" });
    expect(env.VITE_API_URL).toBe("http://localhost:4000");
  });
});
