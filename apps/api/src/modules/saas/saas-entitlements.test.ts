import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../../test/helpers/app";
import { TEST_PASSWORD, createActorInNewTenant } from "../../../test/helpers/auth";
import { uniqueSuffix } from "../../../test/helpers/fixtures";
import { generateId } from "../../lib/id";
import { prisma } from "../../lib/prisma";
import { provisionOrganization } from "../organizations/organization-provisioning.service";
import { SAAS_ENTITLEMENT_KEY, SAAS_PLAN_CODE, syncSaasPlanCatalog } from "./saas-catalog";
import { assertEntitlement, getOrganizationSaasSnapshot } from "./saas-entitlements.service";

const fixturePlanIds: string[] = [];

async function loginOwner(email: string) {
  const res = await request(app).post("/api/v1/auth/login").send({
    email,
    password: TEST_PASSWORD,
  });
  expect(res.status).toBe(200);
  return res.body.data.accessToken as string;
}

async function provisionTrial() {
  const suffix = uniqueSuffix();
  const result = await provisionOrganization({
    organization: {
      name: `Trial Limit ${suffix}`,
      slug: `trial-limit-${suffix}`,
      email: `trial-limit-${suffix}@example.test`,
    },
    owner: {
      name: `Owner ${suffix}`,
      email: `trial-owner-${suffix}@example.test`,
      password: TEST_PASSWORD,
    },
  });
  const token = await loginOwner(result.owner.email);
  return { result, token };
}

async function installLimitPlan(
  organizationId: string,
  limits: {
    members?: number | "UNLIMITED";
    staff?: number | "UNLIMITED";
    branches?: number | "UNLIMITED";
    leads?: boolean;
  },
) {
  await syncSaasPlanCatalog();
  const plan = await prisma.saasPlan.create({
    data: {
      id: generateId(),
      code: `limit-${uniqueSuffix()}`,
      name: "Test limit plan",
      priceMonthly: "0.00",
      priceYearly: "0.00",
      trialDays: 14,
    },
  });

  const rows: {
    key: string;
    valueType: "LIMIT" | "UNLIMITED" | "BOOLEAN";
    intValue: number | null;
    boolValue: boolean | null;
  }[] = [];

  const addLimit = (key: string, value: number | "UNLIMITED" | undefined) => {
    if (value === undefined) return;
    if (value === "UNLIMITED") {
      rows.push({ key, valueType: "UNLIMITED", intValue: null, boolValue: null });
    } else {
      rows.push({ key, valueType: "LIMIT", intValue: value, boolValue: null });
    }
  };

  addLimit(SAAS_ENTITLEMENT_KEY.MEMBERS_MAX, limits.members);
  addLimit(SAAS_ENTITLEMENT_KEY.STAFF_MAX, limits.staff);
  addLimit(SAAS_ENTITLEMENT_KEY.BRANCHES_MAX, limits.branches);
  if (limits.leads !== undefined) {
    rows.push({
      key: SAAS_ENTITLEMENT_KEY.LEADS,
      valueType: "BOOLEAN",
      intValue: null,
      boolValue: limits.leads,
    });
  }

  for (const row of rows) {
    await prisma.saasPlanEntitlement.create({
      data: { id: generateId(), planId: plan.id, ...row },
    });
  }

  fixturePlanIds.push(plan.id);

  await prisma.organizationSubscription.update({
    where: { organizationId },
    data: { planId: plan.id },
  });
  return plan;
}

function uniquePhone(prefix = "971") {
  const n = `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`.slice(-7);
  return `+91${prefix}${n}`;
}

function memberPayload(branchId: string, suffix: string) {
  return {
    firstName: "Limit",
    lastName: suffix,
    phone: uniquePhone(),
    branchId,
  };
}

