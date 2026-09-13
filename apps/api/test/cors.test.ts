import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";

/**
 * Vitest sets CORS_ORIGIN to admin-web + super-admin localhost (vitest.config.ts).
 * These tests hit createApp() — no database — and only assert CORS headers.
 */
const ALLOWED_A = "http://localhost:5173";
const ALLOWED_B = "http://localhost:5174";
const UNLISTED = "https://evil.example";

describe("CORS allowlist (Phase 15.13)", () => {
  const app = createApp();

  it("reflects an allowed origin and allows credentials", async () => {
    const res = await request(app).get("/api/v1/health").set("Origin", ALLOWED_A);

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED_A);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("accepts a second configured allowed origin", async () => {
    const res = await request(app).get("/api/v1/health").set("Origin", ALLOWED_B);

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED_B);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("does not reflect an unlisted origin", async () => {
    const res = await request(app).get("/api/v1/health").set("Origin", UNLISTED);

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
