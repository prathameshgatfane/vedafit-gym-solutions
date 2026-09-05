import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../../test/helpers/app";
import {
  createTestOrganization,
  createTestRole,
  uniqueSuffix,
} from "../../../test/helpers/fixtures";
import { prisma } from "../../lib/prisma";
import { ULID_LOWERCASE_PATTERN } from "../../lib/id";

async function setupOrgWithRole() {
  const org = await createTestOrganization();
  const role = await createTestRole(org.id);
  return { org, role };
}

describe("users module", () => {
  it("creates a user with a hashed password, never returning passwordHash (happy path)", async () => {
    const { org, role } = await setupOrgWithRole();
    const suffix = uniqueSuffix();

    const res = await request(app)
      .post(`/api/v1/organizations/${org.id}/users`)
      .send({
        name: "Jane Staff",
        email: `jane-${suffix}@example.test`,
        password: "correct-horse-battery",
        roleId: role.id,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toMatch(ULID_LOWERCASE_PATTERN);
    expect(res.body.data.email).toBe(`jane-${suffix}@example.test`);
    expect(res.body.data).not.toHaveProperty("passwordHash");

    // Confirm it's actually hashed at rest, not stored in plaintext.
    const row = await prisma.user.findUnique({ where: { id: res.body.data.id } });
    expect(row?.passwordHash).not.toBe("correct-horse-battery");
    expect(row?.passwordHash.length).toBeGreaterThan(20);
  });

  it("rejects a password shorter than 8 characters with VALIDATION_ERROR", async () => {
    const { org, role } = await setupOrgWithRole();

    const res = await request(app)
      .post(`/api/v1/organizations/${org.id}/users`)
      .send({ name: "Weak Pw", email: `weak-${uniqueSuffix()}@example.test`, password: "short", roleId: role.id });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 ROLE_NOT_FOUND when roleId doesn't belong to the organization", async () => {
    const { org } = await setupOrgWithRole();

    const res = await request(app)
      .post(`/api/v1/organizations/${org.id}/users`)
      .send({
        name: "Bad Role",
        email: `badrole-${uniqueSuffix()}@example.test`,
        password: "correct-horse-battery",
        roleId: "not-a-real-role",
      });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ROLE_NOT_FOUND");
  });

  it("rejects a duplicate email within the same organization (sequential) with 409 DUPLICATE_EMAIL", async () => {
    const { org, role } = await setupOrgWithRole();
    const email = `dup-${uniqueSuffix()}@example.test`;
    const payload = { name: "First", email, password: "correct-horse-battery", roleId: role.id };

    const first = await request(app).post(`/api/v1/organizations/${org.id}/users`).send(payload);
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/api/v1/organizations/${org.id}/users`)
      .send({ ...payload, name: "Second" });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("DUPLICATE_EMAIL");
  });

  it("allows the same email in a different organization (uniqueness is per-org, not global)", async () => {
    const { org: orgA, role: roleA } = await setupOrgWithRole();
    const { org: orgB, role: roleB } = await setupOrgWithRole();
    const email = `shared-${uniqueSuffix()}@example.test`;

    const resA = await request(app)
      .post(`/api/v1/organizations/${orgA.id}/users`)
      .send({ name: "A User", email, password: "correct-horse-battery", roleId: roleA.id });
    const resB = await request(app)
      .post(`/api/v1/organizations/${orgB.id}/users`)
      .send({ name: "B User", email, password: "correct-horse-battery", roleId: roleB.id });

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
  });

  /**
   * Locked Decision 1.3: duplicate email is enforced at the app layer (no DB-level `@@unique`),
   * inside a transaction that locks the organization row for the duration of the check-then-write
   * (see `lockOrganizationForWrite` in user.service.ts). This test fires two truly concurrent
   * creates for the SAME organization + email and asserts the lock actually serializes them:
   * exactly one succeeds, exactly one is rejected as a duplicate — not two successes (which is
   * what a naive unlocked "check, then insert" would allow under true concurrency).
   */
  it("race condition: two concurrent creates with the same org+email — exactly one wins", async () => {
    const { org, role } = await setupOrgWithRole();
    const email = `race-${uniqueSuffix()}@example.test`;

    const [resA, resB] = await Promise.all([
      request(app)
        .post(`/api/v1/organizations/${org.id}/users`)
        .send({ name: "Racer A", email, password: "correct-horse-battery", roleId: role.id }),
      request(app)
        .post(`/api/v1/organizations/${org.id}/users`)
        .send({ name: "Racer B", email, password: "correct-horse-battery", roleId: role.id }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const failed = resA.status === 409 ? resA : resB;
    expect(failed.body.error.code).toBe("DUPLICATE_EMAIL");

    // Prove the DB actually only ended up with one row for this org+email — the lock closed the
    // race for real, this isn't just the HTTP layer coincidentally reporting one failure.
    const rows = await prisma.user.findMany({ where: { organizationId: org.id, email } });
    expect(rows).toHaveLength(1);
  });

  it("lists, gets, updates, and soft-deletes a user", async () => {
    const { org, role } = await setupOrgWithRole();
    const suffix = uniqueSuffix();
    const created = await request(app)
      .post(`/api/v1/organizations/${org.id}/users`)
      .send({
        name: "Lifecycle User",
        email: `lifecycle-${suffix}@example.test`,
        password: "correct-horse-battery",
        roleId: role.id,
      });
    const userId = created.body.data.id;

    const listRes = await request(app)
      .get(`/api/v1/organizations/${org.id}/users`)
      .query({ search: "Lifecycle" });
    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toHaveLength(1);

    const getRes = await request(app).get(`/api/v1/organizations/${org.id}/users/${userId}`);
    expect(getRes.status).toBe(200);

    const updateRes = await request(app)
      .patch(`/api/v1/organizations/${org.id}/users/${userId}`)
      .send({ status: "INACTIVE" });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.status).toBe("INACTIVE");

    const deleteRes = await request(app).delete(`/api/v1/organizations/${org.id}/users/${userId}`);
    expect(deleteRes.status).toBe(200);

    const getAfterDelete = await request(app).get(
      `/api/v1/organizations/${org.id}/users/${userId}`,
    );
    expect(getAfterDelete.status).toBe(404);
    expect(getAfterDelete.body.error.code).toBe("USER_NOT_FOUND");
  });

  it("allows re-creating a user with the same email after the original was soft-deleted", async () => {
    // This is the entire point of Locked Decision 1.3: a soft-deleted row must not keep an
    // email "taken" forever.
    const { org, role } = await setupOrgWithRole();
    const email = `resurrect-${uniqueSuffix()}@example.test`;

    const first = await request(app)
      .post(`/api/v1/organizations/${org.id}/users`)
      .send({ name: "Original", email, password: "correct-horse-battery", roleId: role.id });
    expect(first.status).toBe(201);

    await request(app).delete(`/api/v1/organizations/${org.id}/users/${first.body.data.id}`);

    const second = await request(app)
      .post(`/api/v1/organizations/${org.id}/users`)
      .send({ name: "Replacement", email, password: "correct-horse-battery", roleId: role.id });

    expect(second.status).toBe(201);
  });
});
