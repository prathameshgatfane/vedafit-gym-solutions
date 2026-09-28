import { Prisma } from "@prisma/client";
import request from "supertest";
import { describe, expect, it } from "vitest";
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
import { addDays, todayUtc } from "../../utils/dates";
import { provisionOrganization } from "../organizations/organization-provisioning.service";
import {
  SAAS_ENTITLEMENT_KEY,
  SAAS_PLAN_CATALOG,
  SAAS_PLAN_CODE,
  syncSaasPlanCatalog,
} from "../saas/saas-catalog";
import { PLATFORM_AUDIT_ACTION } from "./platform-audit";

const BASE = "/api/v1/platform";

function catalogEntitlements(code = SAAS_PLAN_CODE.TRIAL) {
  const seed = SAAS_PLAN_CATALOG.find((plan) => plan.code === code)!;
  return seed.entitlements.map((row) => {
    if (row.valueType === "LIMIT") {
      return { key: row.key, valueType: "LIMIT" as const, intValue: row.intValue };
    }
    if (row.valueType === "UNLIMITED") {
      return { key: row.key, valueType: "UNLIMITED" as const };
    }
    return { key: row.key, valueType: "BOOLEAN" as const, boolValue: row.boolValue };
  });
}

function createPlanBody(
  suffix = uniqueSuffix(),
  prices: { monthly: string; yearly: string } = { monthly: "499.00", yearly: "4990.00" },
) {
  return {
    code: `f${suffix.toLowerCase()}`.slice(0, 32),
    name: `Phase F ${suffix}`,
    description: "Phase F priced plan",
    priceMonthly: prices.monthly,
    priceYearly: prices.yearly,
    trialDays: 7,
    entitlements: catalogEntitlements(),
  };
}

async function catalogPlan(code: string) {
  await syncSaasPlanCatalog();
  return prisma.saasPlan.findUniqueOrThrow({ where: { code } });
}

async function provisionGym(label: string) {
  const suffix = uniqueSuffix();
  return provisionOrganization({
    organization: {
      name: `${label} ${suffix}`,
      slug: `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${suffix}`,
      email: `${label.toLowerCase()}-${suffix}@example.test`,
    },
    owner: {
      name: `${label} Owner`,
      email: `${label.toLowerCase()}-o-${suffix}@example.test`,
      password: TEST_PASSWORD,
    },
  });
}

async function seedGymBilling(organizationId: string, branchId: string, memberIdHint: string) {
  const member = await prisma.member.create({
    data: {
      id: generateId(),
      organizationId,
      branchId,
      firstName: "Phase",
      lastName: "F",
      phone: `+91${`${Date.now()}${Math.floor(Math.random() * 1_000_000)}`.slice(-10)}`,
    },
  });
  const gymPlan = await prisma.membershipPlan.create({
    data: {
      id: generateId(),
      organizationId,
      name: `Gym Plan ${memberIdHint}`,
      price: new Prisma.Decimal("2000.00"),
      durationDays: 30,
    },
  });
  const today = todayUtc();
  const membership = await prisma.membership.create({
    data: {
      id: generateId(),
      organizationId,
      branchId,
      memberId: member.id,
      planId: gymPlan.id,
      priceAtPurchase: gymPlan.price,
      durationDaysAtPurchase: 30,
      startDate: addDays(today, -5),
      endDate: addDays(today, 10),
      status: "ACTIVE",
    },
  });
  const invoice = await prisma.invoice.create({
    data: {
      id: generateId(),
      organizationId,
      branchId,
      memberId: member.id,
      membershipId: membership.id,
      invoiceNumber: `INV-F-${generateId().slice(-8)}`,
      amountTotal: new Prisma.Decimal("2000.00"),
      amountPaid: new Prisma.Decimal("500.00"),
      amountPending: new Prisma.Decimal("1500.00"),
      status: "PARTIALLY_PAID",
    },
  });
  const payment = await prisma.payment.create({
    data: {
      id: generateId(),
      organizationId,
      branchId,
      memberId: member.id,
      membershipId: membership.id,
      invoiceId: invoice.id,
      amount: new Prisma.Decimal("500.00"),
      method: "UPI",
      status: "SUCCESS",
    },
  });
  return { member, gymPlan, membership, invoice, payment };
}

