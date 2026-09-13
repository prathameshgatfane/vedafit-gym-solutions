/**
 * Phase 15.12 — 10.17 API cases that were not already named on an existing file.
 * Existing module tests stay the source for auth isolation, entitlements, suspend, and payments.
 */
import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../../test/helpers/app";
import {
  TEST_PASSWORD,
  createPlatformOperator,
} from "../../../test/helpers/auth";
import { uniqueSuffix } from "../../../test/helpers/fixtures";
import { generateId } from "../../lib/id";
import { hashPassword } from "../../lib/password";
import { prisma } from "../../lib/prisma";
import { provisionOrganization } from "../organizations/organization-provisioning.service";
import { SAAS_PLAN_CODE } from "../saas/saas-catalog";

const SEED_OWNER_EMAIL = "owner@demo-gym.test";
const SEED_OWNER_PASSWORD = "ChangeMe123!";
const ALICE_PHONE = "+919111100001";
const BOB_PHONE = "+919111100002";
const MEMBER_PORTAL_PASSWORD = "ChangeMe123!";

let signupIp = 80;
function nextSignupIp(): string {
  signupIp += 1;
  if (signupIp > 250) signupIp = 81;
  return `198.51.100.${signupIp}`;
}

function decodeJwt(accessToken: string): Record<string, unknown> {
  const [, payload] = accessToken.split(".");
  return JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")) as Record<string, unknown>;
}

async function ensureDemoGym() {
  let organization = await prisma.organization.findUnique({ where: { slug: "demo-gym" } });
  if (!organization) {
    const provisioned = await provisionOrganization({
      organization: {
        name: "Demo Gym",
        slug: "demo-gym",
        email: SEED_OWNER_EMAIL,
        phone: "+91 9000000000",
      },
      owner: {
        name: "Demo Owner",
        email: SEED_OWNER_EMAIL,
        password: SEED_OWNER_PASSWORD,
      },
      branchName: "Main Branch",
      saas: {
        planCode: SAAS_PLAN_CODE.GROWTH,
        subscriptionStatus: "ACTIVE",
        billingInterval: "YEARLY",
      },
    });
    organization = await prisma.organization.findUniqueOrThrow({
      where: { id: provisioned.organization.id },
    });
  }

  const branch = await prisma.branch.findFirstOrThrow({
    where: { organizationId: organization.id },
    orderBy: { createdAt: "asc" },
  });

  const owner = await prisma.user.findFirst({
    where: { organizationId: organization.id, email: SEED_OWNER_EMAIL, deletedAt: null },
  });
  if (!owner) {
    throw new Error("Demo Gym exists but owner@demo-gym.test is missing");
  }

  return { organization, branch, owner };
}

async function ensurePortalMember(
  organizationId: string,
  branchId: string,
  firstName: string,
  lastName: string,
  phone: string,
) {
  const existing = await prisma.member.findFirst({
    where: { organizationId, phone, deletedAt: null },
  });
  if (existing) {
    if (!existing.passwordHash) {
      return prisma.member.update({
        where: { id: existing.id },
        data: { passwordHash: await hashPassword(MEMBER_PORTAL_PASSWORD) },
      });
    }
    return existing;
  }
  return prisma.member.create({
    data: {
      id: generateId(),
      organizationId,
      branchId,
      firstName,
      lastName,
      phone,
      passwordHash: await hashPassword(MEMBER_PORTAL_PASSWORD),
    },
  });
}

function snapshotMember(row: {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  status: string;
  organizationId: string;
  branchId: string;
  deletedAt: Date | null;
}) {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone,
    status: row.status,
    organizationId: row.organizationId,
    branchId: row.branchId,
    deletedAt: row.deletedAt,
  };
}

