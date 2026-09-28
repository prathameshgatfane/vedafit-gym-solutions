import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { generateId } from "../../lib/id";
import { hashPassword } from "../../lib/password";
import { prisma } from "../../lib/prisma";
import { app } from "../../../test/helpers/app";
import {
  TEST_PASSWORD,
  bearer,
  createActor,
  createPlatformOperator,
  createTestTenant,
} from "../../../test/helpers/auth";
import { uniqueSuffix } from "../../../test/helpers/fixtures";
import { provisionOrganization } from "../organizations/organization-provisioning.service";
import {
  SAAS_ENTITLEMENT_KEY,
  SAAS_PLAN_CATALOG,
  SAAS_PLAN_CODE,
  syncSaasPlanCatalog,
} from "../saas/saas-catalog";

const BASE = "/api/v1/platform";
const SECRET_LEAK = /password|passwordHash|refreshToken|accessToken|temporaryPassword|\$2[aby]\$/i;

const fixturePlanIds: string[] = [];

function uniquePhone() {
  return `+91${`${Date.now()}${Math.floor(Math.random() * 1_000_000)}`.slice(-10)}`;
}

async function loginMember(organizationSlug: string, phone: string) {
  return request(app).post("/api/v1/auth/member/login").send({
    phone,
    password: TEST_PASSWORD,
    organizationSlug,
  });
}

async function catalogPlan(code: string) {
  await syncSaasPlanCatalog();
  return prisma.saasPlan.findUniqueOrThrow({ where: { code } });
}

async function provisionGym(label: string, planCode: string = SAAS_PLAN_CODE.STARTER) {
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
    saas: {
      planCode,
      subscriptionStatus: planCode === SAAS_PLAN_CODE.TRIAL ? "TRIAL" : "ACTIVE",
    },
  });
}

async function installCustomPlan(
  organizationId: string,
  options: {
    omitKeys?: string[];
    members?: number | "UNLIMITED";
    leadsEnabled?: boolean;
    trainersEnabled?: boolean;
    reportsEnabled?: boolean;
  } = {},
) {
  await syncSaasPlanCatalog();
  const omit = new Set(options.omitKeys ?? []);
  const plan = await prisma.saasPlan.create({
    data: {
      id: generateId(),
      code: `h-${uniqueSuffix()}`.slice(0, 32),
      name: "Phase H usage plan",
      priceMonthly: "0.00",
      priceYearly: "0.00",
      trialDays: 14,
    },
  });
  fixturePlanIds.push(plan.id);

  const rows = SAAS_PLAN_CATALOG.find((seed) => seed.code === SAAS_PLAN_CODE.STARTER)!.entitlements
    .filter((row) => !omit.has(row.key))
    .map((row) => {
      if (row.key === SAAS_ENTITLEMENT_KEY.MEMBERS_MAX && options.members !== undefined) {
        return options.members === "UNLIMITED"
          ? { key: row.key, valueType: "UNLIMITED" as const, intValue: null, boolValue: null }
          : { key: row.key, valueType: "LIMIT" as const, intValue: options.members, boolValue: null };
      }
      if (row.key === SAAS_ENTITLEMENT_KEY.LEADS && options.leadsEnabled !== undefined) {
        return { key: row.key, valueType: "BOOLEAN" as const, intValue: null, boolValue: options.leadsEnabled };
      }
      if (row.key === SAAS_ENTITLEMENT_KEY.TRAINERS && options.trainersEnabled !== undefined) {
        return { key: row.key, valueType: "BOOLEAN" as const, intValue: null, boolValue: options.trainersEnabled };
      }
      if (row.key === SAAS_ENTITLEMENT_KEY.REPORTS_ENABLED && options.reportsEnabled !== undefined) {
        return { key: row.key, valueType: "BOOLEAN" as const, intValue: null, boolValue: options.reportsEnabled };
      }
      return {
        key: row.key,
        valueType: row.valueType,
        intValue: row.valueType === "LIMIT" ? row.intValue : null,
        boolValue: row.valueType === "BOOLEAN" ? row.boolValue : null,
      };
    });

  for (const row of rows) {
    await prisma.saasPlanEntitlement.create({
      data: { id: generateId(), planId: plan.id, ...row },
    });
  }

  await prisma.organizationSubscription.update({
    where: { organizationId },
    data: { planId: plan.id },
  });
  return plan;
}

