import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../../test/helpers/app";
import {
  TEST_PASSWORD,
  bearer,
  createActorInNewTenant,
  createPlatformOperator,
} from "../../../test/helpers/auth";
import { uniqueSuffix } from "../../../test/helpers/fixtures";
import { hashPassword } from "../../lib/password";
import { prisma } from "../../lib/prisma";
import { ROLE_MATRIX } from "../../lib/rbac-catalog";
import { syncSaasPlanCatalog } from "../saas/saas-catalog";
import {
  provisionOrganization,
  provisionOrganizationInTransaction,
} from "./organization-provisioning.service";

function provisionInput(suffix: string) {
  return {
    organization: {
      name: `Provisioned Gym ${suffix}`,
      slug: `prov-gym-${suffix}`,
      email: `gym-${suffix}@example.test`,
      phone: "+91 9000000001",
    },
    owner: {
      name: `Owner ${suffix}`,
      email: `owner-${suffix}@example.test`,
      password: TEST_PASSWORD,
    },
    branchName: "Main Branch",
  };
}

describe("provisionOrganization (Phase 15.3)", () => {
  it("creates org, main branch, default roles, OWNER, and notification templates in one go", async () => {
    const suffix = uniqueSuffix();
    const input = provisionInput(suffix);
    const result = await provisionOrganization(input);

    expect(result.organization.slug).toBe(input.organization.slug);
    expect(result.organization.status).toBe("ACTIVE");
    expect(result.branch.name).toBe("Main Branch");
    expect(result.owner.email).toBe(input.owner.email);
    expect(result.owner.roleId).toBe(result.roleIdByName.get("OWNER"));
    expect(result.subscription.planCode).toBe("trial");
    expect(result.subscription.status).toBe("TRIAL");

    const roles = await prisma.role.findMany({
      where: { organizationId: result.organization.id },
    });
    expect(roles.map((r) => r.name).sort()).toEqual(Object.keys(ROLE_MATRIX).sort());

    const owner = await prisma.user.findUnique({ where: { id: result.owner.id } });
    expect(owner?.organizationId).toBe(result.organization.id);
    expect(owner?.branchId).toBeNull();
    expect(JSON.stringify(result)).not.toContain("$2a$");

    const templates = await prisma.notificationTemplate.count({
      where: { organizationId: result.organization.id },
    });
    expect(templates).toBeGreaterThan(0);
  });

  it("lets the OWNER log in through existing staff POST /auth/login", async () => {
    const suffix = uniqueSuffix();
    const input = provisionInput(suffix);
    await provisionOrganization(input);

    const res = await request(app).post("/api/v1/auth/login").send({
      email: input.owner.email,
      password: TEST_PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(input.owner.email);
    expect(res.body.data.user.organizationId).toBeDefined();

    const [, payload] = (res.body.data.accessToken as string).split(".");
    const claims = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8"));
    expect(claims.type).toBe("access");
    expect(claims.organizationId).toBe(res.body.data.user.organizationId);
  });

  it("does not attach the OWNER to a different organization", async () => {
    const a = await provisionOrganization(provisionInput(uniqueSuffix()));
    const b = await provisionOrganization(provisionInput(uniqueSuffix()));
    expect(a.owner.id).not.toBe(b.owner.id);
    expect(a.organization.id).not.toBe(b.organization.id);

    const ownerA = await prisma.user.findUnique({ where: { id: a.owner.id } });
    expect(ownerA?.organizationId).toBe(a.organization.id);
    expect(ownerA?.organizationId).not.toBe(b.organization.id);
  });

  it("rejects a duplicate slug with DUPLICATE_ORGANIZATION_SLUG and does not create a second org", async () => {
    const suffix = uniqueSuffix();
    const input = provisionInput(suffix);
    await provisionOrganization(input);

    await expect(
      provisionOrganization({
        ...input,
        organization: { ...input.organization, name: "Other name" },
        owner: { ...input.owner, email: `other-${suffix}@example.test` },
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: "DUPLICATE_ORGANIZATION_SLUG" });

    expect(await prisma.organization.count({ where: { slug: input.organization.slug } })).toBe(1);
  });

  it("rolls back the whole tenant when a later step throws", async () => {
    const suffix = uniqueSuffix();
    const input = provisionInput(suffix);
    await syncSaasPlanCatalog();
    const passwordHash = await hashPassword(TEST_PASSWORD);

    await expect(
      prisma.$transaction(async (tx) => {
        await provisionOrganizationInTransaction(tx, input, passwordHash);
        throw new Error("forced-provision-failure");
      }),
    ).rejects.toThrow("forced-provision-failure");

    expect(await prisma.organization.findUnique({ where: { slug: input.organization.slug } })).toBeNull();
    expect(await prisma.user.count({ where: { email: input.owner.email } })).toBe(0);
  });

  it("keeps staff and platform JWTs isolated", async () => {
    const staff = await createActorInNewTenant("OWNER", "NoSignupYet");
    const platform = await createPlatformOperator();
    const staffOnPlatformMe = await request(app)
      .get("/api/v1/auth/platform/me")
      .set(...bearer(staff));
    expect(staffOnPlatformMe.status).toBe(401);

    const platformOnStaffMe = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${platform.accessToken}`);
    expect(platformOnStaffMe.status).toBe(401);
  });

  it("keeps tenant isolation: org A owner cannot read org B", async () => {
    const a = await provisionOrganization(provisionInput(uniqueSuffix()));
    const b = await provisionOrganization(provisionInput(uniqueSuffix()));

    const loginA = await request(app).post("/api/v1/auth/login").send({
      email: a.owner.email,
      password: TEST_PASSWORD,
    });
    const res = await request(app)
      .get(`/api/v1/organizations/${b.organization.id}`)
      .set("Authorization", `Bearer ${loginA.body.data.accessToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ORG_MISMATCH");
  });
});