describe("Phase 15.12 — 10.17 platform / Demo Gym / cross-gym regression", () => {
  it("rejects a platform JWT on GET /members (audience isolation)", async () => {
    const demo = await ensureDemoGym();
    const operator = await createPlatformOperator();
    const claims = decodeJwt(operator.accessToken);
    expect(claims.type).toBe("platform_access");
    expect(claims.organizationId).toBeUndefined();
    expect(claims.userId).toBeUndefined();
    expect(claims.memberId).toBeUndefined();

    const res = await request(app)
      .get(`/api/v1/organizations/${demo.organization.id}/members`)
      .set("Authorization", `Bearer ${operator.accessToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_TOKEN");
  });

  it("lets the Demo Gym seed OWNER log in through POST /auth/login", async () => {
    const demo = await ensureDemoGym();
    const res = await request(app).post("/api/v1/auth/login").send({
      email: SEED_OWNER_EMAIL,
      password: SEED_OWNER_PASSWORD,
      organizationSlug: "demo-gym",
    });
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(SEED_OWNER_EMAIL);
    expect(res.body.data.user.organizationId).toBe(demo.organization.id);
    expect(decodeJwt(res.body.data.accessToken).type).toBe("access");
    expect(JSON.stringify(res.body)).not.toContain("$2a$");
    expect(res.body.data.user).not.toHaveProperty("isSuperAdmin");
    expect(res.body.data.user).not.toHaveProperty("passwordHash");
  });

  it("rolls back every tenant row when afterProvision throws after org insert", async () => {
    const suffix = uniqueSuffix();
    const slug = `rollback-http-${suffix}`;
    const ownerEmail = `rb-after-${suffix}@example.test`;

    await expect(
      provisionOrganization(
        {
          organization: {
            name: `Rollback After ${suffix}`,
            slug,
            email: `rb-after-${suffix}@example.test`,
          },
          owner: {
            name: "Rollback After",
            email: ownerEmail,
            password: TEST_PASSWORD,
          },
        },
        {
          afterProvision: async () => {
            throw new Error("forced-after-provision-failure");
          },
        },
      ),
    ).rejects.toThrow("forced-after-provision-failure");

    expect(await prisma.organization.findUnique({ where: { slug } })).toBeNull();
    expect(await prisma.user.count({ where: { email: ownerEmail } })).toBe(0);
    expect(await prisma.branch.count({ where: { organization: { slug } } })).toBe(0);
    expect(await prisma.role.count({ where: { organization: { slug } } })).toBe(0);
    expect(await prisma.organizationSubscription.count({ where: { organization: { slug } } })).toBe(0);
    expect(await prisma.notificationTemplate.count({ where: { organization: { slug } } })).toBe(0);
    expect(await prisma.platformAuditLog.count({ where: { entityId: slug } })).toBe(0);
  });

  it("proves Gym B signup isolation against Demo Gym Alice/Bob without writing gym invoices", async () => {
    const demo = await ensureDemoGym();
    const alice = await ensurePortalMember(
      demo.organization.id,
      demo.branch.id,
      "Alice",
      "Portal",
      ALICE_PHONE,
    );
    const bob = await ensurePortalMember(
      demo.organization.id,
      demo.branch.id,
      "Bob",
      "Other",
      BOB_PHONE,
    );
    const aliceBefore = snapshotMember(alice);
    const bobBefore = snapshotMember(bob);
    const demoPaymentsBefore = await prisma.payment.count({
      where: { organizationId: demo.organization.id },
    });
    const demoInvoicesBefore = await prisma.invoice.count({
      where: { organizationId: demo.organization.id },
    });

    const aliceLogin = await request(app).post("/api/v1/auth/member/login").send({
      phone: ALICE_PHONE,
      password: MEMBER_PORTAL_PASSWORD,
      organizationSlug: "demo-gym",
    });
    expect(aliceLogin.status).toBe(200);
    expect(aliceLogin.body.data.member.id).toBe(alice.id);
    expect(aliceLogin.body.data.organization.id).toBe(demo.organization.id);
    const alicePortalBefore = await request(app)
      .get("/api/v1/me")
      .set("Authorization", `Bearer ${aliceLogin.body.data.accessToken}`);
    expect(alicePortalBefore.status).toBe(200);
    expect(alicePortalBefore.body.data.member.id).toBe(alice.id);

    const suffix = uniqueSuffix();
    const gymBBody = {
      name: `Gym B ${suffix}`,
      slug: `gym-b-${suffix}`,
      email: `gym-b-${suffix}@example.test`,
      owner: {
        name: `Owner B ${suffix}`,
        email: `owner-b-${suffix}@example.test`,
        password: TEST_PASSWORD,
      },
    };
    const signup = await request(app)
      .post("/api/v1/platform/signup")
      .set("X-Forwarded-For", nextSignupIp())
      .send(gymBBody);
    expect(signup.status).toBe(201);
    const gymBId = signup.body.data.organization.id as string;
    const gymBBranchId = signup.body.data.branch.id as string;

    expect(await prisma.payment.count({ where: { organizationId: gymBId } })).toBe(0);
    expect(await prisma.invoice.count({ where: { organizationId: gymBId } })).toBe(0);

    const ownerB = await request(app).post("/api/v1/auth/login").send({
      email: gymBBody.owner.email,
      password: TEST_PASSWORD,
      organizationSlug: gymBBody.slug,
    });
    expect(ownerB.status).toBe(200);
    expect(decodeJwt(ownerB.body.data.accessToken).type).toBe("access");
    expect(ownerB.body.data.user.organizationId).toBe(gymBId);
    expect(ownerB.body.data.user).not.toHaveProperty("isSuperAdmin");

    const ownerA = await request(app).post("/api/v1/auth/login").send({
      email: SEED_OWNER_EMAIL,
      password: SEED_OWNER_PASSWORD,
      organizationSlug: "demo-gym",
    });
    expect(ownerA.status).toBe(200);

    const created = await request(app)
      .post(`/api/v1/organizations/${gymBId}/members`)
      .set("Authorization", `Bearer ${ownerB.body.data.accessToken}`)
      .send({
        firstName: "GymB",
        lastName: "Member",
        phone: `+91955${`${Date.now()}`.slice(-8)}`,
        branchId: gymBBranchId,
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const gymBMemberId = created.body.data.id as string;

    const ownList = await request(app)
      .get(`/api/v1/organizations/${gymBId}/members`)
      .set("Authorization", `Bearer ${ownerB.body.data.accessToken}`);
    expect(ownList.status).toBe(200);
    expect(ownList.body.data.some((row: { id: string }) => row.id === gymBMemberId)).toBe(true);
    expect(ownList.body.data.some((row: { id: string }) => row.id === alice.id)).toBe(false);

    const bReadsDemo = await request(app)
      .get(`/api/v1/organizations/${demo.organization.id}/members`)
      .set("Authorization", `Bearer ${ownerB.body.data.accessToken}`);
    expect(bReadsDemo.status).toBe(403);
    expect(bReadsDemo.body.error.code).toBe("ORG_MISMATCH");

    const aReadsB = await request(app)
      .get(`/api/v1/organizations/${gymBId}/members`)
      .set("Authorization", `Bearer ${ownerA.body.data.accessToken}`);
    expect(aReadsB.status).toBe(403);
    expect(aReadsB.body.error.code).toBe("ORG_MISMATCH");

    const smuggled = await request(app)
      .get(`/api/v1/organizations/${demo.organization.id}/members`)
      .query({ organizationId: gymBId })
      .set("Authorization", `Bearer ${ownerA.body.data.accessToken}`);
    expect(smuggled.status).toBe(403);
    expect(smuggled.body.error.code).toBe("ORG_MISMATCH");

    const operator = await createPlatformOperator();
    const listed = await request(app)
      .get("/api/v1/platform/organizations")
      .query({ search: gymBBody.slug })
      .set("Authorization", `Bearer ${operator.accessToken}`);
    expect(listed.status).toBe(200);
    expect(listed.body.data.some((row: { id: string }) => row.id === gymBId)).toBe(true);

    const listedDemo = await request(app)
      .get("/api/v1/platform/organizations")
      .query({ search: "demo-gym" })
      .set("Authorization", `Bearer ${operator.accessToken}`);
    expect(listedDemo.body.data.some((row: { id: string }) => row.id === demo.organization.id)).toBe(
      true,
    );

    const ownerOnPlatform = await request(app)
      .get("/api/v1/platform/organizations")
      .set("Authorization", `Bearer ${ownerA.body.data.accessToken}`);
    expect(ownerOnPlatform.status).toBe(401);

    const alicePortalAfter = await request(app)
      .get("/api/v1/me")
      .set("Authorization", `Bearer ${aliceLogin.body.data.accessToken}`);
    expect(alicePortalAfter.status).toBe(200);
    expect(alicePortalAfter.body.data.member.id).toBe(alice.id);
    expect(alicePortalAfter.body.data.organization.id).toBe(demo.organization.id);
    expect(alicePortalAfter.body.data.member.id).not.toBe(gymBMemberId);
    expect(JSON.stringify(alicePortalAfter.body)).not.toContain(gymBBody.slug);

    const alicePayments = await request(app)
      .get("/api/v1/me/payments")
      .set("Authorization", `Bearer ${aliceLogin.body.data.accessToken}`);
    expect(alicePayments.status).toBe(200);
    expect(
      alicePayments.body.data.every((row: { organizationId?: string }) => {
        return row.organizationId === undefined || row.organizationId === demo.organization.id;
      }),
    ).toBe(true);

    const aliceAfter = await prisma.member.findUniqueOrThrow({ where: { id: alice.id } });
    const bobAfter = await prisma.member.findUniqueOrThrow({ where: { id: bob.id } });
    expect(snapshotMember(aliceAfter)).toEqual(aliceBefore);
    expect(snapshotMember(bobAfter)).toEqual(bobBefore);

    expect(await prisma.payment.count({ where: { organizationId: demo.organization.id } })).toBe(
      demoPaymentsBefore,
    );
    expect(await prisma.invoice.count({ where: { organizationId: demo.organization.id } })).toBe(
      demoInvoicesBefore,
    );
    expect(await prisma.payment.count({ where: { organizationId: gymBId } })).toBe(0);
    expect(await prisma.invoice.count({ where: { organizationId: gymBId } })).toBe(0);

    const sampleUser = await prisma.user.findFirstOrThrow();
    expect(sampleUser).not.toHaveProperty("isSuperAdmin");
  });
});
