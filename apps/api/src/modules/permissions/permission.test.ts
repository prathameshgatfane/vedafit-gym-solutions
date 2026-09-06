import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../../test/helpers/app";
import {
  bearer,
  createActorInNewTenant,
  type TestActor,
} from "../../../test/helpers/auth";
import { createTestPermission, uniqueSuffix } from "../../../test/helpers/fixtures";

/**
 * The catalog is global rather than tenant data, so the router applies `authenticate` but no
 * `tenantScope` — any signed-in user may read it, since the admin UI needs the full list to
 * render the role editor.
 */
let reader: TestActor;

beforeAll(async () => {
  reader = await createActorInNewTenant("RECEPTIONIST", "PermCatalogOrg");
});

describe("permissions module (read-only catalog)", () => {
  it("lists permissions filtered by search", async () => {
    const keyPrefix = `catalog-${uniqueSuffix()}`;
    const permission = await createTestPermission(keyPrefix);

    const res = await request(app)
      .get("/api/v1/permissions")
      .query({ search: keyPrefix })
      .set(...bearer(reader));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(permission.id);
    expect(res.body.data[0].key).toBe(permission.key);
  });

  it("gets a permission by id", async () => {
    const permission = await createTestPermission();

    const res = await request(app)
      .get(`/api/v1/permissions/${permission.id}`)
      .set(...bearer(reader));

    expect(res.status).toBe(200);
    expect(res.body.data.key).toBe(permission.key);
  });

  it("returns 404 PERMISSION_NOT_FOUND for an unknown id", async () => {
    const res = await request(app)
      .get("/api/v1/permissions/not-a-real-permission")
      .set(...bearer(reader));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PERMISSION_NOT_FOUND");
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/api/v1/permissions");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("has no write endpoints — permissions are a seeded system catalog", async () => {
    const res = await request(app)
      .post("/api/v1/permissions")
      .set(...bearer(reader))
      .send({ key: "hacked.permission" });

    // No POST route registered under /permissions at all -> falls through to the global 404.
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
