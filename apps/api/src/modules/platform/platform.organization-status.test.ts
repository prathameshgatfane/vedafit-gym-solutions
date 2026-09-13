import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../../test/helpers/app";
import {
  TEST_PASSWORD,
  bearer,
  createActor,
  createPlatformOperator,
  createTestTenant,
} from "../../../test/helpers/auth";
import { uniqueSuffix } from "../../../test/helpers/fixtures";
import { generateId } from "../../lib/id";
import { hashPassword } from "../../lib/password";
import { prisma } from "../../lib/prisma";

const STATUS = (organizationId: string) =>
  `/api/v1/platform/organizations/${organizationId}/status`;

function uniquePhone() {
  const n = `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`.slice(-10);
  return `+91${n}`;
}

async function loginStaff(email: string) {
  const res = await request(app).post("/api/v1/auth/login").send({
    email,
    password: TEST_PASSWORD,
  });
  return res;
}

async function loginMember(organizationSlug: string, phone: string) {
  const res = await request(app).post("/api/v1/auth/member/login").send({
    phone,
    password: TEST_PASSWORD,
    organizationSlug,
  });
  return res;
}

async function seedMember(organizationId: string, branchId: string) {
  const phone = uniquePhone();
  const member = await prisma.member.create({
    data: {
      id: generateId(),
      organizationId,
      branchId,
      firstName: "Suspend",
      lastName: uniqueSuffix(),
      phone,
      passwordHash: await hashPassword(TEST_PASSWORD),
    },
  });
  return { member, phone };
}

