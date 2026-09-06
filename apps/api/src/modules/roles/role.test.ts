import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../../test/helpers/app";
import { bearer, createActor, createTestTenant } from "../../../test/helpers/auth";
import { createTestPermission, uniqueSuffix } from "../../../test/helpers/fixtures";

/**
 * The roles module sits behind `roles.manage`, which only OWNER holds (Section 4.2), so every
 * request here is made by an OWNER. The ADMIN-is-refused case lives in modules/auth/auth.test.ts.
 *
 * Role names are suffixed because `createTestTenant` already seeds the six default roles, and
 * `(organizationId, name)` is unique.
 */
async function setup(namePrefix = "RolesOrg") {
  const tenant = await createTestTenant(namePrefix);
  const owner = await createActor(tenant, "OWNER");
  return { tenant, owner, path: `/api/v1/organizations/${tenant.organization.id}/roles` };
}

describe("roles module", () => {
  it("creates a role with an initial permission set (happy path)", async () => {
    const { owner, path } = await setup();
    const perm1 = await createTestPermission("members.create");
    const perm2 = await createTestPermission("members.view");

    const res = await request(app)
      .post(path)
      .set(...bearer(owner))
      .send({ name: `Front Desk ${uniqueSuffix()}`, permissionKeys: [perm1.key, perm2.key] });

    expect(res.status).toBe(201);
    expect(res.body.data.permissionKeys.sort()).toEqual([perm1.key, perm2.key].sort());
  });

  it("rejects an unknown permission key with 400 PERMISSION_NOT_FOUND", async () => {
    const { owner, path } = await setup();

    const res = await request(app)
      .post(path)
      .set(...bearer(owner))
      .send({ name: `Bad Role ${uniqueSuffix()}`, permissionKeys: ["totally.made.up.key"] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PERMISSION_NOT_FOUND");
  });

  it("rejects a duplicate role name within the same organization with 409", async () => {
    const { owner, path } = await setup();
    const name = `Shift Lead ${uniqueSuffix()}`;

    expect(
      (await request(app).post(path).set(...bearer(owner)).send({ name })).status,
    ).toBe(201);

    const res = await request(app)
      .post(path)
      .set(...bearer(owner))
      .send({ name });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DUPLICATE_ROLE_NAME");
  });

  it("allows the same role name in a different organization", async () => {
    const a = await setup("RoleNameA");
    const b = await setup("RoleNameB");
    const name = `Shift Lead ${uniqueSuffix()}`;

    const resA = await request(app).post(a.path).set(...bearer(a.owner)).send({ name });
    const resB = await request(app).post(b.path).set(...bearer(b.owner)).send({ name });

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
  });

  it("replaces a role's permission set on update", async () => {
    const { owner, path } = await setup();
    const perm1 = await createTestPermission("payments.create");
    const perm2 = await createTestPermission("payments.view");

    const created = await request(app)
      .post(path)
      .set(...bearer(owner))
      .send({ name: `Cashier ${uniqueSuffix()}`, permissionKeys: [perm1.key] });

    const res = await request(app)
      .patch(`${path}/${created.body.data.id}`)
      .set(...bearer(owner))
      .send({ permissionKeys: [perm2.key] });

    expect(res.status).toBe(200);
    expect(res.body.data.permissionKeys).toEqual([perm2.key]);
  });

  it("gets a role by id with its permissions", async () => {
    const { owner, path } = await setup();
    const perm = await createTestPermission("reports.view");

    const created = await request(app)
      .post(path)
      .set(...bearer(owner))
      .send({ name: `Analyst ${uniqueSuffix()}`, permissionKeys: [perm.key] });

    const res = await request(app)
      .get(`${path}/${created.body.data.id}`)
      .set(...bearer(owner));

    expect(res.status).toBe(200);
    expect(res.body.data.permissionKeys).toEqual([perm.key]);
  });

  it("lists the six default roles seeded for a new organization", async () => {
    const { owner, path } = await setup("DefaultRolesOrg");

    const res = await request(app)
      .get(path)
      .set(...bearer(owner))
      .query({ limit: 50 });

    expect(res.status).toBe(200);
    expect(res.body.data.map((r: { name: string }) => r.name).sort()).toEqual([
      "ACCOUNTANT",
      "ADMIN",
      "MANAGER",
      "OWNER",
      "RECEPTIONIST",
      "TRAINER",
    ]);
  });
});