async function addMember(
  organizationId: string,
  branchId: string,
  extras: { status?: "ACTIVE" | "INACTIVE" | "ARCHIVED"; deletedAt?: Date | null } = {},
) {
  return prisma.member.create({
    data: {
      id: generateId(),
      organizationId,
      branchId,
      firstName: "Usage",
      lastName: uniqueSuffix(),
      phone: uniquePhone(),
      status: extras.status ?? "ACTIVE",
      deletedAt: extras.deletedAt ?? null,
    },
  });
}

async function addLead(organizationId: string, branchId: string, status: "NEW" | "CONVERTED" | "LOST" = "NEW") {
  return prisma.lead.create({
    data: {
      id: generateId(),
      organizationId,
      branchId,
      name: `Lead ${uniqueSuffix()}`,
      phone: uniquePhone(),
      status,
    },
  });
}

async function addTrainer(organizationId: string, branchId: string, roleId: string) {
  const suffix = uniqueSuffix();
  const user = await prisma.user.create({
    data: {
      id: generateId(),
      organizationId,
      branchId,
      name: `Trainer ${suffix}`,
      email: `trainer-${suffix}@example.test`,
      passwordHash: await hashPassword(TEST_PASSWORD),
      roleId,
    },
  });
  return prisma.trainerProfile.create({
    data: {
      id: generateId(),
      organizationId,
      userId: user.id,
    },
  });
}

async function getUsage(token: string, organizationId: string, extras: { query?: Record<string, string>; body?: object } = {}) {
  const req = request(app).get(`${BASE}/organizations/${organizationId}/usage`);
  if (extras.query) req.query(extras.query);
  return req.set("Authorization", `Bearer ${token}`).send(extras.body ?? {});
}