describe("assertEntitlement (Phase 15.6)", () => {
  afterAll(async () => {
    await syncSaasPlanCatalog();
    const trial = await prisma.saasPlan.findUnique({ where: { code: SAAS_PLAN_CODE.TRIAL } });
    if (!trial) return;

    const leftover = await prisma.saasPlan.findMany({
      where: { OR: [{ id: { in: fixturePlanIds } }, { code: { startsWith: "limit-" } }] },
      select: { id: true },
    });
    const ids = leftover.map((row) => row.id);
    if (ids.length === 0) return;

    await prisma.organizationSubscription.updateMany({
      where: { planId: { in: ids } },
      data: { planId: trial.id },
    });
    await prisma.saasPlanEntitlement.deleteMany({ where: { planId: { in: ids } } });
    await prisma.saasPlan.deleteMany({ where: { id: { in: ids } } });
  });

  it("resolves the org's own subscription and does not use another org's plan", async () => {
    const trial = await provisionOrganization({
      organization: {
        name: `Snap A ${uniqueSuffix()}`,
        slug: `snap-a-${uniqueSuffix()}`,
        email: `snap-a-${uniqueSuffix()}@example.test`,
      },
      owner: { name: "A", email: `snap-a-${uniqueSuffix()}@example.test`, password: TEST_PASSWORD },
    });
    const growth = await provisionOrganization({
      organization: {
        name: `Snap B ${uniqueSuffix()}`,
        slug: `snap-b-${uniqueSuffix()}`,
        email: `snap-b-${uniqueSuffix()}@example.test`,
      },
      owner: { name: "B", email: `snap-b-${uniqueSuffix()}@example.test`, password: TEST_PASSWORD },
      saas: { planCode: SAAS_PLAN_CODE.GROWTH, subscriptionStatus: "ACTIVE" },
    });

    const snapA = await getOrganizationSaasSnapshot(trial.organization.id);
    const snapB = await getOrganizationSaasSnapshot(growth.organization.id);
    expect(snapA?.plan.code).toBe(SAAS_PLAN_CODE.TRIAL);
    expect(snapB?.plan.code).toBe(SAAS_PLAN_CODE.GROWTH);
    expect(snapA?.subscriptionId).not.toBe(snapB?.subscriptionId);

    await expect(
      assertEntitlement(trial.organization.id, SAAS_ENTITLEMENT_KEY.LEADS),
    ).rejects.toMatchObject({ statusCode: 403, code: "FEATURE_DISABLED" });
    await expect(
      assertEntitlement(growth.organization.id, SAAS_ENTITLEMENT_KEY.LEADS),
    ).resolves.toBeUndefined();
  });

  it("enforces members.max: below limit succeeds, at limit fails, unlimited succeeds", async () => {
    const { result, token } = await provisionTrial();
    await installLimitPlan(result.organization.id, { members: 1 });

    const first = await request(app)
      .post(`/api/v1/organizations/${result.organization.id}/members`)
      .set("Authorization", `Bearer ${token}`)
      .send(memberPayload(result.branch.id, uniqueSuffix()));
    expect(first.status).toBe(201);

    const blocked = await request(app)
      .post(`/api/v1/organizations/${result.organization.id}/members`)
      .set("Authorization", `Bearer ${token}`)
      .send(memberPayload(result.branch.id, uniqueSuffix()));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("PLAN_LIMIT_REACHED");
    expect(blocked.body.error.details.key).toBe(SAAS_ENTITLEMENT_KEY.MEMBERS_MAX);
    expect(JSON.stringify(blocked.body)).not.toMatch(/prisma|P20/i);

    await installLimitPlan(result.organization.id, { members: "UNLIMITED" });
    const unlimited = await request(app)
      .post(`/api/v1/organizations/${result.organization.id}/members`)
      .set("Authorization", `Bearer ${token}`)
      .send(memberPayload(result.branch.id, uniqueSuffix()));
    expect(unlimited.status).toBe(201);
  });

  it("enforces staff.max including the OWNER; does not count members or platform users", async () => {
    const { result, token } = await provisionTrial();
    await installLimitPlan(result.organization.id, { staff: 1 });

    const atLimit = await request(app)
      .post(`/api/v1/organizations/${result.organization.id}/users`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Extra Staff",
        email: `extra-${uniqueSuffix()}@example.test`,
        password: TEST_PASSWORD,
        roleId: result.roleIdByName.get("RECEPTIONIST"),
      });
    expect(atLimit.status).toBe(403);
    expect(atLimit.body.error.code).toBe("PLAN_LIMIT_REACHED");
    expect(atLimit.body.error.details.key).toBe(SAAS_ENTITLEMENT_KEY.STAFF_MAX);

    await installLimitPlan(result.organization.id, { staff: 2 });
    const below = await request(app)
      .post(`/api/v1/organizations/${result.organization.id}/users`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Second Seat",
        email: `second-${uniqueSuffix()}@example.test`,
        password: TEST_PASSWORD,
        roleId: result.roleIdByName.get("RECEPTIONIST"),
      });
    expect(below.status).toBe(201);

    await prisma.member.create({
      data: {
        id: generateId(),
        organizationId: result.organization.id,
        branchId: result.branch.id,
        firstName: "Not",
        lastName: "Staff",
        phone: uniquePhone("972"),
      },
    });
    await installLimitPlan(result.organization.id, { staff: 2 });
    const stillLimited = await request(app)
      .post(`/api/v1/organizations/${result.organization.id}/users`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Would Be Third",
        email: `third-${uniqueSuffix()}@example.test`,
        password: TEST_PASSWORD,
        roleId: result.roleIdByName.get("TRAINER"),
      });
    expect(stillLimited.status).toBe(403);

    await installLimitPlan(result.organization.id, { staff: "UNLIMITED" });
    const unlimited = await request(app)
      .post(`/api/v1/organizations/${result.organization.id}/users`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Open Seat",
        email: `open-${uniqueSuffix()}@example.test`,
        password: TEST_PASSWORD,
        roleId: result.roleIdByName.get("TRAINER"),
      });
    expect(unlimited.status).toBe(201);
  });

  it("enforces branches.max: below limit succeeds, at limit fails, unlimited succeeds", async () => {
    const { result, token } = await provisionTrial();
    await installLimitPlan(result.organization.id, { branches: 1 });

    const atLimit = await request(app)
      .post(`/api/v1/organizations/${result.organization.id}/branches`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Second Branch" });
    expect(atLimit.status).toBe(403);
    expect(atLimit.body.error.code).toBe("PLAN_LIMIT_REACHED");
    expect(atLimit.body.error.details.key).toBe(SAAS_ENTITLEMENT_KEY.BRANCHES_MAX);

    await installLimitPlan(result.organization.id, { branches: 2 });
    const below = await request(app)
      .post(`/api/v1/organizations/${result.organization.id}/branches`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Allowed Branch" });
    expect(below.status).toBe(201);

    await installLimitPlan(result.organization.id, { branches: 2 });
    const again = await request(app)
      .post(`/api/v1/organizations/${result.organization.id}/branches`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Over Branch" });
    expect(again.status).toBe(403);

    await installLimitPlan(result.organization.id, { branches: "UNLIMITED" });
    const unlimited = await request(app)
      .post(`/api/v1/organizations/${result.organization.id}/branches`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Unlimited Branch" });
    expect(unlimited.status).toBe(201);
  });

  it("enforces the leads boolean: disabled fails, enabled succeeds", async () => {
    const { result, token } = await provisionTrial();
    const disabled = await request(app)
      .post(`/api/v1/organizations/${result.organization.id}/leads`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Walk-in", phone: uniquePhone("973") });
    expect(disabled.status).toBe(403);
    expect(disabled.body.error.code).toBe("FEATURE_DISABLED");
    expect(disabled.body.error.details.key).toBe(SAAS_ENTITLEMENT_KEY.LEADS);

    await installLimitPlan(result.organization.id, { leads: true });
    const enabled = await request(app)
      .post(`/api/v1/organizations/${result.organization.id}/leads`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Walk-in", phone: uniquePhone("974") });
    expect(enabled.status).toBe(201);
  });

  it("applies the documented trial limits on a newly provisioned gym", async () => {
    const { result, token } = await provisionTrial();
    const snap = await getOrganizationSaasSnapshot(result.organization.id);
    expect(snap?.plan.code).toBe(SAAS_PLAN_CODE.TRIAL);
    expect(snap?.entitlements.find((e) => e.key === SAAS_ENTITLEMENT_KEY.MEMBERS_MAX)?.intValue).toBe(50);
    expect(snap?.entitlements.find((e) => e.key === SAAS_ENTITLEMENT_KEY.BRANCHES_MAX)?.intValue).toBe(1);
    expect(snap?.entitlements.find((e) => e.key === SAAS_ENTITLEMENT_KEY.STAFF_MAX)?.intValue).toBe(3);

    const member = await request(app)
      .post(`/api/v1/organizations/${result.organization.id}/members`)
      .set("Authorization", `Bearer ${token}`)
      .send(memberPayload(result.branch.id, uniqueSuffix()));
    expect(member.status).toBe(201);

    const branch = await request(app)
      .post(`/api/v1/organizations/${result.organization.id}/branches`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Cannot Add" });
    expect(branch.status).toBe(403);
    expect(branch.body.error.code).toBe("PLAN_LIMIT_REACHED");

    const lead = await request(app)
      .post(`/api/v1/organizations/${result.organization.id}/leads`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "No Leads", phone: uniquePhone("975") });
    expect(lead.status).toBe(403);
    expect(lead.body.error.code).toBe("FEATURE_DISABLED");
  });

  it("does not let org A consume org B's headroom or bypass via URL organizationId", async () => {
    const a = await provisionTrial();
    await installLimitPlan(a.result.organization.id, { members: 1 });
    const created = await request(app)
      .post(`/api/v1/organizations/${a.result.organization.id}/members`)
      .set("Authorization", `Bearer ${a.token}`)
      .send(memberPayload(a.result.branch.id, uniqueSuffix()));
    expect(created.status).toBe(201);

    const b = await provisionOrganization({
      organization: {
        name: `Headroom B ${uniqueSuffix()}`,
        slug: `headroom-b-${uniqueSuffix()}`,
        email: `headroom-b-${uniqueSuffix()}@example.test`,
      },
      owner: {
        name: "B",
        email: `headroom-b-owner-${uniqueSuffix()}@example.test`,
        password: TEST_PASSWORD,
      },
      saas: { planCode: SAAS_PLAN_CODE.GROWTH, subscriptionStatus: "ACTIVE" },
    });
    const tokenB = await loginOwner(b.owner.email);

    const aBlocked = await request(app)
      .post(`/api/v1/organizations/${a.result.organization.id}/members`)
      .set("Authorization", `Bearer ${a.token}`)
      .send(memberPayload(a.result.branch.id, uniqueSuffix()));
    expect(aBlocked.status).toBe(403);
    expect(aBlocked.body.error.code).toBe("PLAN_LIMIT_REACHED");

    const smuggled = await request(app)
      .post(`/api/v1/organizations/${a.result.organization.id}/members`)
      .set("Authorization", `Bearer ${a.token}`)
      .send({
        ...memberPayload(a.result.branch.id, uniqueSuffix()),
        organizationId: b.organization.id,
      });
    expect(smuggled.status).toBe(403);
    expect(smuggled.body.error.code).toBe("ORG_MISMATCH");

    const cross = await request(app)
      .post(`/api/v1/organizations/${b.organization.id}/members`)
      .set("Authorization", `Bearer ${a.token}`)
      .send(memberPayload(b.branch.id, uniqueSuffix()));
    expect(cross.status).toBe(403);
    expect(cross.body.error.code).toBe("ORG_MISMATCH");

    const bOk = await request(app)
      .post(`/api/v1/organizations/${b.organization.id}/members`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send(memberPayload(b.branch.id, uniqueSuffix()));
    expect(bOk.status).toBe(201);
  });

  it("keeps existing growth-style test tenants creating members (Demo Gym shape)", async () => {
    const owner = await createActorInNewTenant("OWNER", "GrowthFixture");
    const res = await request(app)
      .post(`/api/v1/organizations/${owner.organization.id}/members`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({
        firstName: "Fixture",
        lastName: "Member",
        phone: uniquePhone("976"),
        branchId: owner.branch.id,
      });
    expect(res.status).toBe(201);
  });
});
