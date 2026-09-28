import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../../test/helpers/app";
import {
  TEST_PASSWORD,
  bearer,
  createActor,
  createActorInNewTenant,
} from "../../../test/helpers/auth";
import { uniqueSuffix } from "../../../test/helpers/fixtures";
import { generateId } from "../../lib/id";
import { hashPassword } from "../../lib/password";
import { prisma } from "../../lib/prisma";
import { runNightlyTick, scanOrganization } from "../../services/notification/scan";
import { provisionOrganization } from "../organizations/organization-provisioning.service";
import { SAAS_ENTITLEMENT_KEY, SAAS_PLAN_CODE, syncSaasPlanCatalog } from "./saas-catalog";
import { assertEntitlement } from "./saas-entitlements.service";

const fixturePlanIds: string[] = [];

async function loginOwner(email: string) {
  const res = await request(app).post("/api/v1/auth/login").send({
    email,
    password: TEST_PASSWORD,
  });
  expect(res.status).toBe(200);
  return res.body.data.accessToken as string;
}

async function provisionGym(label: string, planCode?: string) {
  const suffix = uniqueSuffix();
  const result = await provisionOrganization({
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
    ...(planCode
      ? { saas: { planCode, subscriptionStatus: planCode === SAAS_PLAN_CODE.TRIAL ? "TRIAL" : "ACTIVE" } }
      : {}),
  });
  const token = await loginOwner(result.owner.email);
  return { result, token };
}

