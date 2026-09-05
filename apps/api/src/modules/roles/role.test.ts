import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../../test/helpers/app";
import { createTestOrganization, createTestPermission } from "../../../test/helpers/fixtures";

describe("roles module", () => {
  it("creates a role with an initial permission set (happy path)", async () => {
    const org = await createTestOrganization();
    const perm1 = await createTestPermission("members.create");
    const perm2 = await createTestPermission("members.view");

    const res = await request(app)
      .post(`/api/v1/organizations/${org.id}/roles`)
      .send({ name: "Front Desk", permissionKeys: [perm1.key, perm2.key] });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe("Front Desk");
    expect(res.body.data.permissionKeys.sort()).toEqual([perm1.key, perm2.key].sort());
  });

  it("rejects an unknown permission key with 400 PERMISSION_NOT_FOUND", async () => {
    const org = await createTestOrganization();

    const res = await request(app)
      .post(`/api/v1/organizations/${org.id}/roles`)
      .send({ name: "Bad Role", permissionKeys: ["totally.made.up.key"] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PERMISSION_NOT_FOUND");
  });

  it("rejects a duplicate role name within the same organization with 409", async () => {
    const org = await createTestOrganization();
    await request(app).post(`/api/v1/organizations/${org.id}/roles`).send({ name: "Manager" });

    const res = await request(app)
      .post(`/api/v1/organizations/${org.id}/roles`)
      .send({ name: "Manager" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DUPLICATE_ROLE_NAME");
  });

  it("allows the same role name in a different organization", async () => {
    const orgA = await createTestOrganization("Org A");
    const orgB = await createTestOrganization("Org B");

    const resA = await request(app)
      .post(`/api/v1/organizations/${orgA.id}/roles`)
      .send({ name: "Manager" });
    const resB = await request(app)
      .post(`/api/v1/organizations/${orgB.id}/roles`)
      .send({ name: "Manager" });

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
  });

  it("replaces a role's permission set on update", async () => {
    const org = await createTestOrganization();
    const perm1 = await createTestPermission("payments.create");
    const perm2 = await createTestPermission("payments.view");

    const created = await request(app)
      .post(`/api/v1/organizations/${org.id}/roles`)
      .send({ name: "Cashier", permissionKeys: [perm1.key] });

    const res = await request(app)
      .patch(`/api/v1/organizations/${org.id}/roles/${created.body.data.id}`)
      .send({ permissionKeys: [perm2.key] });

    expect(res.status).toBe(200);
    expect(res.body.data.permissionKeys).toEqual([perm2.key]);
  });

  it("gets a role by id with its permissions", async () => {
    const org = await createTestOrganization();
    const perm = await createTestPermission("reports.view");
    const created = await request(app)
      .post(`/api/v1/organizations/${org.id}/roles`)
      .send({ name: "Analyst", permissionKeys: [perm.key] });

    const res = await request(app).get(
      `/api/v1/organizations/${org.id}/roles/${created.body.data.id}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.permissionKeys).toEqual([perm.key]);
  });
});