describe("platform organization usage (Phase H)", () => {
  afterAll(async () => {
    await syncSaasPlanCatalog();
    const trial = await prisma.saasPlan.findUnique({ where: { code: SAAS_PLAN_CODE.TRIAL } });
    if (!trial || fixturePlanIds.length === 0) return;
    await prisma.organizationSubscription.updateMany({
      where: { planId: { in: fixturePlanIds } },
      data: { planId: trial.id },
    });
    await prisma.saasPlanEntitlement.deleteMany({ where: { planId: { in: fixturePlanIds } } });
    await prisma.saasPlan.deleteMany({ where: { id: { in: fixturePlanIds } } });
  });

  it("returns current counts, finite limits, remaining, features, and deferred unavailable metrics", async () => {
    const operator = await createPlatformOperator();
    const gym = await provisionGym("PhaseHCounts", SAAS_PLAN_CODE.STARTER);
    const starter = await catalogPlan(SAAS_PLAN_CODE.STARTER);

    await addMember(gym.organization.id, gym.branch.id);
    await addMember(gym.organization.id, gym.branch.id);
    await addMember(gym.organization.id, gym.branch.id, { status: "INACTIVE" });
    await addMember(gym.organization.id, gym.branch.id, { status: "ARCHIVED" });
    await addMember(gym.organization.id, gym.branch.id, { deletedAt: new Date() });
    await prisma.branch.create({
      data: { id: generateId(), organizationId: gym.organization.id, name: `Second ${uniqueSuffix()}` },
    });
    await prisma.user.create({
      data: {
        id: generateId(),
        organizationId: gym.organization.id,
        name: `Staff ${uniqueSuffix()}`,
        email: `staff-${uniqueSuffix()}@example.test`,
        passwordHash: await hashPassword(TEST_PASSWORD),
        roleId: gym.roleIdByName.get("RECEPTIONIST")!,
        deletedAt: new Date(),
      },
    });
    const liveStaff = await prisma.user.create({
      data: {
        id: generateId(),
        organizationId: gym.organization.id,
        name: `Staff ${uniqueSuffix()}`,
        email: `staff-live-${uniqueSuffix()}@example.test`,
        passwordHash: await hashPassword(TEST_PASSWORD),
        roleId: gym.roleIdByName.get("RECEPTIONIST")!,
      },
    });
    await addTrainer(gym.organization.id, gym.branch.id, gym.roleIdByName.get("TRAINER")!);
    await addLead(gym.organization.id, gym.branch.id, "NEW");
    await addLead(gym.organization.id, gym.branch.id, "CONVERTED");

    const res = await getUsage(operator.accessToken, gym.organization.id);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.organization).toEqual({
      id: gym.organization.id,
      name: gym.organization.name,
      slug: gym.organization.slug,
    });
    expect(res.body.data.subscription).toMatchObject({
      status: "ACTIVE",
      billingInterval: "MONTHLY",
      plan: { id: starter.id, code: SAAS_PLAN_CODE.STARTER, name: starter.name },
    });

    expect(res.body.data.usage.members).toEqual({
      used: 3,
      limit: 200,
      unlimited: false,
      remaining: 197,
      overLimit: false,
    });
    expect(res.body.data.usage.branches).toEqual({
      used: 2,
      limit: 1,
      unlimited: false,
      remaining: 0,
      overLimit: true,
    });
    expect(res.body.data.usage.staff).toEqual({
      used: 3,
      limit: 8,
      unlimited: false,
      remaining: 5,
      overLimit: false,
    });
    expect(res.body.data.usage.trainers).toEqual({
      used: 1,
      limit: null,
      unlimited: false,
      remaining: null,
      overLimit: false,
    });
    expect(res.body.data.usage.leads).toEqual({
      used: 2,
      limit: null,
      unlimited: false,
      remaining: null,
      overLimit: false,
    });

    for (const key of ["storage", "monthlySms", "whatsapp", "onlinePayments"] as const) {
      expect(res.body.data.usage[key]).toEqual({ available: false, reason: "NO_CONSUMPTION_PATH" });
      expect(res.body.data.usage[key].used).toBeUndefined();
    }

    expect(res.body.data.features).toEqual({
      leads: { enabled: true },
      trainers: { enabled: true },
      reports: { enabled: true },
      notifications: { enabled: true },
      whatsapp: { enabled: false },
      onlinePayments: { enabled: false },
    });
    expect(JSON.stringify(res.body)).not.toMatch(SECRET_LEAK);
    expect(liveStaff.passwordHash).toBeTruthy();
  });

  it("reports unlimited limits as null remaining and follows the live plan immediately", async () => {
    const operator = await createPlatformOperator();
    const gym = await provisionGym("PhaseHUnlimited", SAAS_PLAN_CODE.STARTER);
    await addMember(gym.organization.id, gym.branch.id);
    await addMember(gym.organization.id, gym.branch.id);

    const starter = await getUsage(operator.accessToken, gym.organization.id);
    expect(starter.status).toBe(200);
    expect(starter.body.data.subscription.plan.code).toBe(SAAS_PLAN_CODE.STARTER);
    expect(starter.body.data.usage.members).toMatchObject({
      used: 2,
      limit: 200,
      unlimited: false,
      remaining: 198,
      overLimit: false,
    });

    const growth = await catalogPlan(SAAS_PLAN_CODE.GROWTH);
    const assigned = await request(app)
      .patch(`${BASE}/organizations/${gym.organization.id}/subscription`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({ planId: growth.id, status: "ACTIVE" });
    expect(assigned.status).toBe(200);

    const afterGrowth = await getUsage(operator.accessToken, gym.organization.id);
    expect(afterGrowth.body.data.subscription.plan.code).toBe(SAAS_PLAN_CODE.GROWTH);
    expect(afterGrowth.body.data.usage.members).toEqual({
      used: 2,
      limit: null,
      unlimited: true,
      remaining: null,
      overLimit: false,
    });
    expect(afterGrowth.body.data.usage.staff.unlimited).toBe(true);
    expect(afterGrowth.body.data.usage.staff.limit).toBeNull();
    expect(afterGrowth.body.data.features.trainers.enabled).toBe(true);

    const trial = await catalogPlan(SAAS_PLAN_CODE.TRIAL);
    const downgraded = await request(app)
      .patch(`${BASE}/organizations/${gym.organization.id}/subscription`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({ planId: trial.id, status: "TRIAL" });
    expect(downgraded.status).toBe(200);

    const afterTrial = await getUsage(operator.accessToken, gym.organization.id);
    expect(afterTrial.body.data.subscription.plan.code).toBe(SAAS_PLAN_CODE.TRIAL);
    expect(afterTrial.body.data.usage.members).toEqual({
      used: 2,
      limit: 50,
      unlimited: false,
      remaining: 48,
      overLimit: false,
    });
    expect(afterTrial.body.data.features.trainers.enabled).toBe(false);
    expect(afterTrial.body.data.features.leads.enabled).toBe(false);
    expect(await prisma.member.count({ where: { organizationId: gym.organization.id } })).toBe(2);
  });

  it("marks overLimit after a downgrade below current usage without deleting data", async () => {
    const operator = await createPlatformOperator();
    const gym = await provisionGym("PhaseHOver", SAAS_PLAN_CODE.STARTER);
    const first = await addMember(gym.organization.id, gym.branch.id);
    const second = await addMember(gym.organization.id, gym.branch.id);
    const third = await addMember(gym.organization.id, gym.branch.id);

    await installCustomPlan(gym.organization.id, { members: 1 });
    const res = await getUsage(operator.accessToken, gym.organization.id);
    expect(res.status).toBe(200);
    expect(res.body.data.usage.members).toEqual({
      used: 3,
      limit: 1,
      unlimited: false,
      remaining: 0,
      overLimit: true,
    });
    expect(await prisma.member.findMany({ where: { id: { in: [first.id, second.id, third.id] } } })).toHaveLength(3);
    expect(res.body.data.usage.storage).toEqual({ available: false, reason: "NO_CONSUMPTION_PATH" });
    expect(JSON.stringify(res.body)).not.toMatch(SECRET_LEAK);
  });

  it("fails missing entitlements safely and keeps boolean features disabled", async () => {
    const operator = await createPlatformOperator();
    const gym = await provisionGym("PhaseHMissing", SAAS_PLAN_CODE.STARTER);
    await addMember(gym.organization.id, gym.branch.id);
    await addMember(gym.organization.id, gym.branch.id);

    await installCustomPlan(gym.organization.id, {
      omitKeys: [
        SAAS_ENTITLEMENT_KEY.MEMBERS_MAX,
        SAAS_ENTITLEMENT_KEY.REPORTS_ENABLED,
        SAAS_ENTITLEMENT_KEY.TRAINERS,
      ],
      leadsEnabled: false,
    });

    const res = await getUsage(operator.accessToken, gym.organization.id);
    expect(res.status).toBe(200);
    expect(res.body.data.usage.members).toEqual({
      used: 2,
      limit: 0,
      unlimited: false,
      remaining: 0,
      overLimit: true,
    });
    expect(res.body.data.features.reports.enabled).toBe(false);
    expect(res.body.data.features.trainers.enabled).toBe(false);
    expect(res.body.data.features.leads.enabled).toBe(false);
    expect(res.body.data.usage.trainers.limit).toBeNull();
    expect(res.body.data.usage.monthlySms).toEqual({ available: false, reason: "NO_CONSUMPTION_PATH" });
  });

  it("isolates organization counts and ignores query/body organizationId smuggling", async () => {
    const operator = await createPlatformOperator();
    const a = await provisionGym("PhaseHIsoA", SAAS_PLAN_CODE.STARTER);
    const b = await provisionGym("PhaseHIsoB", SAAS_PLAN_CODE.STARTER);
    await addMember(a.organization.id, a.branch.id);
    await addMember(b.organization.id, b.branch.id);
    await addMember(b.organization.id, b.branch.id);
    await addMember(b.organization.id, b.branch.id);
    await addLead(b.organization.id, b.branch.id);

    const res = await getUsage(operator.accessToken, a.organization.id, {
      query: { organizationId: b.organization.id },
      body: { organizationId: b.organization.id },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.organization.id).toBe(a.organization.id);
    expect(res.body.data.usage.members.used).toBe(1);
    expect(res.body.data.usage.leads.used).toBe(0);
    expect(res.body.data.organization.id).not.toBe(b.organization.id);
    expect(res.body.data.usage.members.used).not.toBe(3);

    const other = await getUsage(operator.accessToken, b.organization.id);
    expect(other.body.data.usage.members.used).toBe(3);
    expect(other.body.data.usage.leads.used).toBe(1);
  });

  it("returns 404 for a missing organization and 401 for staff or member JWTs", async () => {
    const operator = await createPlatformOperator();
    const staff = await createActor(await createTestTenant("PhaseHDeny"), "OWNER");
    const phone = uniquePhone();
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
    const member = await loginMember(staff.organization.slug, phone);
    expect(member.status).toBe(200);

    const missing = await getUsage(operator.accessToken, "01MISSINGORGUSAGE000000000");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("ORGANIZATION_NOT_FOUND");

    const staffRes = await request(app)
      .get(`${BASE}/organizations/${staff.organization.id}/usage`)
      .set(...bearer(staff));
    expect(staffRes.status).toBe(401);

    const memberRes = await request(app)
      .get(`${BASE}/organizations/${staff.organization.id}/usage`)
      .set("Authorization", `Bearer ${member.body.data.accessToken}`);
    expect(memberRes.status).toBe(401);

    const unauth = await request(app).get(`${BASE}/organizations/${staff.organization.id}/usage`);
    expect(unauth.status).toBe(401);
    expect(JSON.stringify(missing.body)).not.toMatch(SECRET_LEAK);
  });
});
