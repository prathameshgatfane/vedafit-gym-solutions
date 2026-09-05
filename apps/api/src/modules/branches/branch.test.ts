import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../../test/helpers/app";
import { createTestOrganization } from "../../../test/helpers/fixtures";
import { ULID_LOWERCASE_PATTERN } from "../../lib/id";

describe("branches module", () => {
  it("creates a branch under an organization (happy path)", async () => {
    const org = await createTestOrganization();

    const res = await request(app)
      .post(`/api/v1/organizations/${org.id}/branches`)
      .send({ name: "Downtown Branch" });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toMatch(ULID_LOWERCASE_PATTERN);
    expect(res.body.data.organizationId).toBe(org.id);
    expect(res.body.data.status).toBe("ACTIVE");
  });

  it("returns 404 ORGANIZATION_NOT_FOUND when creating a branch under a nonexistent org", async () => {
    const res = await request(app)
      .post("/api/v1/organizations/not-a-real-org/branches")
      .send({ name: "Ghost Branch" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ORGANIZATION_NOT_FOUND");
  });

  it("scopes branch listing to the organization in the URL (org-scoping / no cross-tenant leakage)", async () => {
    const orgA = await createTestOrganization("Org A");
    const orgB = await createTestOrganization("Org B");

    await request(app).post(`/api/v1/organizations/${orgA.id}/branches`).send({ name: "A-Branch" });
    await request(app).post(`/api/v1/organizations/${orgB.id}/branches`).send({ name: "B-Branch" });

    const resA = await request(app).get(`/api/v1/organizations/${orgA.id}/branches`);

    expect(resA.status).toBe(200);
    expect(resA.body.data).toHaveLength(1);
    expect(resA.body.data[0].name).toBe("A-Branch");
    expect(resA.body.data.every((b: { organizationId: string }) => b.organizationId === orgA.id)).toBe(
      true,
    );
  });

  it("404s when fetching a branch id that belongs to a different organization", async () => {
    const orgA = await createTestOrganization("Org A");
    const orgB = await createTestOrganization("Org B");

    const branch = await request(app)
      .post(`/api/v1/organizations/${orgA.id}/branches`)
      .send({ name: "A-Only Branch" });

    const res = await request(app).get(
      `/api/v1/organizations/${orgB.id}/branches/${branch.body.data.id}`,
    );

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("BRANCH_NOT_FOUND");
  });

  it("updates a branch's status", async () => {
    const org = await createTestOrganization();
    const created = await request(app)
      .post(`/api/v1/organizations/${org.id}/branches`)
      .send({ name: "Will Update" });

    const res = await request(app)
      .patch(`/api/v1/organizations/${org.id}/branches/${created.body.data.id}`)
      .send({ status: "INACTIVE" });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("INACTIVE");
  });
});
