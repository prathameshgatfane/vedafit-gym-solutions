import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../../test/helpers/app";
import { bearer, createActor, createTestTenant } from "../../../test/helpers/auth";
import { ULID_LOWERCASE_PATTERN } from "../../lib/id";

describe("branches module", () => {
  it("creates a branch under an organization (happy path)", async () => {
    const tenant = await createTestTenant("BranchOrg");
    const owner = await createActor(tenant);

    const res = await request(app)
      .post(`/api/v1/organizations/${tenant.organization.id}/branches`)
      .set(...bearer(owner))
      .send({ name: "Downtown Branch" });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toMatch(ULID_LOWERCASE_PATTERN);
    expect(res.body.data.organizationId).toBe(tenant.organization.id);
    expect(res.body.data.status).toBe("ACTIVE");
  });

  it("rejects a create against a nonexistent organization before the service runs", async () => {
    // Pre-Phase 2 this surfaced as 404 ORGANIZATION_NOT_FOUND. Now tenant.middleware compares the
    // URL's org against the JWT first, so a bogus org id is a tenancy violation, not a lookup miss —
    // and the API no longer reveals whether an arbitrary org id exists.
    const owner = await createActor(await createTestTenant("GhostOrg"));

    const res = await request(app)
      .post("/api/v1/organizations/not-a-real-org/branches")
      .set(...bearer(owner))
      .send({ name: "Ghost Branch" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ORG_MISMATCH");
  });

  it("scopes branch listing to the caller's organization (no cross-tenant leakage)", async () => {
    const tenantA = await createTestTenant("ListOrgA");
    const tenantB = await createTestTenant("ListOrgB");
    const ownerA = await createActor(tenantA);
    const ownerB = await createActor(tenantB);

    await request(app)
      .post(`/api/v1/organizations/${tenantA.organization.id}/branches`)
      .set(...bearer(ownerA))
      .send({ name: "A-Branch" });
    await request(app)
      .post(`/api/v1/organizations/${tenantB.organization.id}/branches`)
      .set(...bearer(ownerB))
      .send({ name: "B-Branch" });

    const resA = await request(app)
      .get(`/api/v1/organizations/${tenantA.organization.id}/branches`)
      .set(...bearer(ownerA));

    expect(resA.status).toBe(200);
    const names = resA.body.data.map((b: { name: string }) => b.name);
    expect(names).toContain("A-Branch");
    expect(names).not.toContain("B-Branch");
    expect(
      resA.body.data.every(
        (b: { organizationId: string }) => b.organizationId === tenantA.organization.id,
      ),
    ).toBe(true);
  });

  it("404s on a branch id belonging to another organization, even from the caller's own URL", async () => {
    const tenantA = await createTestTenant("ScopeOrgA");
    const tenantB = await createTestTenant("ScopeOrgB");
    const ownerA = await createActor(tenantA);

    // URL org matches the token, so tenant.middleware lets this through — it's the service's
    // org-scoped lookup that has to refuse org B's branch id.
    const res = await request(app)
      .get(`/api/v1/organizations/${tenantA.organization.id}/branches/${tenantB.branch.id}`)
      .set(...bearer(ownerA));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("BRANCH_NOT_FOUND");
  });

  it("updates a branch's status", async () => {
    const tenant = await createTestTenant("UpdateBranchOrg");
    const owner = await createActor(tenant);

    const created = await request(app)
      .post(`/api/v1/organizations/${tenant.organization.id}/branches`)
      .set(...bearer(owner))
      .send({ name: "Will Update" });

    const res = await request(app)
      .patch(`/api/v1/organizations/${tenant.organization.id}/branches/${created.body.data.id}`)
      .set(...bearer(owner))
      .send({ status: "INACTIVE" });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("INACTIVE");
  });
});
