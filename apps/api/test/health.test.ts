import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";

describe("GET /api/v1/health", () => {
  it("returns 200 with the standard success envelope", async () => {
    const app = createApp();

    const res = await request(app).get("/api/v1/health");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: { status: "ok" },
    });
    expect(typeof res.body.data.uptimeSeconds).toBe("number");
  });
});

describe("unknown routes", () => {
  it("returns a standard 404 error envelope", async () => {
    const app = createApp();

    const res = await request(app).get("/api/v1/does-not-exist");

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: "NOT_FOUND" },
    });
  });
});