async function installBooleanPlan(
  organizationId: string,
  flags: Partial<{
    trainers: boolean;
    reports: boolean;
    notifications: boolean;
    omitTrainers: boolean;
    omitReports: boolean;
    omitNotifications: boolean;
  }>,
) {
  await syncSaasPlanCatalog();
  const plan = await prisma.saasPlan.create({
    data: {
      id: generateId(),
      code: `g-${uniqueSuffix()}`.slice(0, 32),
      name: "Phase G flag plan",
      priceMonthly: "0.00",
      priceYearly: "0.00",
      trialDays: 14,
    },
  });
  fixturePlanIds.push(plan.id);

  const rows: Array<{
    key: string;
    valueType: "BOOLEAN";
    intValue: null;
    boolValue: boolean;
  }> = [];
  if (!flags.omitTrainers && flags.trainers !== undefined) {
    rows.push({
      key: SAAS_ENTITLEMENT_KEY.TRAINERS,
      valueType: "BOOLEAN",
      intValue: null,
      boolValue: flags.trainers,
    });
  }
  if (!flags.omitReports && flags.reports !== undefined) {
    rows.push({
      key: SAAS_ENTITLEMENT_KEY.REPORTS_ENABLED,
      valueType: "BOOLEAN",
      intValue: null,
      boolValue: flags.reports,
    });
  }
  if (!flags.omitNotifications && flags.notifications !== undefined) {
    rows.push({
      key: SAAS_ENTITLEMENT_KEY.NOTIFICATIONS_ENABLED,
      valueType: "BOOLEAN",
      intValue: null,
      boolValue: flags.notifications,
    });
  }
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

async function addTrainerUser(organizationId: string, branchId: string, roleId: string) {
  const suffix = uniqueSuffix();
  return prisma.user.create({
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
}

describe("remaining SaaS entitlements (Phase G)", () => {
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

  it("enforces trainers as a boolean at profile creation and follows a live plan change", async () => {
    const { result, token } = await provisionGym("PhaseGTrainers");
    const trainerRoleId = result.roleIdByName.get("TRAINER");
    expect(trainerRoleId).toBeTruthy();
    const candidate = await addTrainerUser(
      result.organization.id,
      result.branch.id,
      trainerRoleId!,
    );

    const blocked = await request(app)
      .post(`/api/v1/organizations/${result.organization.id}/trainers`)
      .set("Authorization", `Bearer ${token}`)
      .send({ userId: candidate.id, specialization: "Strength" });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("FEATURE_DISABLED");
    expect(blocked.body.error.details.key).toBe(SAAS_ENTITLEMENT_KEY.TRAINERS);
    expect(await prisma.trainerProfile.count({ where: { organizationId: result.organization.id } })).toBe(
      0,
    );

    await installBooleanPlan(result.organization.id, { trainers: true });
    const allowed = await request(app)
      .post(`/api/v1/organizations/${result.organization.id}/trainers`)
      .set("Authorization", `Bearer ${token}`)
      .send({ userId: candidate.id, specialization: "Strength" });
    expect(allowed.status).toBe(201);
    expect(allowed.body.data.userId).toBe(candidate.id);
    expect(JSON.stringify(allowed.body)).not.toMatch(/passwordHash|refreshToken|\$2[aby]\$/i);

    await installBooleanPlan(result.organization.id, { omitTrainers: true });
    await expect(
      assertEntitlement(result.organization.id, SAAS_ENTITLEMENT_KEY.TRAINERS),
    ).rejects.toMatchObject({ statusCode: 403, code: "FEATURE_DISABLED" });
  });

  it("keeps Growth trainer creation working and isolates organizations", async () => {
    const growth = await createActorInNewTenant("OWNER", "PhaseGGrowthT");
    const trainer = await createActor(growth, "TRAINER", { branchScoped: true });
    const ok = await request(app)
      .post(`/api/v1/organizations/${growth.organization.id}/trainers`)
      .set(...bearer(growth))
      .send({ userId: trainer.user.id });
    expect(ok.status).toBe(201);

    const trial = await provisionGym("PhaseGIsoT");
    const trialTrainer = await addTrainerUser(
      trial.result.organization.id,
      trial.result.branch.id,
      trial.result.roleIdByName.get("TRAINER")!,
    );
    const cross = await request(app)
      .post(`/api/v1/organizations/${trial.result.organization.id}/trainers`)
      .set(...bearer(growth))
      .send({ userId: trialTrainer.id });
    expect(cross.status).toBe(403);
    expect(cross.body.error.code).toBe("ORG_MISMATCH");

    const smuggled = await request(app)
      .post(`/api/v1/organizations/${growth.organization.id}/trainers`)
      .set(...bearer(growth))
      .send({ userId: trainer.user.id, organizationId: trial.result.organization.id });
    expect(smuggled.status).toBe(403);
    expect(smuggled.body.error.code).toBe("ORG_MISMATCH");
    expect(
      await prisma.trainerProfile.count({ where: { organizationId: trial.result.organization.id } }),
    ).toBe(0);
  });

  it("rejects unauthorized staff and member JWTs on trainer create", async () => {
    const owner = await createActorInNewTenant("OWNER", "PhaseGAuthT");
    const receptionist = await createActor(owner, "RECEPTIONIST", { branchScoped: true });
    const trainer = await createActor(owner, "TRAINER", { branchScoped: true });
    const phone = `+91${`${Date.now()}${Math.floor(Math.random() * 1_000_000)}`.slice(-10)}`;
    await prisma.member.create({
      data: {
        id: generateId(),
        organizationId: owner.organization.id,
        branchId: owner.branch.id,
        firstName: "Mem",
        lastName: "Ber",
        phone,
        passwordHash: await hashPassword(TEST_PASSWORD),
      },
    });
    const member = await request(app).post("/api/v1/auth/member/login").send({
      phone,
      password: TEST_PASSWORD,
      organizationSlug: owner.organization.slug,
    });
    expect(member.status).toBe(200);

    const staffDenied = await request(app)
      .post(`/api/v1/organizations/${owner.organization.id}/trainers`)
      .set(...bearer(receptionist))
      .send({ userId: trainer.user.id });
    expect(staffDenied.status).toBe(403);
    expect(staffDenied.body.error.code).toBe("PERMISSION_DENIED");

    const memberDenied = await request(app)
      .post(`/api/v1/organizations/${owner.organization.id}/trainers`)
      .set("Authorization", `Bearer ${member.body.data.accessToken}`)
      .send({ userId: trainer.user.id });
    expect(memberDenied.status).toBe(401);
  });

  it("enforces reports.enabled on dashboard and profit-loss, and follows a live plan change", async () => {
    const { result, token } = await provisionGym("PhaseGReports", SAAS_PLAN_CODE.GROWTH);
    const dashOk = await request(app)
      .get(`/api/v1/organizations/${result.organization.id}/reports/dashboard`)
      .set("Authorization", `Bearer ${token}`);
    expect(dashOk.status).toBe(200);
    expect(dashOk.body.data.widgets).toBeTruthy();

    const plOk = await request(app)
      .get(`/api/v1/organizations/${result.organization.id}/reports/profit-loss`)
      .set("Authorization", `Bearer ${token}`);
    expect(plOk.status).toBe(200);
    expect(plOk.body.data.revenue).toEqual(expect.any(String));

    await installBooleanPlan(result.organization.id, { reports: false });
    const dashBlocked = await request(app)
      .get(`/api/v1/organizations/${result.organization.id}/reports/dashboard`)
      .set("Authorization", `Bearer ${token}`);
    expect(dashBlocked.status).toBe(403);
    expect(dashBlocked.body.error.code).toBe("FEATURE_DISABLED");
    expect(dashBlocked.body.error.details.key).toBe(SAAS_ENTITLEMENT_KEY.REPORTS_ENABLED);

    const plBlocked = await request(app)
      .get(`/api/v1/organizations/${result.organization.id}/reports/profit-loss`)
      .set("Authorization", `Bearer ${token}`);
    expect(plBlocked.status).toBe(403);
    expect(plBlocked.body.error.code).toBe("FEATURE_DISABLED");

    await installBooleanPlan(result.organization.id, { reports: true });
    const dashAgain = await request(app)
      .get(`/api/v1/organizations/${result.organization.id}/reports/dashboard`)
      .set("Authorization", `Bearer ${token}`);
    expect(dashAgain.status).toBe(200);

    await installBooleanPlan(result.organization.id, { omitReports: true });
    const missing = await request(app)
      .get(`/api/v1/organizations/${result.organization.id}/reports/dashboard`)
      .set("Authorization", `Bearer ${token}`);
    expect(missing.status).toBe(403);
    expect(missing.body.error.code).toBe("FEATURE_DISABLED");
  });

  it("does not let org A read org B reports or a member JWT hit staff report routes", async () => {
    const a = await provisionGym("PhaseGRepA", SAAS_PLAN_CODE.GROWTH);
    const b = await provisionGym("PhaseGRepB", SAAS_PLAN_CODE.GROWTH);
    const cross = await request(app)
      .get(`/api/v1/organizations/${b.result.organization.id}/reports/dashboard`)
      .set("Authorization", `Bearer ${a.token}`);
    expect(cross.status).toBe(403);
    expect(cross.body.error.code).toBe("ORG_MISMATCH");

    const phone = `+91${`${Date.now()}${Math.floor(Math.random() * 1_000_000)}`.slice(-10)}`;
    await prisma.member.create({
      data: {
        id: generateId(),
        organizationId: a.result.organization.id,
        branchId: a.result.branch.id,
        firstName: "Rep",
        lastName: "Mem",
        phone,
        passwordHash: await hashPassword(TEST_PASSWORD),
      },
    });
    const member = await request(app).post("/api/v1/auth/member/login").send({
      phone,
      password: TEST_PASSWORD,
      organizationSlug: a.result.organization.slug,
    });
    expect(member.status).toBe(200);
    const memberDash = await request(app)
      .get(`/api/v1/organizations/${a.result.organization.id}/reports/dashboard`)
      .set("Authorization", `Bearer ${member.body.data.accessToken}`);
    expect(memberDash.status).toBe(401);
  });

  it("enforces notifications.enabled before scan/queue and follows a live plan change", async () => {
    const { result, token } = await provisionGym("PhaseGNotify", SAAS_PLAN_CODE.GROWTH);
    const before = await prisma.notificationLog.count({
      where: { organizationId: result.organization.id },
    });

    const allowed = await request(app)
      .post(`/api/v1/organizations/${result.organization.id}/notifications/run`)
      .set("Authorization", `Bearer ${token}`);
    expect(allowed.status).toBe(202);

    await installBooleanPlan(result.organization.id, { notifications: false });
    const blocked = await request(app)
      .post(`/api/v1/organizations/${result.organization.id}/notifications/run`)
      .set("Authorization", `Bearer ${token}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("FEATURE_DISABLED");
    expect(blocked.body.error.details.key).toBe(SAAS_ENTITLEMENT_KEY.NOTIFICATIONS_ENABLED);
    await expect(scanOrganization(result.organization.id)).rejects.toMatchObject({
      statusCode: 403,
      code: "FEATURE_DISABLED",
    });
    expect(await prisma.notificationLog.count({ where: { organizationId: result.organization.id } })).toBe(
      before,
    );

    await installBooleanPlan(result.organization.id, { notifications: true });
    const again = await request(app)
      .post(`/api/v1/organizations/${result.organization.id}/notifications/run`)
      .set("Authorization", `Bearer ${token}`);
    expect(again.status).toBe(202);

    await expect(runNightlyTick(new Date("2026-09-08T15:30:00.000Z"))).resolves.toMatchObject({
      queued: expect.any(Number),
    });
  });

  it("does not let org A run org B notifications", async () => {
    const a = await provisionGym("PhaseGNotA", SAAS_PLAN_CODE.GROWTH);
    const b = await provisionGym("PhaseGNotB", SAAS_PLAN_CODE.GROWTH);
    const cross = await request(app)
      .post(`/api/v1/organizations/${b.result.organization.id}/notifications/run`)
      .set("Authorization", `Bearer ${a.token}`);
    expect(cross.status).toBe(403);
    expect(cross.body.error.code).toBe("ORG_MISMATCH");
  });
});
