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
import { prisma } from "../../lib/prisma";
import { provisionOrganization } from "../organizations/organization-provisioning.service";
import {
  SAAS_ENTITLEMENT_KEY,
  SAAS_PLAN_CATALOG,
  SAAS_PLAN_CODE,
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

function createPlanBody(suffix = uniqueSuffix()) {
  return {
    code: `p${suffix.toLowerCase()}`,
    name: `Phase B ${suffix}`,
    description: "Operator-created plan",
    priceMonthly: "499.00",
    priceYearly: "4990.00",
    trialDays: 7,
    entitlements: catalogEntitlements(),
  };
}

describe("platform SaaS plan CRUD", () => {
  it("creates, reads, edits, archives, and reactivates a plan", async () => {
    const operator = await createPlatformOperator();
    const body = createPlanBody();

    const created = await request(app)
      .post(`${BASE}/plans`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send(body);
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      code: body.code,
      name: body.name,
      priceMonthly: "499.00",
      priceYearly: "4990.00",
      currency: "INR",
      trialDays: 7,
      isActive: true,
      organizationCount: 0,
    });
    expect(created.body.data.entitlements).toHaveLength(catalogEntitlements().length);
    expect(JSON.stringify(created.body)).not.toMatch(/password|passwordHash|refreshToken|\$2a\$/i);

    const fetched = await request(app)
      .get(`${BASE}/plans/${created.body.data.id}`)
      .set("Authorization", `Bearer ${operator.accessToken}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.data.id).toBe(created.body.data.id);
    expect(fetched.body.data.organizationCount).toBe(0);

    const patched = await request(app)
      .patch(`${BASE}/plans/${created.body.data.id}`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({
        name: "Phase B Edited",
        priceMonthly: "799.00",
        entitlements: [
          { key: SAAS_ENTITLEMENT_KEY.MEMBERS_MAX, valueType: "LIMIT", intValue: 75 },
        ],
      });
    expect(patched.status).toBe(200);
    expect(patched.body.data.name).toBe("Phase B Edited");
    expect(patched.body.data.priceMonthly).toBe("799.00");
    expect(
      patched.body.data.entitlements.find((row: { key: string }) => row.key === SAAS_ENTITLEMENT_KEY.MEMBERS_MAX),
    ).toMatchObject({ valueType: "LIMIT", intValue: 75 });

    const archived = await request(app)
      .post(`${BASE}/plans/${created.body.data.id}/archive`)
      .set("Authorization", `Bearer ${operator.accessToken}`);
    expect(archived.status).toBe(200);
    expect(archived.body.data.isActive).toBe(false);

    const activated = await request(app)
      .post(`${BASE}/plans/${created.body.data.id}/activate`)
      .set("Authorization", `Bearer ${operator.accessToken}`);
    expect(activated.status).toBe(200);
    expect(activated.body.data.isActive).toBe(true);
  });

  it("rejects duplicate codes, invalid prices, and invalid entitlements", async () => {
    const operator = await createPlatformOperator();
    const body = createPlanBody();
    const created = await request(app)
      .post(`${BASE}/plans`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send(body);
    expect(created.status).toBe(201);

    const duplicate = await request(app)
      .post(`${BASE}/plans`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send(body);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("DUPLICATE_SAAS_PLAN_CODE");

    const negativePrice = await request(app)
      .post(`${BASE}/plans`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({ ...createPlanBody(), priceMonthly: "-1.00" });
    expect(negativePrice.status).toBe(400);
    expect(negativePrice.body.error.code).toBe("VALIDATION_ERROR");

    const unknownKey = await request(app)
      .post(`${BASE}/plans`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({
        ...createPlanBody(),
        entitlements: [
          ...catalogEntitlements().filter((row) => row.key !== SAAS_ENTITLEMENT_KEY.LEADS),
          { key: "foo.bar", valueType: "BOOLEAN", boolValue: true },
        ],
      });
    expect(unknownKey.status).toBe(400);
    expect(unknownKey.body.error.code).toBe("VALIDATION_ERROR");

    const wrongType = await request(app)
      .post(`${BASE}/plans`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({
        ...createPlanBody(),
        entitlements: catalogEntitlements().map((row) =>
          row.key === SAAS_ENTITLEMENT_KEY.LEADS
            ? { key: row.key, valueType: "LIMIT", intValue: 1 }
            : row,
        ),
      });
    expect(wrongType.status).toBe(400);
    expect(wrongType.body.error.code).toBe("VALIDATION_ERROR");

    const duplicateKeys = await request(app)
      .post(`${BASE}/plans`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({
        ...createPlanBody(),
        entitlements: [
          ...catalogEntitlements(),
          { key: SAAS_ENTITLEMENT_KEY.LEADS, valueType: "BOOLEAN", boolValue: true },
        ],
      });
    expect(duplicateKeys.status).toBe(400);
    expect(duplicateKeys.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("refuses to assign an archived plan and writes plan audits without secrets", async () => {
    const operator = await createPlatformOperator();
    const created = await request(app)
      .post(`${BASE}/plans`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send(createPlanBody());
    expect(created.status).toBe(201);
    const planId = created.body.data.id as string;

    const archived = await request(app)
      .post(`${BASE}/plans/${planId}/archive`)
      .set("Authorization", `Bearer ${operator.accessToken}`);
    expect(archived.status).toBe(200);

    const org = await provisionOrganization({
      organization: {
        name: `Assign Inactive ${uniqueSuffix()}`,
        slug: `assign-inactive-${uniqueSuffix()}`,
        email: `assign-inactive-${uniqueSuffix()}@example.test`,
      },
      owner: {
        name: "Owner",
        email: `assign-inactive-o-${uniqueSuffix()}@example.test`,
        password: TEST_PASSWORD,
      },
    });

    const assigned = await request(app)
      .patch(`${BASE}/organizations/${org.organization.id}/subscription`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({ planId });
    expect(assigned.status).toBe(409);
    expect(assigned.body.error.code).toBe("SAAS_PLAN_INACTIVE");
    expect(assigned.body.error.message).not.toMatch(/prisma|P20/i);

    const createdAudit = await prisma.platformAuditLog.findFirstOrThrow({
      where: { entityId: planId, action: PLATFORM_AUDIT_ACTION.SAAS_PLAN_CREATED },
    });
    expect(createdAudit.platformUserId).toBe(operator.user.id);
    expect(createdAudit.organizationId).toBeNull();

    const archivedAudit = await prisma.platformAuditLog.findFirstOrThrow({
      where: { entityId: planId, action: PLATFORM_AUDIT_ACTION.SAAS_PLAN_ARCHIVED },
    });
    expect(archivedAudit.afterJson).toMatchObject({ isActive: false });

    const secretScan = JSON.stringify([createdAudit, archivedAudit]);
    expect(secretScan).not.toMatch(/password|passwordHash|refreshToken|\$2a\$/i);
  });

  it("returns 404 for a missing plan and ignores spoofed actor fields", async () => {
    const operator = await createPlatformOperator();
    const missing = await request(app)
      .get(`${BASE}/plans/not-a-real-plan`)
      .set("Authorization", `Bearer ${operator.accessToken}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("SAAS_PLAN_NOT_FOUND");

    const spoofed = await request(app)
      .post(`${BASE}/plans`)
      .set("Authorization", `Bearer ${operator.accessToken}`)
      .send({
        ...createPlanBody(),
        platformUserId: "spoofed-actor",
        organizationId: "spoofed-org",
      });
    expect(spoofed.status).toBe(400);
    expect(spoofed.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects staff JWTs on plan mutations", async () => {
    const staff = await createActor(await createTestTenant("PlanDeny"), "OWNER");
    const res = await request(app)
      .post(`${BASE}/plans`)
      .set(...bearer(staff))
      .send(createPlanBody());
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_TOKEN");
  });
});