describe("PATCH /platform/organizations/:organizationId/status (Phase 15.7)", () => {
  it("lets a platform operator suspend and restore without touching the SaaS subscription", async () => {
    const operator = await createPlatformOperator();
    const tenant = await createTestTenant("SuspendSub");
    const before = await prisma.organizationSubscription.findUniqueOrThrow({
      where: { organizationId: tenant.organization.id },
    });

    const suspended = await request(app)
      .patch(STATUS(tenant.organization.id))
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({ status: "SUSPENDED" });
    expect(suspended.status).toBe(200);
    expect(suspended.body.success).toBe(true);
    expect(suspended.body.data.status).toBe("SUSPENDED");
    expect(suspended.body.data.id).toBe(tenant.organization.id);
    expect(JSON.stringify(suspended.body)).not.toMatch(/prisma|passwordHash|P20/i);

    const afterSuspend = await prisma.organizationSubscription.findUniqueOrThrow({
      where: { organizationId: tenant.organization.id },
    });
    expect(afterSuspend.id).toBe(before.id);
    expect(afterSuspend.status).toBe(before.status);
    expect(afterSuspend.planId).toBe(before.planId);

    const idempotent = await request(app)
      .patch(STATUS(tenant.organization.id))
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({ status: "SUSPENDED" });
    expect(idempotent.status).toBe(200);
    expect(idempotent.body.data.status).toBe("SUSPENDED");

    const activate = await request(app)
      .patch(STATUS(tenant.organization.id))
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({ status: "ACTIVE" });
    expect(activate.status).toBe(200);
    expect(activate.body.data.status).toBe("ACTIVE");

    const afterRestore = await prisma.organizationSubscription.findUniqueOrThrow({
      where: { organizationId: tenant.organization.id },
    });
    expect(afterRestore.status).toBe(before.status);
    expect(afterRestore.planId).toBe(before.planId);
  });

  it("blocks staff and member login after suspend; restore allows login again", async () => {
    const operator = await createPlatformOperator();
    const tenant = await createTestTenant("SuspendLogin");
    const owner = await createActor(tenant, "OWNER");
    const { member, phone } = await seedMember(tenant.organization.id, tenant.branch.id);

    const okStaff = await loginStaff(owner.user.email);
    expect(okStaff.status).toBe(200);
    const okMember = await loginMember(tenant.organization.slug, phone);
    expect(okMember.status).toBe(200);

    await request(app)
      .patch(STATUS(tenant.organization.id))
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({ status: "SUSPENDED" });

    const staffBlocked = await loginStaff(owner.user.email);
    expect(staffBlocked.status).toBe(403);
    expect(staffBlocked.body.error.code).toBe("ACCOUNT_INACTIVE");

    const memberBlocked = await loginMember(tenant.organization.slug, phone);
    expect(memberBlocked.status).toBe(403);
    expect(memberBlocked.body.error.code).toBe("ACCOUNT_INACTIVE");

    const stillThere = await prisma.member.findUnique({ where: { id: member.id } });
    expect(stillThere?.phone).toBe(phone);
    expect(stillThere?.deletedAt).toBeNull();

    await request(app)
      .patch(STATUS(tenant.organization.id))
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({ status: "ACTIVE" });

    expect((await loginStaff(owner.user.email)).status).toBe(200);
    expect((await loginMember(tenant.organization.slug, phone)).status).toBe(200);
  });

  it("rejects staff refresh after suspend; existing access JWT still works until TTL", async () => {
    const operator = await createPlatformOperator();
    const tenant = await createTestTenant("SuspendRefresh");
    const owner = await createActor(tenant, "OWNER");

    const preMe = await request(app).get("/api/v1/auth/me").set(...bearer(owner));
    expect(preMe.status).toBe(200);

    await request(app)
      .patch(STATUS(tenant.organization.id))
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({ status: "SUSPENDED" });

    const stillMe = await request(app).get("/api/v1/auth/me").set(...bearer(owner));
    expect(stillMe.status).toBe(200);
    expect(stillMe.body.data.organization.status).toBe("SUSPENDED");

    const refresh = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", owner.refreshCookie);
    expect(refresh.status).toBe(403);
    expect(refresh.body.error.code).toBe("ACCOUNT_INACTIVE");
    expect(JSON.stringify(refresh.body)).not.toMatch(/prisma|P20/i);
  });

  it("rejects member refresh after suspend; existing member access JWT still works until TTL", async () => {
    const operator = await createPlatformOperator();
    const tenant = await createTestTenant("SuspendMemRefresh");
    const { phone } = await seedMember(tenant.organization.id, tenant.branch.id);
    const loggedIn = await loginMember(tenant.organization.slug, phone);
    expect(loggedIn.status).toBe(200);
    const accessToken = loggedIn.body.data.accessToken as string;
    const refreshToken = loggedIn.body.data.refreshToken as string;

    await request(app)
      .patch(STATUS(tenant.organization.id))
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({ status: "SUSPENDED" });

    const me = await request(app)
      .get("/api/v1/auth/member/me")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(me.status).toBe(200);

    const refresh = await request(app)
      .post("/api/v1/auth/member/refresh")
      .send({ refreshToken });
    expect(refresh.status).toBe(403);
    expect(refresh.body.error.code).toBe("ACCOUNT_INACTIVE");
  });

  it("does not lock out platform login or refresh when a gym is suspended", async () => {
    const operator = await createPlatformOperator();
    const tenant = await createTestTenant("SuspendPlatOk");

    await request(app)
      .patch(STATUS(tenant.organization.id))
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({ status: "SUSPENDED" });

    const relogin = await request(app).post("/api/v1/auth/platform/login").send({
      email: operator.user.email,
      password: TEST_PASSWORD,
    });
    expect(relogin.status).toBe(200);

    const refresh = await request(app)
      .post("/api/v1/auth/platform/refresh")
      .set("Cookie", operator.refreshCookie);
    expect(refresh.status).toBe(200);

    const again = await request(app)
      .patch(STATUS(tenant.organization.id))
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({ status: "ACTIVE" });
    expect(again.status).toBe(200);
  });

  it("rejects staff and member JWTs; gym OWNER cannot target another org", async () => {
    const operator = await createPlatformOperator();
    const a = await createActor(await createTestTenant("IsoA"), "OWNER");
    const b = await createActor(await createTestTenant("IsoB"), "OWNER");
    const { phone } = await seedMember(a.organization.id, a.branch.id);
    const memberLogin = await loginMember(a.organization.slug, phone);
    expect(memberLogin.status).toBe(200);

    const staffOnPlatform = await request(app)
      .patch(STATUS(a.organization.id))
      .set(...bearer(a))
      .send({ status: "SUSPENDED" });
    expect(staffOnPlatform.status).toBe(401);

    const memberOnPlatform = await request(app)
      .patch(STATUS(a.organization.id))
      .set("Authorization", `Bearer ${memberLogin.body.data.accessToken}`)
      .send({ status: "SUSPENDED" });
    expect(memberOnPlatform.status).toBe(401);

    const gymCross = await request(app)
      .patch(`/api/v1/organizations/${b.organization.id}`)
      .set(...bearer(a))
      .send({ status: "SUSPENDED" });
    expect(gymCross.status).toBe(403);
    expect(gymCross.body.error.code).toBe("ORG_MISMATCH");

    const gymOwnStatus = await request(app)
      .patch(`/api/v1/organizations/${a.organization.id}`)
      .set(...bearer(a))
      .send({ status: "SUSPENDED" });
    expect(gymOwnStatus.status).toBe(400);
    expect(gymOwnStatus.body.error.code).toBe("VALIDATION_ERROR");

    const smuggled = await request(app)
      .patch(STATUS(a.organization.id))
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({ status: "SUSPENDED", organizationId: b.organization.id, planId: "nope" });
    expect(smuggled.status).toBe(400);
    expect(smuggled.body.error.code).toBe("VALIDATION_ERROR");

    const aRow = await prisma.organization.findUniqueOrThrow({ where: { id: a.organization.id } });
    const bRow = await prisma.organization.findUniqueOrThrow({ where: { id: b.organization.id } });
    expect(aRow.status).toBe("ACTIVE");
    expect(bRow.status).toBe("ACTIVE");
  });

  it("returns 404 for an unknown organization and 400 for an invalid status", async () => {
    const operator = await createPlatformOperator();

    const missing = await request(app)
      .patch(STATUS("not-a-real-org"))
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({ status: "SUSPENDED" });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("ORGANIZATION_NOT_FOUND");

    const tenant = await createTestTenant("BadStatus");
    const bad = await request(app)
      .patch(STATUS(tenant.organization.id))
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({ status: "PAST_DUE" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("VALIDATION_ERROR");

    const row = await prisma.organization.findUniqueOrThrow({
      where: { id: tenant.organization.id },
    });
    expect(row.status).toBe("ACTIVE");
  });
});