async function patchSubscription(
  operatorToken: string,
  organizationId: string,
  body: Record<string, unknown>,
) {
  return request(app)
    .patch(`${BASE}/organizations/${organizationId}/subscription`)
    .set("Authorization", `Bearer ${operatorToken}`)
    .send(body);
}

describe("platform organization subscription PATCH (Phase F)", () => {
  it("changes plan, interval, status, and period without touching owner or gym billing data", async () => {
    const operator = await createPlatformOperator();
    const growth = await catalogPlan(SAAS_PLAN_CODE.GROWTH);
    const starter = await catalogPlan(SAAS_PLAN_CODE.STARTER);
    const gym = await provisionGym("PhaseFChange");
    const ownerBefore = await prisma.user.findUniqueOrThrow({ where: { id: gym.owner.id } });
    const userCountBefore = await prisma.user.count({ where: { organizationId: gym.organization.id } });
    const branchCountBefore = await prisma.branch.count({
      where: { organizationId: gym.organization.id },
    });
    const billing = await seedGymBilling(gym.organization.id, gym.branch.id, "change");
    const periodEnd = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000).toISOString();

    const changed = await patchSubscription(operator.accessToken, gym.organization.id, {
      planId: growth.id,
      status: "ACTIVE",
      billingInterval: "YEARLY",
      currentPeriodEnd: periodEnd,
    });
    expect(changed.status).toBe(200);
    expect(changed.body.data.subscription.plan.code).toBe(SAAS_PLAN_CODE.GROWTH);
    expect(changed.body.data.subscription.status).toBe("ACTIVE");
    expect(changed.body.data.subscription.billingInterval).toBe("YEARLY");
    expect(changed.body.data.subscription.currentPeriodEnd).toBe(periodEnd);
    expect(changed.body.data.subscription.priceSnapshot).toBe(growth.priceYearly.toFixed(2));
    expect(changed.body.data.organization.id).toBe(gym.organization.id);
    expect(JSON.stringify(changed.body)).not.toMatch(/password|passwordHash|refreshToken|accessToken|\$2[aby]\$/i);

    const intervalOnly = await patchSubscription(operator.accessToken, gym.organization.id, {
      billingInterval: "MONTHLY",
    });
    expect(intervalOnly.status).toBe(200);
    expect(intervalOnly.body.data.subscription.plan.code).toBe(SAAS_PLAN_CODE.GROWTH);
    expect(intervalOnly.body.data.subscription.billingInterval).toBe("MONTHLY");
    expect(intervalOnly.body.data.subscription.priceSnapshot).toBe(growth.priceMonthly.toFixed(2));

    const statusOnly = await patchSubscription(operator.accessToken, gym.organization.id, {
      status: "PAST_DUE",
    });
    expect(statusOnly.status).toBe(200);
    expect(statusOnly.body.data.subscription.status).toBe("PAST_DUE");
    expect(statusOnly.body.data.subscription.priceSnapshot).toBe(growth.priceMonthly.toFixed(2));

    const laterPeriod = new Date(Date.now() + 50 * 24 * 60 * 60 * 1000).toISOString();
    const periodOnly = await patchSubscription(operator.accessToken, gym.organization.id, {
      currentPeriodEnd: laterPeriod,
    });
    expect(periodOnly.status).toBe(200);
    expect(periodOnly.body.data.subscription.currentPeriodEnd).toBe(laterPeriod);
    expect(periodOnly.body.data.subscription.priceSnapshot).toBe(growth.priceMonthly.toFixed(2));

    const planOnly = await patchSubscription(operator.accessToken, gym.organization.id, {
      planId: starter.id,
    });
    expect(planOnly.status).toBe(200);
    expect(planOnly.body.data.subscription.plan.code).toBe(SAAS_PLAN_CODE.STARTER);
    expect(planOnly.body.data.subscription.priceSnapshot).toBe(starter.priceMonthly.toFixed(2));

    const ownerAfter = await prisma.user.findUniqueOrThrow({ where: { id: gym.owner.id } });
    expect(ownerAfter.passwordHash).toBe(ownerBefore.passwordHash);
    expect(await prisma.user.count({ where: { organizationId: gym.organization.id } })).toBe(
      userCountBefore,
    );
    expect(await prisma.branch.count({ where: { organizationId: gym.organization.id } })).toBe(
      branchCountBefore,
    );

    const login = await request(app).post("/api/v1/auth/login").send({
      email: gym.owner.email,
      password: TEST_PASSWORD,
    });
    expect(login.status).toBe(200);
    const me = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${login.body.data.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.saas.plan.code).toBe(SAAS_PLAN_CODE.STARTER);
    expect(me.body.data.saas.subscription.status).toBe("PAST_DUE");

    const membershipAfter = await prisma.membership.findUniqueOrThrow({
      where: { id: billing.membership.id },
    });
    const invoiceAfter = await prisma.invoice.findUniqueOrThrow({ where: { id: billing.invoice.id } });
    const paymentAfter = await prisma.payment.findUniqueOrThrow({ where: { id: billing.payment.id } });
    expect(membershipAfter.status).toBe("ACTIVE");
    expect(membershipAfter.priceAtPurchase.toFixed(2)).toBe("2000.00");
    expect(invoiceAfter.amountTotal.toFixed(2)).toBe("2000.00");
    expect(invoiceAfter.amountPending.toFixed(2)).toBe("1500.00");
    expect(paymentAfter.amount.toFixed(2)).toBe("500.00");
  });

  it("preserves priceSnapshot on status-only updates and catalog price edits", async () => {
    const operator = await createPlatformOperator();
    const created = await request(app)
      .post(`${BASE}/plans`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send(createPlanBody());
    expect(created.status).toBe(201);
    const planId = created.body.data.id as string;
    const gym = await provisionGym("PhaseFSnap");

    const assigned = await patchSubscription(operator.accessToken, gym.organization.id, {
      planId,
      status: "ACTIVE",
      billingInterval: "MONTHLY",
    });
    expect(assigned.status).toBe(200);
    expect(assigned.body.data.subscription.priceSnapshot).toBe("499.00");

    const priced = await request(app)
      .patch(`${BASE}/plans/${planId}`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({ priceMonthly: "999.00", priceYearly: "9990.00" });
    expect(priced.status).toBe(200);

    const afterCatalog = await prisma.organizationSubscription.findUniqueOrThrow({
      where: { organizationId: gym.organization.id },
    });
    expect(afterCatalog.priceSnapshot.toFixed(2)).toBe("499.00");

    const statusOnly = await patchSubscription(operator.accessToken, gym.organization.id, {
      status: "TRIAL",
    });
    expect(statusOnly.status).toBe(200);
    expect(statusOnly.body.data.subscription.status).toBe("TRIAL");
    expect(statusOnly.body.data.subscription.priceSnapshot).toBe("499.00");
    expect(statusOnly.body.data.subscription.billingInterval).toBe("MONTHLY");
  });

  it("accepts trial, past-due, cancelled, and expired-period subscriptions", async () => {
    const operator = await createPlatformOperator();
    const gym = await provisionGym("PhaseFStatus");
    await prisma.organizationSubscription.update({
      where: { organizationId: gym.organization.id },
      data: { currentPeriodStart: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
    });
    const future = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString();
    const expired = new Date(Date.now() - 60_000).toISOString();

    const trial = await patchSubscription(operator.accessToken, gym.organization.id, {
      status: "TRIAL",
      currentPeriodEnd: future,
    });
    expect(trial.status).toBe(200);
    expect(trial.body.data.subscription.status).toBe("TRIAL");

    const pastDue = await patchSubscription(operator.accessToken, gym.organization.id, {
      status: "PAST_DUE",
    });
    expect(pastDue.status).toBe(200);
    expect(pastDue.body.data.subscription.status).toBe("PAST_DUE");

    const cancelled = await patchSubscription(operator.accessToken, gym.organization.id, {
      status: "CANCELLED",
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.subscription.status).toBe("CANCELLED");

    const expiredPeriod = await patchSubscription(operator.accessToken, gym.organization.id, {
      currentPeriodEnd: expired,
    });
    expect(expiredPeriod.status).toBe(200);
    expect(expiredPeriod.body.data.subscription.currentPeriodEnd).toBe(expired);
    expect(expiredPeriod.body.data.subscription.priceSnapshot).toBe(
      pastDue.body.data.subscription.priceSnapshot,
    );
  });

  it("rejects archived, missing, invalid, and client-overridden subscription fields", async () => {
    const operator = await createPlatformOperator();
    const gym = await provisionGym("PhaseFReject");
    const created = await request(app)
      .post(`${BASE}/plans`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send(createPlanBody());
    expect(created.status).toBe(201);
    const archivedId = created.body.data.id as string;
    await request(app)
      .post(`${BASE}/plans/${archivedId}/archive`)
      .set("Authorization", `Bearer ${operator.accessToken}`);

    const archived = await patchSubscription(operator.accessToken, gym.organization.id, {
      planId: archivedId,
    });
    expect(archived.status).toBe(409);
    expect(archived.body.error.code).toBe("SAAS_PLAN_INACTIVE");

    const missingPlan = await patchSubscription(operator.accessToken, gym.organization.id, {
      planId: "not-a-plan",
    });
    expect(missingPlan.status).toBe(404);
    expect(missingPlan.body.error.code).toBe("SAAS_PLAN_NOT_FOUND");

    const missingOrg = await patchSubscription(operator.accessToken, "not-a-real-org", {
      status: "ACTIVE",
    });
    expect(missingOrg.status).toBe(404);
    expect(missingOrg.body.error.code).toBe("ORGANIZATION_NOT_FOUND");

    const badStatus = await patchSubscription(operator.accessToken, gym.organization.id, {
      status: "EXPIRED",
    });
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.error.code).toBe("VALIDATION_ERROR");

    const badInterval = await patchSubscription(operator.accessToken, gym.organization.id, {
      billingInterval: "WEEKLY",
    });
    expect(badInterval.status).toBe(400);
    expect(badInterval.body.error.code).toBe("VALIDATION_ERROR");

    const existing = await prisma.organizationSubscription.findUniqueOrThrow({
      where: { organizationId: gym.organization.id },
    });
    const beforeStart = new Date(existing.currentPeriodStart.getTime() - 60_000).toISOString();
    const badPeriod = await patchSubscription(operator.accessToken, gym.organization.id, {
      currentPeriodEnd: beforeStart,
    });
    expect(badPeriod.status).toBe(400);
    expect(badPeriod.body.error.code).toBe("VALIDATION_ERROR");

    const invalidDate = await patchSubscription(operator.accessToken, gym.organization.id, {
      currentPeriodEnd: "not-a-date",
    });
    expect(invalidDate.status).toBe(400);
    expect(invalidDate.body.error.code).toBe("VALIDATION_ERROR");

    const priceOverride = await patchSubscription(operator.accessToken, gym.organization.id, {
      status: "ACTIVE",
      priceSnapshot: "1.00",
      priceMonthly: "1.00",
    });
    expect(priceOverride.status).toBe(400);
    expect(priceOverride.body.error.code).toBe("VALIDATION_ERROR");

    const entitlementOverride = await patchSubscription(operator.accessToken, gym.organization.id, {
      status: "ACTIVE",
      entitlements: [{ key: SAAS_ENTITLEMENT_KEY.MEMBERS_MAX, valueType: "UNLIMITED" }],
    });
    expect(entitlementOverride.status).toBe(400);
    expect(entitlementOverride.body.error.code).toBe("VALIDATION_ERROR");

    const smuggledOrg = await patchSubscription(operator.accessToken, gym.organization.id, {
      status: "ACTIVE",
      organizationId: "spoofed-org",
    });
    expect(smuggledOrg.status).toBe(400);
    expect(smuggledOrg.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("writes PLAN_CHANGED only when the plan changes and skips no-op audits", async () => {
    const operator = await createPlatformOperator();
    const growth = await catalogPlan(SAAS_PLAN_CODE.GROWTH);
    const gym = await provisionGym("PhaseFAudit");
    const before = await prisma.organizationSubscription.findUniqueOrThrow({
      where: { organizationId: gym.organization.id },
      include: { plan: true },
    });
    const auditBefore = await prisma.platformAuditLog.count({
      where: { organizationId: gym.organization.id },
    });

    const noop = await patchSubscription(operator.accessToken, gym.organization.id, {
      planId: before.planId,
      status: before.status,
      billingInterval: before.billingInterval,
      currentPeriodEnd: before.currentPeriodEnd.toISOString(),
    });
    expect(noop.status).toBe(200);
    expect(noop.body.data.subscription.plan.id).toBe(before.planId);
    expect(
      await prisma.platformAuditLog.count({ where: { organizationId: gym.organization.id } }),
    ).toBe(auditBefore);
    expect(
      await prisma.organizationSubscription.findUniqueOrThrow({
        where: { organizationId: gym.organization.id },
      }),
    ).toMatchObject({
      updatedAt: before.updatedAt,
      priceSnapshot: before.priceSnapshot,
    });

    const statusChanged = await patchSubscription(operator.accessToken, gym.organization.id, {
      status: "ACTIVE",
    });
    expect(statusChanged.status).toBe(200);
    expect(
      await prisma.platformAuditLog.count({
        where: {
          organizationId: gym.organization.id,
          action: PLATFORM_AUDIT_ACTION.PLAN_CHANGED,
        },
      }),
    ).toBe(0);
    const statusAudit = await prisma.platformAuditLog.findFirstOrThrow({
      where: {
        organizationId: gym.organization.id,
        action: PLATFORM_AUDIT_ACTION.SUBSCRIPTION_CHANGED,
      },
    });
    expect(statusAudit.beforeJson).toMatchObject({ status: before.status, planCode: before.plan.code });
    expect(statusAudit.afterJson).toMatchObject({ status: "ACTIVE", planCode: before.plan.code });
    expect(JSON.stringify(statusAudit)).not.toMatch(/password|passwordHash|refreshToken|accessToken/i);

    const planChanged = await patchSubscription(operator.accessToken, gym.organization.id, {
      planId: growth.id,
    });
    expect(planChanged.status).toBe(200);
    expect(
      await prisma.platformAuditLog.count({
        where: {
          organizationId: gym.organization.id,
          action: PLATFORM_AUDIT_ACTION.PLAN_CHANGED,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.platformAuditLog.count({
        where: {
          organizationId: gym.organization.id,
          action: PLATFORM_AUDIT_ACTION.SUBSCRIPTION_CHANGED,
        },
      }),
    ).toBe(2);
  });

  it("rejects staff and member JWTs on the subscription PATCH", async () => {
    const staff = await createActor(await createTestTenant("PhaseFDeny"), "OWNER");
    const phone = `+91${`${Date.now()}${Math.floor(Math.random() * 1_000_000)}`.slice(-10)}`;
    await prisma.member.create({
      data: {
        id: generateId(),
        organizationId: staff.organization.id,
        branchId: staff.branch.id,
        firstName: "Mem",
        lastName: "Ber",
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

    const staffRes = await request(app)
      .patch(`${BASE}/organizations/${staff.organization.id}/subscription`)
      .set(...bearer(staff))
      .send({ status: "ACTIVE" });
    expect(staffRes.status).toBe(401);

    const memberRes = await request(app)
      .patch(`${BASE}/organizations/${staff.organization.id}/subscription`)
      .set("Authorization", `Bearer ${member.body.data.accessToken}`)
      .send({ status: "ACTIVE" });
    expect(memberRes.status).toBe(401);
  });
});
