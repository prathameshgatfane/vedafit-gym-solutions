import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../../test/helpers/app";
import { bearer, createActor, createTestTenant } from "../../../test/helpers/auth";
import { uniqueSuffix } from "../../../test/helpers/fixtures";
import { ULID_LOWERCASE_PATTERN } from "../../lib/id";
import { organizationService } from "./organization.service";

const BASE = "/api/v1/organizations";

/**
 * Creating and listing organizations are exercised at the service layer rather than over HTTP:
 * as of Phase 2 there is no `POST /organizations` or `GET /organizations` route. Orgs are
 * bootstrapped by the seed script until Phase 15's super-admin layer (Locked Decision 1.7), and a
 * cross-org list endpoint would contradict the tenancy rule in Section 6. See Section 9 (2026-09-06).
 */
describe("organizationService (no tenant-facing create/list route)", () => {
  it("creates an organization with a lowercase-ULID id (happy path)", async () => {
    const suffix = uniqueSuffix();
    const org = await organizationService.create({
      name: `Acme Gym ${suffix}`,
      slug: `acme-gym-${suffix}`,
      email: `acme-${suffix}@example.test`,
    });

    expect(org.id).toMatch(ULID_LOWERCASE_PATTERN);
    expect(org.name).toBe(`Acme Gym ${suffix}`);
    expect(org.status).toBe("ACTIVE");
  });

  it("rejects a duplicate slug with DUPLICATE_ORGANIZATION_SLUG", async () => {
    const suffix = uniqueSuffix();
    const payload = {
      name: `Dup Gym ${suffix}`,
      slug: `dup-gym-${suffix}`,
      email: `dup-${suffix}@example.test`,
    };

    await organizationService.create(payload);

    await expect(
      organizationService.create({ ...payload, name: "Different name, same slug" }),
    ).rejects.toMatchObject({ statusCode: 409, code: "DUPLICATE_ORGANIZATION_SLUG" });
  });

  it("lists organizations filtered by search, with correct pagination shape", async () => {
    const suffix = uniqueSuffix();
    const slug = `searchable-${suffix}`;
    await organizationService.create({
      name: `Searchable Gym ${suffix}`,
      slug,
      email: `searchable-${suffix}@example.test`,
    });

    const { items, pagination } = await organizationService.list({
      search: slug,
      page: 1,
      limit: 10,
      sortBy: "createdAt",
      sortOrder: "desc",
    });

    expect(items).toHaveLength(1);
    expect(items[0]!.slug).toBe(slug);
    expect(pagination).toEqual({ page: 1, limit: 10, total: 1, totalPages: 1 });
  });

  it("has no POST / or GET / route", async () => {
    const owner = await createActor(await createTestTenant("NoRouteOrg"));

    const post = await request(app)
      .post(BASE)
      .set(...bearer(owner))
      .send({ name: "Nope", slug: `nope-${uniqueSuffix()}`, email: "nope@example.test" });
    expect(post.status).toBe(404);

    const list = await request(app)
      .get(BASE)
      .set(...bearer(owner));
    expect(list.status).toBe(404);
  });
});

describe("organizations module (HTTP)", () => {
  it("gets the caller's own organization by id", async () => {
    const tenant = await createTestTenant("GetMeOrg");
    const owner = await createActor(tenant);

    const res = await request(app)
      .get(`${BASE}/${tenant.organization.id}`)
      .set(...bearer(owner));

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(tenant.organization.id);
  });

  it("updates the organization's name and status", async () => {
    const tenant = await createTestTenant("UpdateOrg");
    const owner = await createActor(tenant);
    const suffix = uniqueSuffix();

    const res = await request(app)
      .patch(`${BASE}/${tenant.organization.id}`)
      .set(...bearer(owner))
      .send({ name: `After ${suffix}`, status: "SUSPENDED" });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe(`After ${suffix}`);
    expect(res.body.data.status).toBe("SUSPENDED");
  });

  it("returns 403 ORG_MISMATCH rather than 404 for an unknown organization id", async () => {
    // With tenant.middleware in place, an id that isn't the caller's own is rejected before the
    // service ever looks it up — so "does this org exist?" is no longer an observable question.
    const owner = await createActor(await createTestTenant("UnknownIdOrg"));

    const res = await request(app)
      .get(`${BASE}/not-a-real-id`)
      .set(...bearer(owner));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ORG_MISMATCH");
  });
});
