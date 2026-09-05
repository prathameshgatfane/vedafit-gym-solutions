import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../../test/helpers/app";
import { createTestPermission, uniqueSuffix } from "../../../test/helpers/fixtures";

describe("permissions module (read-only catalog)", () => {
  it("lists permissions filtered by search", async () => {
    const keyPrefix = `catalog-${uniqueSuffix()}`;
    const permission = await createTestPermission(keyPrefix);

    const res = await request(app).get("/api/v1/permissions").query({ search: keyPrefix });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(permission.id);
    expect(res.body.data[0].key).toBe(permission.key);
  });

  it("gets a permission by id", async () => {
    const permission = await createTestPermission();

    const res = await request(app).get(`/api/v1/permissions/${permission.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.key).toBe(permission.key);
  });

  it("returns 404 PERMISSION_NOT_FOUND for an unknown id", async () => {
    const res = await request(app).get("/api/v1/permissions/not-a-real-permission");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PERMISSION_NOT_FOUND");
  });

  it("has no write endpoints — permissions are a seeded system catalog", async () => {
    const res = await request(app).post("/api/v1/permissions").send({ key: "hacked.permission" });

    // No POST route registered under /permissions at all -> falls through to the global 404.
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
