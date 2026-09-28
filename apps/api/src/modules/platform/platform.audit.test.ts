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
import { provisionOrganization } from "../organizations/organization-provisioning.service";
import { SAAS_PLAN_CODE, syncSaasPlanCatalog } from "../saas/saas-catalog";
import { PLATFORM_AUDIT_ACTION } from "./platform-audit";

const BASE = "/api/v1/platform";

function signupBody(suffix: string) {
  return {
    name: `Audit Gym ${suffix}`,
    slug: `audit-gym-${suffix}`,
    email: `audit-gym-${suffix}@example.test`,
    owner: {
      name: `Owner ${suffix}`,
      email: `audit-owner-${suffix}@example.test`,
      password: TEST_PASSWORD,
    },
  };
}

function uniquePhone() {
  const n = `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`.slice(-10);
  return `+91${n}`;
}

describe("platform_audit_logs (Phase 15.11)", () => {
  it("records ORG_SIGNUP with a null actor and no password fields", async () => {
    const suffix = uniqueSuffix();
    const before = await prisma.platformAuditLog.count();
    const res = await request(app).post(`${BASE}/signup`).send(signupBody(suffix));
    expect(res.status).toBe(201);

    const rows = await prisma.platformAuditLog.findMany({
      where: { organizationId: res.body.data.organization.id, action: PLATFORM_AUDIT_ACTION.ORG_SIGNUP },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.platformUserId).toBeNull();
    expect(rows[0]!.entityType).toBe("Organization");
    expect(rows[0]!.entityId).toBe(res.body.data.organization.id);
    expect(rows[0]!.afterJson).toMatchObject({
      organization: { id: res.body.data.organization.id, slug: `audit-gym-${suffix}` },
      owner: { email: `audit-owner-${suffix}@example.test` },
      subscription: { planCode: SAAS_PLAN_CODE.TRIAL, status: "TRIAL" },
    });
    expect(JSON.stringify(rows[0])).not.toMatch(/password|passwordHash|refreshToken|\$2a\$/i);
    expect(await prisma.platformAuditLog.count()).toBe(before + 1);
  });

  it("records ORG_PROVISIONED with the JWT platform user, not a spoofed body actor", async () => {
    const operator = await createPlatformOperator();
    const suffix = uniqueSuffix();
    const res = await request(app)
      .post(`${BASE}/organizations`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({
        ...signupBody(suffix),
        platformUserId: "spoofed-actor",
        actorId: "spoofed-actor",
        actorEmail: "spoof@example.test",
      });
    const provisionedBefore = await prisma.platformAuditLog.count({
      where: { action: PLATFORM_AUDIT_ACTION.ORG_PROVISIONED },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(
      await prisma.platformAuditLog.count({ where: { action: PLATFORM_AUDIT_ACTION.ORG_PROVISIONED } }),
    ).toBe(provisionedBefore);

    await syncSaasPlanCatalog();
    const trial = await prisma.saasPlan.findUniqueOrThrow({ where: { code: SAAS_PLAN_CODE.TRIAL } });
    const created = await request(app)
      .post(`${BASE}/organizations`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({ ...signupBody(`${suffix}ok`), planId: trial.id });
    expect(created.status).toBe(201);

    const row = await prisma.platformAuditLog.findFirstOrThrow({
      where: {
        organizationId: created.body.data.organization.id,
        action: PLATFORM_AUDIT_ACTION.ORG_PROVISIONED,
      },
    });
    expect(row.platformUserId).toBe(operator.user.id);
    expect(row.platformUserId).not.toBe("spoofed-actor");
    expect(row.afterJson).toMatchObject({ credentialMode: "manual" });
    expect(JSON.stringify(row)).not.toMatch(/password|passwordHash|refreshToken|\$2a\$|temporaryPassword/i);
  });

  it("records ORG_SUSPENDED and ORG_ACTIVATED from the platform JWT against the URL org", async () => {
    const operator = await createPlatformOperator();
    const tenant = await createTestTenant("AuditStatus");
    const other = await createTestTenant("AuditOther");

    const spoof = await request(app)
      .patch(`${BASE}/organizations/${tenant.organization.id}/status`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({ status: "SUSPENDED", platformUserId: other.organization.id });
    expect(spoof.status).toBe(400);

    const suspended = await request(app)
      .patch(`${BASE}/organizations/${tenant.organization.id}/status`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({ status: "SUSPENDED" });
    expect(suspended.status).toBe(200);

    const suspendRow = await prisma.platformAuditLog.findFirstOrThrow({
      where: {
        organizationId: tenant.organization.id,
        action: PLATFORM_AUDIT_ACTION.ORG_SUSPENDED,
      },
    });
    expect(suspendRow.platformUserId).toBe(operator.user.id);
    expect(suspendRow.beforeJson).toEqual({ status: "ACTIVE" });
    expect(suspendRow.afterJson).toEqual({ status: "SUSPENDED" });
    expect(
      await prisma.platformAuditLog.count({
        where: { organizationId: other.organization.id, action: PLATFORM_AUDIT_ACTION.ORG_SUSPENDED },
      }),
    ).toBe(0);

    const restored = await request(app)
      .patch(`${BASE}/organizations/${tenant.organization.id}/status`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({ status: "ACTIVE" });
    expect(restored.status).toBe(200);
    const activateRow = await prisma.platformAuditLog.findFirstOrThrow({
      where: {
        organizationId: tenant.organization.id,
        action: PLATFORM_AUDIT_ACTION.ORG_ACTIVATED,
      },
    });
    expect(activateRow.platformUserId).toBe(operator.user.id);
    expect(activateRow.beforeJson).toEqual({ status: "SUSPENDED" });
    expect(activateRow.afterJson).toEqual({ status: "ACTIVE" });
  });

  it("records PLAN_CHANGED and SUBSCRIPTION_CHANGED without another org's ids", async () => {
    const operator = await createPlatformOperator();
    await syncSaasPlanCatalog();
    const growth = await prisma.saasPlan.findUniqueOrThrow({ where: { code: SAAS_PLAN_CODE.GROWTH } });
    const target = await provisionOrganization({
      organization: {
        name: `Audit Sub A ${uniqueSuffix()}`,
        slug: `audit-sub-a-${uniqueSuffix()}`,
        email: `audit-sub-a-${uniqueSuffix()}@example.test`,
      },
      owner: {
        name: "A",
        email: `audit-sub-a-o-${uniqueSuffix()}@example.test`,
        password: TEST_PASSWORD,
      },
    });
    const other = await createTestTenant("AuditSubB");
    const beforeTarget = await prisma.organizationSubscription.findUniqueOrThrow({
      where: { organizationId: target.organization.id },
      include: { plan: true },
    });

    const periodEnd = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000).toISOString();
    const patched = await request(app)
      .patch(`${BASE}/organizations/${target.organization.id}/subscription`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({ planId: growth.id, status: "ACTIVE", currentPeriodEnd: periodEnd });
    expect(patched.status).toBe(200);

    const planRow = await prisma.platformAuditLog.findFirstOrThrow({
      where: {
        organizationId: target.organization.id,
        action: PLATFORM_AUDIT_ACTION.PLAN_CHANGED,
      },
    });
    expect(planRow.platformUserId).toBe(operator.user.id);
    expect(planRow.entityId).toBe(beforeTarget.id);
    expect(planRow.beforeJson).toMatchObject({
      planId: beforeTarget.plan.id,
      planCode: beforeTarget.plan.code,
    });
    expect(planRow.afterJson).toMatchObject({ planId: growth.id, planCode: SAAS_PLAN_CODE.GROWTH });

    const subRow = await prisma.platformAuditLog.findFirstOrThrow({
      where: {
        organizationId: target.organization.id,
        action: PLATFORM_AUDIT_ACTION.SUBSCRIPTION_CHANGED,
      },
    });
    expect(subRow.afterJson).toMatchObject({ status: "ACTIVE", planCode: SAAS_PLAN_CODE.GROWTH });
    expect(JSON.stringify(subRow)).not.toMatch(/passwordHash|refreshToken|\$2a\$/i);

    expect(
      await prisma.platformAuditLog.count({
        where: { organizationId: other.organization.id },
      }),
    ).toBe(0);
  });

  it("does not write an audit row when the mutation fails", async () => {
    const operator = await createPlatformOperator();
    const before = await prisma.platformAuditLog.count();

    const missing = await request(app)
      .patch(`${BASE}/organizations/not-a-real-org/status`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({ status: "SUSPENDED" });
    expect(missing.status).toBe(404);

    const badPlan = await request(app)
      .patch(`${BASE}/organizations/${(await createTestTenant("AuditFail")).organization.id}/subscription`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({ planId: "not-a-plan" });
    expect(badPlan.status).toBe(404);

    expect(await prisma.platformAuditLog.count()).toBe(before);
  });

  it("does not let staff, member, or anonymous callers create platform audit rows", async () => {
    const staff = await createActor(await createTestTenant("AuditDeny"), "OWNER");
    const phone = uniquePhone();
    await prisma.member.create({
      data: {
        id: generateId(),
        organizationId: staff.organization.id,
        branchId: staff.branch.id,
        firstName: "No",
        lastName: "Audit",
        phone,
        passwordHash: await hashPassword(TEST_PASSWORD),
      },
    });
    const member = await request(app).post("/api/v1/auth/member/login").send({
      phone,
      password: TEST_PASSWORD,
      organizationSlug: staff.organization.slug,
    });
    expect(member.status).toBe(200);
    const before = await prisma.platformAuditLog.count();

    const urls = [
      ["post", `${BASE}/organizations`] as const,
      ["patch", `${BASE}/organizations/${staff.organization.id}/status`] as const,
      ["patch", `${BASE}/organizations/${staff.organization.id}/subscription`] as const,
    ];

    for (const [method, url] of urls) {
      const unauth = await request(app)[method](url).send({ status: "SUSPENDED" });
      expect(unauth.status).toBe(401);

      const staffRes = await request(app)[method](url)
        .set(...bearer(staff))
        .send({ status: "SUSPENDED" });
      expect(staffRes.status).toBe(401);

      const memberRes = await request(app)[method](url)
        .set("Authorization", `Bearer ${member.body.data.accessToken}`)
        .send({ status: "SUSPENDED" });
      expect(memberRes.status).toBe(401);
    }

    expect(await prisma.platformAuditLog.count()).toBe(before);
  });
});
