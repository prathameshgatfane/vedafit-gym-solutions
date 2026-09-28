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

const BASE = "/api/v1/platform";

function uniquePhone() {
  const n = `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`.slice(-10);
  return `+91${n}`;
}

function signupBody(suffix: string) {
  return {
    name: `Plat Org ${suffix}`,
    slug: `plat-org-${suffix}`,
    email: `plat-org-${suffix}@example.test`,
    owner: {
      name: `Owner ${suffix}`,
      email: `plat-owner-${suffix}@example.test`,
      password: TEST_PASSWORD,
    },
  };
}

async function catalogPlanId(code: string) {
  await syncSaasPlanCatalog();
  const plan = await prisma.saasPlan.findUniqueOrThrow({ where: { code } });
  return plan.id;
}

async function operatorCreateBody(suffix: string, extras: Record<string, unknown> = {}) {
  return {
    ...signupBody(suffix),
    planId: await catalogPlanId(SAAS_PLAN_CODE.TRIAL),
    ...extras,
  };
}

async function loginMember(organizationSlug: string, phone: string) {
  return request(app).post("/api/v1/auth/member/login").send({
    phone,
    password: TEST_PASSWORD,
    organizationSlug,
  });
}

describe("platform organization APIs (Phase 15.8)", () => {
  it("rejects staff, member, and unauthenticated callers on every 15.8 route", async () => {
    const staff = await createActor(await createTestTenant("PlatDeny"), "OWNER");
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

    const routes: Array<[string, string]> = [
      ["get", `${BASE}/organizations`],
      ["get", `${BASE}/organizations/${staff.organization.id}`],
      ["get", `${BASE}/organizations/${staff.organization.id}/usage`],
      ["post", `${BASE}/organizations`],
      ["patch", `${BASE}/organizations/${staff.organization.id}/subscription`],
      ["get", `${BASE}/plans`],
      ["post", `${BASE}/plans`],
      ["get", `${BASE}/plans/not-a-plan`],
      ["patch", `${BASE}/plans/not-a-plan`],
      ["post", `${BASE}/plans/not-a-plan/activate`],
      ["post", `${BASE}/plans/not-a-plan/archive`],
      ["get", `${BASE}/dashboard`],
    ];

    const call = (method: "get" | "post" | "patch", url: string) => request(app)[method](url);

    for (const [method, url] of routes) {
      const unauth = await call(method as "get" | "post" | "patch", url).send({});
      expect(unauth.status).toBe(401);

      const staffRes = await call(method as "get" | "post" | "patch", url)
        .set(...bearer(staff))
        .send({});
      expect(staffRes.status).toBe(401);

      const memberRes = await call(method as "get" | "post" | "patch", url)
        .set("Authorization", `Bearer ${member.body.data.accessToken}`)
        .send({});
      expect(memberRes.status).toBe(401);
    }
  });

  it("lists organizations with 1.9 pagination, search, status filter, and subscription status", async () => {
    const operator = await createPlatformOperator();
    const marker = `list-${uniqueSuffix()}`;
    const a = await provisionOrganization({
      organization: {
        name: `Alpha ${marker}`,
        slug: `alpha-${marker}`,
        email: `alpha-${marker}@example.test`,
      },
      owner: { name: "A", email: `alpha-o-${marker}@example.test`, password: TEST_PASSWORD },
    });
    const b = await provisionOrganization({
      organization: {
        name: `Beta ${marker}`,
        slug: `beta-${marker}`,
        email: `beta-${marker}@example.test`,
      },
      owner: { name: "B", email: `beta-o-${marker}@example.test`, password: TEST_PASSWORD },
    });

    await request(app)
      .patch(`${BASE}/organizations/${b.organization.id}/status`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({ status: "SUSPENDED" });

    const page1 = await request(app)
      .get(`${BASE}/organizations`)
      .query({ search: marker, sortBy: "name", sortOrder: "asc", page: 1, limit: 1 })
      .set("Authorization", `Bearer ${operator.accessToken}`);
    expect(page1.status).toBe(200);
    expect(page1.body.data).toHaveLength(1);
    expect(page1.body.data[0].name).toBe(`Alpha ${marker}`);
    expect(page1.body.data[0].subscription.status).toBe("TRIAL");
    expect(page1.body.data[0].subscription.planCode).toBe(SAAS_PLAN_CODE.TRIAL);
    expect(page1.body.pagination).toMatchObject({ page: 1, limit: 1, total: 2, totalPages: 2 });
    expect(JSON.stringify(page1.body)).not.toMatch(/passwordHash|refreshToken|\$2a\$/i);

    const page2 = await request(app)
      .get(`${BASE}/organizations`)
      .query({ search: marker, sortBy: "name", sortOrder: "asc", page: 2, limit: 1 })
      .set("Authorization", `Bearer ${operator.accessToken}`);
    expect(page2.body.data[0].id).toBe(b.organization.id);
    expect(page2.body.data[0].status).toBe("SUSPENDED");
    expect(page2.body.data[0].subscription.status).toBe("TRIAL");

    const suspended = await request(app)
      .get(`${BASE}/organizations`)
      .query({ search: marker, status: "SUSPENDED" })
      .set("Authorization", `Bearer ${operator.accessToken}`);
    expect(suspended.body.data).toHaveLength(1);
    expect(suspended.body.data[0].id).toBe(b.organization.id);

    expect(page1.body.data.find((row: { id: string }) => row.id === a.organization.id) || page2.body.data[0])
      .toBeTruthy();
    expect(page1.body.data.every((row: { id: string }) => row.id !== b.organization.id)).toBe(true);
  });

  it("returns org detail with OWNER email, subscription, and entitlements — not another org's plan", async () => {
    const operator = await createPlatformOperator();
    const trial = await provisionOrganization({
      organization: {
        name: `Detail Trial ${uniqueSuffix()}`,
        slug: `detail-trial-${uniqueSuffix()}`,
        email: `detail-trial-${uniqueSuffix()}@example.test`,
      },
      owner: {
        name: "Trial Owner",
        email: `detail-trial-o-${uniqueSuffix()}@example.test`,
        password: TEST_PASSWORD,
      },
    });
    const growth = await provisionOrganization({
      organization: {
        name: `Detail Growth ${uniqueSuffix()}`,
        slug: `detail-growth-${uniqueSuffix()}`,
        email: `detail-growth-${uniqueSuffix()}@example.test`,
      },
      owner: {
        name: "Growth Owner",
        email: `detail-growth-o-${uniqueSuffix()}@example.test`,
        password: TEST_PASSWORD,
      },
      saas: { planCode: SAAS_PLAN_CODE.GROWTH, subscriptionStatus: "ACTIVE" },
    });

    const res = await request(app)
      .get(`${BASE}/organizations/${trial.organization.id}`)
      .set("Authorization", `Bearer ${operator.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.organization.id).toBe(trial.organization.id);
    expect(res.body.data.owner.email).toBe(trial.owner.email);
    expect(res.body.data.subscription.status).toBe("TRIAL");
    expect(res.body.data.subscription.plan.code).toBe(SAAS_PLAN_CODE.TRIAL);
    expect(res.body.data.entitlements.find((e: { key: string }) => e.key === "leads")?.boolValue).toBe(
      false,
    );
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|refreshToken|\$2a\$/i);
    expect(res.body.data.owner).not.toHaveProperty("passwordHash");

    const other = await request(app)
      .get(`${BASE}/organizations/${growth.organization.id}`)
      .set("Authorization", `Bearer ${operator.accessToken}`);
    expect(other.body.data.subscription.plan.code).toBe(SAAS_PLAN_CODE.GROWTH);
    expect(other.body.data.subscription.id).not.toBe(res.body.data.subscription.id);
    expect(other.body.data.entitlements.find((e: { key: string }) => e.key === "leads")?.boolValue).toBe(
      true,
    );

    const missing = await request(app)
      .get(`${BASE}/organizations/not-a-real-org`)
      .set("Authorization", `Bearer ${operator.accessToken}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("ORGANIZATION_NOT_FOUND");
  });

  it("creates an org as the platform operator (trial, no auto-login)", async () => {
    const operator = await createPlatformOperator();
    const suffix = uniqueSuffix();
    const res = await request(app)
      .post(`${BASE}/organizations`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send(await operatorCreateBody(suffix));
    expect(res.status).toBe(201);
    expect(res.body.data.accessToken).toBeUndefined();
    expect(res.body.data.organization.status).toBe("ACTIVE");
    expect(res.body.data.owner.email).toBe(`plat-owner-${suffix}@example.test`);
    expect(res.body.data.owner.password).toBeUndefined();
    expect(res.body.data.subscription).toMatchObject({
      planCode: SAAS_PLAN_CODE.TRIAL,
      status: "TRIAL",
    });
    expect(res.body.data.credentials).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|temporaryPassword|\$2[aby]\$/i);

    const login = await request(app).post("/api/v1/auth/login").send({
      email: `plat-owner-${suffix}@example.test`,
      password: TEST_PASSWORD,
    });
    expect(login.status).toBe(200);

    const sub = await prisma.organizationSubscription.findUniqueOrThrow({
      where: { organizationId: res.body.data.organization.id },
      include: { plan: true },
    });
    expect(sub.status).toBe("TRIAL");
    expect(sub.plan.code).toBe(SAAS_PLAN_CODE.TRIAL);
    expect(sub.billingInterval).toBe("MONTHLY");
  });

  it("provisions Growth + ACTIVE + YEARLY in the same transaction and exposes it on /auth/me", async () => {
    const operator = await createPlatformOperator();
    const suffix = uniqueSuffix();
    const growthId = await catalogPlanId(SAAS_PLAN_CODE.GROWTH);
    const periodEnd = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000).toISOString();

    const res = await request(app)
      .post(`${BASE}/organizations`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({
        ...signupBody(suffix),
        planId: growthId,
        subscriptionStatus: "ACTIVE",
        billingInterval: "YEARLY",
        currentPeriodEnd: periodEnd,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.accessToken).toBeUndefined();
    expect(res.body.data.subscription).toMatchObject({
      planCode: SAAS_PLAN_CODE.GROWTH,
      status: "ACTIVE",
    });

    const orgId = res.body.data.organization.id as string;
    const sub = await prisma.organizationSubscription.findUniqueOrThrow({
      where: { organizationId: orgId },
      include: { plan: true },
    });
    expect(sub.plan.code).toBe(SAAS_PLAN_CODE.GROWTH);
    expect(sub.status).toBe("ACTIVE");
    expect(sub.billingInterval).toBe("YEARLY");
    expect(sub.currentPeriodEnd.toISOString()).toBe(periodEnd);

    const login = await request(app).post("/api/v1/auth/login").send({
      email: `plat-owner-${suffix}@example.test`,
      password: TEST_PASSWORD,
    });
    expect(login.status).toBe(200);

    const me = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${login.body.data.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.organization.id).toBe(orgId);
    expect(me.body.data.saas.plan.code).toBe(SAAS_PLAN_CODE.GROWTH);
    expect(me.body.data.saas.subscription.status).toBe("ACTIVE");
    expect(JSON.stringify(me.body)).not.toMatch(/passwordHash|temporaryPassword|\$2[aby]\$/i);
  });

  it("returns a generated owner password once, then never again", async () => {
    const operator = await createPlatformOperator();
    const suffix = uniqueSuffix();
    const body = await operatorCreateBody(suffix);
    const { password: _ignored, ...ownerWithoutPassword } = body.owner as {
      name: string;
      email: string;
      password: string;
    };

    const res = await request(app)
      .post(`${BASE}/organizations`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({
        ...body,
        generatePassword: true,
        owner: { ...ownerWithoutPassword, password: "ClientSent1" },
      });
    expect(res.status).toBe(201);
    const temporaryPassword = res.body.data.credentials.temporaryPassword as string;
    expect(temporaryPassword).toHaveLength(10);
    expect(temporaryPassword).toMatch(/[a-z]/);
    expect(temporaryPassword).toMatch(/[A-Z]/);
    expect(temporaryPassword).toMatch(/[0-9]/);
    expect(temporaryPassword).not.toMatch(/[IlO0]/);
    expect(res.body.data.credentials.email).toBe(`plat-owner-${suffix}@example.test`);
    expect(res.body.data.accessToken).toBeUndefined();
    expect(res.body.data.refreshToken).toBeUndefined();
    expect(res.body.data.owner.password).toBeUndefined();
    expect(res.body.data.owner.passwordHash).toBeUndefined();

    const owner = await prisma.user.findUniqueOrThrow({
      where: { id: res.body.data.owner.id },
    });
    expect(owner.passwordHash).not.toBe(temporaryPassword);
    expect(owner.passwordHash).toMatch(/^\$2[aby]\$/);

    const clientLogin = await request(app).post("/api/v1/auth/login").send({
      email: `plat-owner-${suffix}@example.test`,
      password: "ClientSent1",
    });
    expect(clientLogin.status).toBe(401);

    const login = await request(app).post("/api/v1/auth/login").send({
      email: `plat-owner-${suffix}@example.test`,
      password: temporaryPassword,
    });
    expect(login.status).toBe(200);

    const me = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${login.body.data.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.organization.id).toBe(res.body.data.organization.id);
    expect(me.body.data.saas.plan.code).toBe(SAAS_PLAN_CODE.TRIAL);
    expect(me.body.data.saas.subscription.status).toBe("TRIAL");
    expect(JSON.stringify(me.body)).not.toMatch(/passwordHash|temporaryPassword|\$2[aby]\$/i);

    const detail = await request(app)
      .get(`${BASE}/organizations/${res.body.data.organization.id}`)
      .set("Authorization", `Bearer ${operator.accessToken}`);
    expect(detail.status).toBe(200);
    expect(JSON.stringify(detail.body)).not.toMatch(
      new RegExp(`${temporaryPassword}|passwordHash|temporaryPassword|\\$2[aby]\\$`),
    );

    const listed = await request(app)
      .get(`${BASE}/organizations`)
      .query({ search: suffix })
      .set("Authorization", `Bearer ${operator.accessToken}`);
    expect(JSON.stringify(listed.body)).not.toMatch(
      new RegExp(`${temporaryPassword}|passwordHash|temporaryPassword|\\$2[aby]\\$`),
    );

    const audit = await prisma.platformAuditLog.findFirstOrThrow({
      where: {
        organizationId: res.body.data.organization.id,
        action: "ORG_PROVISIONED",
      },
    });
    expect(audit.afterJson).toMatchObject({ credentialMode: "generated" });
    expect(JSON.stringify(audit)).not.toMatch(
      new RegExp(`${temporaryPassword}|passwordHash|temporaryPassword|\\$2[aby]\\$`),
    );

    const platformMe = await request(app)
      .get("/api/v1/auth/platform/me")
      .set("Authorization", `Bearer ${login.body.data.accessToken}`);
    expect(platformMe.status).toBe(401);
  });

  it("does not persist a generated password when provisioning fails", async () => {
    const operator = await createPlatformOperator();
    const suffix = uniqueSuffix();
    const first = await request(app)
      .post(`${BASE}/organizations`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send(await operatorCreateBody(suffix));
    expect(first.status).toBe(201);

    const retry = await request(app)
      .post(`${BASE}/organizations`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({
        ...(await operatorCreateBody(suffix)),
        generatePassword: true,
        owner: {
          name: `Other ${suffix}`,
          email: `other-owner-${suffix}@example.test`,
        },
      });
    expect(retry.status).toBe(409);
    expect(retry.body.error.code).toBe("DUPLICATE_ORGANIZATION_SLUG");
    expect(retry.body.data).toBeUndefined();
    expect(JSON.stringify(retry.body)).not.toMatch(/temporaryPassword/);
    expect(await prisma.user.count({ where: { email: `other-owner-${suffix}@example.test` } })).toBe(0);
  });

  it("rejects missing, unknown, inactive, past period end, and client entitlement fields without creating an org", async () => {
    const operator = await createPlatformOperator();
    const missing = await request(app)
      .post(`${BASE}/organizations`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send(signupBody(`missing-${uniqueSuffix()}`));
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe("VALIDATION_ERROR");

    const unknownSuffix = uniqueSuffix();
    const unknown = await request(app)
      .post(`${BASE}/organizations`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({ ...signupBody(unknownSuffix), planId: "not-a-real-plan" });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe("SAAS_PLAN_NOT_FOUND");
    expect(await prisma.organization.findUnique({ where: { slug: `plat-org-${unknownSuffix}` } })).toBeNull();

    const archived = await prisma.saasPlan.create({
      data: {
        id: generateId(),
        code: `d${uniqueSuffix().toLowerCase()}`.slice(0, 32),
        name: "Phase D Archived",
        priceMonthly: "10.00",
        priceYearly: "100.00",
        trialDays: 7,
        isActive: false,
      },
    });
    const inactiveSuffix = uniqueSuffix();
    const inactive = await request(app)
      .post(`${BASE}/organizations`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({ ...signupBody(inactiveSuffix), planId: archived.id });
    expect(inactive.status).toBe(409);
    expect(inactive.body.error.code).toBe("SAAS_PLAN_INACTIVE");
    expect(await prisma.organization.findUnique({ where: { slug: `plat-org-${inactiveSuffix}` } })).toBeNull();

    const pastSuffix = uniqueSuffix();
    const past = await request(app)
      .post(`${BASE}/organizations`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({
        ...(await operatorCreateBody(pastSuffix)),
        currentPeriodEnd: new Date(Date.now() - 60_000).toISOString(),
      });
    expect(past.status).toBe(400);
    expect(past.body.error.code).toBe("VALIDATION_ERROR");
    expect(await prisma.organization.findUnique({ where: { slug: `plat-org-${pastSuffix}` } })).toBeNull();

    const extraSuffix = uniqueSuffix();
    const extra = await request(app)
      .post(`${BASE}/organizations`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({
        ...(await operatorCreateBody(extraSuffix)),
        entitlements: [{ key: "members.max", valueType: "UNLIMITED" }],
        priceMonthly: "1.00",
      });
    expect(extra.status).toBe(400);
    expect(extra.body.error.code).toBe("VALIDATION_ERROR");
    expect(await prisma.organization.findUnique({ where: { slug: `plat-org-${extraSuffix}` } })).toBeNull();
  });

  it("assigns a catalog plan and subscription status without changing Organization.status or another org", async () => {
    const operator = await createPlatformOperator();
    await syncSaasPlanCatalog();
    const growth = await prisma.saasPlan.findUniqueOrThrow({ where: { code: SAAS_PLAN_CODE.GROWTH } });

    const target = await provisionOrganization({
      organization: {
        name: `Assign A ${uniqueSuffix()}`,
        slug: `assign-a-${uniqueSuffix()}`,
        email: `assign-a-${uniqueSuffix()}@example.test`,
      },
      owner: { name: "A", email: `assign-a-o-${uniqueSuffix()}@example.test`, password: TEST_PASSWORD },
    });
    const other = await provisionOrganization({
      organization: {
        name: `Assign B ${uniqueSuffix()}`,
        slug: `assign-b-${uniqueSuffix()}`,
        email: `assign-b-${uniqueSuffix()}@example.test`,
      },
      owner: { name: "B", email: `assign-b-o-${uniqueSuffix()}@example.test`, password: TEST_PASSWORD },
    });
    const otherBefore = await prisma.organizationSubscription.findUniqueOrThrow({
      where: { organizationId: other.organization.id },
    });

    const periodEnd = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000).toISOString();
    const patched = await request(app)
      .patch(`${BASE}/organizations/${target.organization.id}/subscription`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({ planId: growth.id, status: "ACTIVE", currentPeriodEnd: periodEnd });
    expect(patched.status).toBe(200);
    expect(patched.body.data.subscription.plan.code).toBe(SAAS_PLAN_CODE.GROWTH);
    expect(patched.body.data.subscription.status).toBe("ACTIVE");
    expect(patched.body.data.organization.status).toBe("ACTIVE");
    expect(patched.body.data.subscription.priceSnapshot).toBe("0.00");

    const targetOrg = await prisma.organization.findUniqueOrThrow({
      where: { id: target.organization.id },
    });
    expect(targetOrg.status).toBe("ACTIVE");

    const otherAfter = await prisma.organizationSubscription.findUniqueOrThrow({
      where: { organizationId: other.organization.id },
    });
    expect(otherAfter.planId).toBe(otherBefore.planId);
    expect(otherAfter.status).toBe(otherBefore.status);

    const smuggled = await request(app)
      .patch(`${BASE}/organizations/${target.organization.id}/subscription`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({
        planId: growth.id,
        organizationId: other.organization.id,
        entitlements: { "members.max": 1 },
      });
    expect(smuggled.status).toBe(400);
    expect(smuggled.body.error.code).toBe("VALIDATION_ERROR");

    const badPlan = await request(app)
      .patch(`${BASE}/organizations/${target.organization.id}/subscription`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({ planId: "not-a-plan" });
    expect(badPlan.status).toBe(404);
    expect(badPlan.body.error.code).toBe("SAAS_PLAN_NOT_FOUND");

    const missing = await request(app)
      .patch(`${BASE}/organizations/not-a-real-org/subscription`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({ status: "PAST_DUE" });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("ORGANIZATION_NOT_FOUND");
    expect(JSON.stringify(missing.body)).not.toMatch(/prisma|P20/i);
  });

  it("lists SaaS catalog plans and entitlements; prices stay 0.00 stubs", async () => {
    const operator = await createPlatformOperator();
    await syncSaasPlanCatalog();
    const res = await request(app)
      .get(`${BASE}/plans`)
      .set("Authorization", `Bearer ${operator.accessToken}`);
    expect(res.status).toBe(200);
    const codes = res.body.data.map((p: { code: string }) => p.code);
    expect(codes).toEqual(expect.arrayContaining(["trial", "starter", "growth"]));
    const growth = res.body.data.find((p: { code: string }) => p.code === "growth");
    expect(growth.priceMonthly).toBe("0.00");
    expect(growth.priceYearly).toBe("0.00");
    expect(growth.currency).toBe("INR");
    expect(growth.entitlements.find((e: { key: string }) => e.key === "members.max")?.valueType).toBe(
      "UNLIMITED",
    );
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2a\$/i);
  });

  it("returns dashboard counts for org status, trials ending, and signups this period", async () => {
    const operator = await createPlatformOperator();
    const res = await request(app)
      .get(`${BASE}/dashboard`)
      .set("Authorization", `Bearer ${operator.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.organizationsByStatus.ACTIVE).toEqual(expect.any(Number));
    expect(res.body.data.organizationsByStatus.SUSPENDED).toEqual(expect.any(Number));
    expect(res.body.data.trialsEnding).toEqual(expect.any(Number));
    expect(res.body.data.signupsThisPeriod).toEqual(expect.any(Number));
    expect(res.body.data.organizationsByStatus.ACTIVE).toBeGreaterThanOrEqual(0);
  });
});
