import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../../test/helpers/app";
import { TEST_PASSWORD } from "../../../test/helpers/auth";
import { uniqueSuffix } from "../../../test/helpers/fixtures";
import { generateId } from "../../lib/id";
import { prisma } from "../../lib/prisma";
import { provisionOrganization } from "../organizations/organization-provisioning.service";
import {
  SAAS_ENTITLEMENT_KEY,
  SAAS_PLAN_CATALOG,
  SAAS_PLAN_CODE,
  ensureOrganizationSubscription,
  syncSaasPlanCatalog,
} from "./saas-catalog";
import { getOrganizationSaasSnapshot } from "./saas-entitlements.service";

describe("SaaS catalog (Phase 15.5)", () => {
  it("inserts the documented plans and entitlements without duplicating on re-run", async () => {
    await syncSaasPlanCatalog();
    await syncSaasPlanCatalog();

    const plans = await prisma.saasPlan.findMany({ orderBy: { code: "asc" } });
    expect(plans.map((p) => p.code)).toEqual(
      expect.arrayContaining([SAAS_PLAN_CODE.GROWTH, SAAS_PLAN_CODE.STARTER, SAAS_PLAN_CODE.TRIAL]),
    );

    for (const seed of SAAS_PLAN_CATALOG) {
      const plan = plans.find((p) => p.code === seed.code);
      expect(plan).toBeDefined();
      const rows = await prisma.saasPlanEntitlement.findMany({ where: { planId: plan!.id } });
      expect(rows).toHaveLength(seed.entitlements.length);
      expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    }

    const growth = plans.find((p) => p.code === SAAS_PLAN_CODE.GROWTH)!;
    const growthKeys = await prisma.saasPlanEntitlement.findMany({ where: { planId: growth.id } });
    expect(growthKeys.find((r) => r.key === SAAS_ENTITLEMENT_KEY.MEMBERS_MAX)?.valueType).toBe(
      "UNLIMITED",
    );
    expect(growthKeys.find((r) => r.key === SAAS_ENTITLEMENT_KEY.STAFF_MAX)?.valueType).toBe(
      "UNLIMITED",
    );
    expect(growthKeys.find((r) => r.key === SAAS_ENTITLEMENT_KEY.BRANCHES_MAX)?.intValue).toBe(5);
  });

  it("does not overwrite Super Admin plan edits when provisionOrganization syncs the catalog", async () => {
    await syncSaasPlanCatalog();
    const growth = await prisma.saasPlan.findUniqueOrThrow({ where: { code: SAAS_PLAN_CODE.GROWTH } });
    const memberMax = await prisma.saasPlanEntitlement.findUniqueOrThrow({
      where: { planId_key: { planId: growth.id, key: SAAS_ENTITLEMENT_KEY.MEMBERS_MAX } },
    });
    const before = {
      name: growth.name,
      priceMonthly: growth.priceMonthly.toFixed(2),
      valueType: memberMax.valueType,
      intValue: memberMax.intValue,
    };

    try {
      await prisma.saasPlan.update({
        where: { id: growth.id },
        data: { name: "Growth Plus", priceMonthly: "999.00" },
      });
      await prisma.saasPlanEntitlement.update({
        where: { id: memberMax.id },
        data: { valueType: "LIMIT", intValue: 10, boolValue: null },
      });

      const suffix = uniqueSuffix();
      await provisionOrganization({
        organization: {
          name: `No Clobber ${suffix}`,
          slug: `no-clobber-${suffix}`,
          email: `no-clobber-${suffix}@example.test`,
        },
        owner: {
          name: `Owner ${suffix}`,
          email: `no-clobber-owner-${suffix}@example.test`,
          password: TEST_PASSWORD,
        },
      });

      const after = await prisma.saasPlan.findUniqueOrThrow({ where: { id: growth.id } });
      const afterEnt = await prisma.saasPlanEntitlement.findUniqueOrThrow({ where: { id: memberMax.id } });
      expect(after.name).toBe("Growth Plus");
      expect(after.priceMonthly.toFixed(2)).toBe("999.00");
      expect(afterEnt.valueType).toBe("LIMIT");
      expect(afterEnt.intValue).toBe(10);
    } finally {
      await prisma.saasPlan.update({
        where: { id: growth.id },
        data: { name: before.name, priceMonthly: before.priceMonthly },
      });
      await prisma.saasPlanEntitlement.update({
        where: { id: memberMax.id },
        data: { valueType: before.valueType, intValue: before.intValue, boolValue: null },
      });
    }
  });

  it("attaches a trial subscription on provisionOrganization and does not duplicate it", async () => {
    const suffix = uniqueSuffix();
    const result = await provisionOrganization({
      organization: {
        name: `SaaS Gym ${suffix}`,
        slug: `saas-gym-${suffix}`,
        email: `saas-${suffix}@example.test`,
      },
      owner: {
        name: `Owner ${suffix}`,
        email: `saas-owner-${suffix}@example.test`,
        password: TEST_PASSWORD,
      },
    });

    expect(result.subscription.planCode).toBe(SAAS_PLAN_CODE.TRIAL);
    expect(result.subscription.status).toBe("TRIAL");
    expect(await prisma.organizationSubscription.count({ where: { organizationId: result.organization.id } })).toBe(1);

    const again = await ensureOrganizationSubscription(result.organization.id, {
      planCode: SAAS_PLAN_CODE.GROWTH,
      status: "ACTIVE",
    });
    expect(again.created).toBe(false);
    expect(again.id).toBe(result.subscription.id);
    expect(again.planCode).toBe(SAAS_PLAN_CODE.TRIAL);
    expect(await prisma.organizationSubscription.count({ where: { organizationId: result.organization.id } })).toBe(1);
  });

  it("backfills Demo-style growth only when a subscription is missing", async () => {
    const suffix = uniqueSuffix();
    const org = await prisma.organization.create({
      data: {
        id: generateId(),
        name: `Legacy Gym ${suffix}`,
        slug: `legacy-gym-${suffix}`,
        email: `legacy-${suffix}@example.test`,
      },
    });

    await syncSaasPlanCatalog();
    const first = await ensureOrganizationSubscription(org.id, {
      planCode: SAAS_PLAN_CODE.GROWTH,
      status: "ACTIVE",
      billingInterval: "YEARLY",
    });
    const second = await ensureOrganizationSubscription(org.id, {
      planCode: SAAS_PLAN_CODE.GROWTH,
      status: "ACTIVE",
      billingInterval: "YEARLY",
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
    expect(first.planCode).toBe(SAAS_PLAN_CODE.GROWTH);
    expect(await prisma.organizationSubscription.count({ where: { organizationId: org.id } })).toBe(1);
  });

  it("does not leak org B's subscription when reading org A's snapshot", async () => {
    const a = await provisionOrganization({
      organization: {
        name: `Iso A ${uniqueSuffix()}`,
        slug: `iso-a-${uniqueSuffix()}`,
        email: `iso-a-${uniqueSuffix()}@example.test`,
      },
      owner: { name: "A", email: `iso-a-owner-${uniqueSuffix()}@example.test`, password: TEST_PASSWORD },
    });
    const b = await provisionOrganization({
      organization: {
        name: `Iso B ${uniqueSuffix()}`,
        slug: `iso-b-${uniqueSuffix()}`,
        email: `iso-b-${uniqueSuffix()}@example.test`,
      },
      owner: { name: "B", email: `iso-b-owner-${uniqueSuffix()}@example.test`, password: TEST_PASSWORD },
      saas: { planCode: SAAS_PLAN_CODE.GROWTH, subscriptionStatus: "ACTIVE" },
    });

    const snapA = await getOrganizationSaasSnapshot(a.organization.id);
    const snapB = await getOrganizationSaasSnapshot(b.organization.id);
    expect(snapA?.plan.code).toBe(SAAS_PLAN_CODE.TRIAL);
    expect(snapB?.plan.code).toBe(SAAS_PLAN_CODE.GROWTH);
    expect(snapA?.subscriptionId).not.toBe(snapB?.subscriptionId);
    expect(snapA?.organizationId).toBe(a.organization.id);
    expect(snapB?.organizationId).toBe(b.organization.id);
    expect(snapA?.entitlements.some((e) => e.key === SAAS_ENTITLEMENT_KEY.MEMBERS_MAX)).toBe(true);
  });

  it("lets a newly provisioned OWNER create a member (limits not enforced in 15.5)", async () => {
    const suffix = uniqueSuffix();
    const result = await provisionOrganization({
      organization: {
        name: `Member Gym ${suffix}`,
        slug: `member-gym-${suffix}`,
        email: `member-gym-${suffix}@example.test`,
      },
      owner: {
        name: `Owner ${suffix}`,
        email: `member-owner-${suffix}@example.test`,
        password: TEST_PASSWORD,
      },
    });

    const login = await request(app).post("/api/v1/auth/login").send({
      email: `member-owner-${suffix}@example.test`,
      password: TEST_PASSWORD,
    });
    expect(login.status).toBe(200);

    const created = await request(app)
      .post(`/api/v1/organizations/${result.organization.id}/members`)
      .set("Authorization", `Bearer ${login.body.data.accessToken}`)
      .send({
        firstName: "New",
        lastName: "Member",
        phone: `+91976${Date.now().toString().slice(-7)}`,
        branchId: result.branch.id,
      });
    expect(created.status).toBe(201);
    expect(created.body.data.organizationId).toBe(result.organization.id);
  });

  it("does not expose a gym API to read or change another org's SaaS subscription", async () => {
    const a = await provisionOrganization({
      organization: {
        name: `NoApi A ${uniqueSuffix()}`,
        slug: `noapi-a-${uniqueSuffix()}`,
        email: `noapi-a-${uniqueSuffix()}@example.test`,
      },
      owner: { name: "A", email: `noapi-a-${uniqueSuffix()}@example.test`, password: TEST_PASSWORD },
    });
    const login = await request(app).post("/api/v1/auth/login").send({
      email: a.owner.email,
      password: TEST_PASSWORD,
    });

    const list = await request(app)
      .get("/api/v1/platform/plans")
      .set("Authorization", `Bearer ${login.body.data.accessToken}`);
    expect(list.status).toBe(401);
    expect(list.body.error.code).toBe("INVALID_TOKEN");

    const patch = await request(app)
      .patch(`/api/v1/organizations/${a.organization.id}/subscription`)
      .set("Authorization", `Bearer ${login.body.data.accessToken}`)
      .send({ planId: "x", organizationId: a.organization.id });
    expect(patch.status).toBe(404);
  });
});
