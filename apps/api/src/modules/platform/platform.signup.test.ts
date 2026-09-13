import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../../test/helpers/app";
import {
  TEST_PASSWORD,
  createActorInNewTenant,
  createPlatformOperator,
} from "../../../test/helpers/auth";
import { uniqueSuffix } from "../../../test/helpers/fixtures";
import { generateId } from "../../lib/id";
import { hashPassword } from "../../lib/password";
import { prisma } from "../../lib/prisma";
import { ROLE_MATRIX } from "../../lib/rbac-catalog";
import { syncSaasPlanCatalog } from "../saas/saas-catalog";
import {
  provisionOrganizationInTransaction,
} from "../organizations/organization-provisioning.service";

const SIGNUP = "/api/v1/platform/signup";
const MAX_SIGNUP_ATTEMPTS = 5;

let ipOctet = 20;
function nextTestIp(): string {
  ipOctet += 1;
  if (ipOctet > 250) ipOctet = 21;
  return `198.51.100.${ipOctet}`;
}

function signupBody(suffix: string, overrides: Record<string, unknown> = {}) {
  return {
    name: `Signup Gym ${suffix}`,
    slug: `signup-gym-${suffix}`,
    email: `gym-${suffix}@example.test`,
    owner: {
      name: `Owner ${suffix}`,
      email: `owner-${suffix}@example.test`,
      password: TEST_PASSWORD,
    },
    ...overrides,
  };
}

function decodeJwtType(accessToken: string): string {
  const [, payload] = accessToken.split(".");
  return JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")).type as string;
}

describe("POST /api/v1/platform/signup (Phase 15.4)", () => {
  it("creates org, main branch, roles, and OWNER; does not issue tokens", async () => {
    const suffix = uniqueSuffix();
    const body = signupBody(suffix);
    const res = await request(app).post(SIGNUP).set("X-Forwarded-For", nextTestIp()).send(body);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/auth\/login/);
    expect(res.body.data.organization.slug).toBe(body.slug);
    expect(res.body.data.organization.status).toBe("ACTIVE");
    expect(res.body.data.branch.name).toBe("Main Branch");
    expect(res.body.data.owner.email).toBe(body.owner.email);
    expect(res.body.data.owner).not.toHaveProperty("passwordHash");
    expect(res.body.data.owner).not.toHaveProperty("roleId");
    expect(res.body.data).not.toHaveProperty("accessToken");
    expect(JSON.stringify(res.body)).not.toContain("$2a$");
    expect(JSON.stringify(res.body)).not.toContain(TEST_PASSWORD);
    expect(res.headers["set-cookie"]).toBeUndefined();

    const orgId = res.body.data.organization.id as string;
    const roles = await prisma.role.findMany({ where: { organizationId: orgId } });
    expect(roles.map((r) => r.name).sort()).toEqual(Object.keys(ROLE_MATRIX).sort());

    const owner = await prisma.user.findUnique({ where: { id: res.body.data.owner.id } });
    expect(owner?.organizationId).toBe(orgId);
    expect(owner?.branchId).toBeNull();
    expect(await prisma.platformUser.count({ where: { email: body.owner.email } })).toBe(0);
  });

  it("lets the OWNER log in through existing staff POST /auth/login with type access", async () => {
    const suffix = uniqueSuffix();
    const body = signupBody(suffix);
    const signup = await request(app).post(SIGNUP).set("X-Forwarded-For", nextTestIp()).send(body);
    expect(signup.status).toBe(201);

    const login = await request(app).post("/api/v1/auth/login").send({
      email: body.owner.email,
      password: TEST_PASSWORD,
      organizationSlug: body.slug,
    });
    expect(login.status).toBe(200);
    expect(login.body.data.user.organizationId).toBe(signup.body.data.organization.id);
    expect(decodeJwtType(login.body.data.accessToken)).toBe("access");
  });

  it("rejects the new OWNER on platform login", async () => {
    const suffix = uniqueSuffix();
    const body = signupBody(suffix);
    await request(app).post(SIGNUP).set("X-Forwarded-For", nextTestIp()).send(body);

    const platform = await request(app).post("/api/v1/auth/platform/login").send({
      email: body.owner.email,
      password: TEST_PASSWORD,
    });
    expect(platform.status).toBe(401);
    expect(platform.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("rejects a duplicate slug with DUPLICATE_ORGANIZATION_SLUG and does not create a second org", async () => {
    const suffix = uniqueSuffix();
    const body = signupBody(suffix);
    const first = await request(app).post(SIGNUP).set("X-Forwarded-For", nextTestIp()).send(body);
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(SIGNUP)
      .set("X-Forwarded-For", nextTestIp())
      .send({
        ...body,
        name: "Other Gym",
        owner: { ...body.owner, email: `other-${suffix}@example.test` },
      });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("DUPLICATE_ORGANIZATION_SLUG");
    expect(await prisma.organization.count({ where: { slug: body.slug } })).toBe(1);
  });

  it("allows the same owner email on a different organization (uniqueness is per-org)", async () => {
    const suffix = uniqueSuffix();
    const sharedEmail = `shared-owner-${suffix}@example.test`;
    const first = await request(app)
      .post(SIGNUP)
      .set("X-Forwarded-For", nextTestIp())
      .send(signupBody(`a${suffix}`, { owner: { name: "A", email: sharedEmail, password: TEST_PASSWORD } }));
    const second = await request(app)
      .post(SIGNUP)
      .set("X-Forwarded-For", nextTestIp())
      .send(signupBody(`b${suffix}`, { owner: { name: "B", email: sharedEmail, password: TEST_PASSWORD } }));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.data.organization.id).not.toBe(second.body.data.organization.id);
  });

  it("rejects an invalid email and does not create an organization", async () => {
    const suffix = uniqueSuffix();
    const slug = `bad-email-${suffix}`;
    const res = await request(app)
      .post(SIGNUP)
      .set("X-Forwarded-For", nextTestIp())
      .send(signupBody(suffix, { slug, owner: { name: "X", email: "not-an-email", password: TEST_PASSWORD } }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(await prisma.organization.findUnique({ where: { slug } })).toBeNull();
  });

  it("rejects a weak password and does not create an organization", async () => {
    const suffix = uniqueSuffix();
    const slug = `weak-pw-${suffix}`;
    const res = await request(app)
      .post(SIGNUP)
      .set("X-Forwarded-For", nextTestIp())
      .send(signupBody(suffix, { slug, owner: { name: "X", email: `x-${suffix}@example.test`, password: "password" } }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(await prisma.organization.findUnique({ where: { slug } })).toBeNull();
  });

  it("rejects an invalid slug and does not create an organization", async () => {
    const suffix = uniqueSuffix();
    const res = await request(app)
      .post(SIGNUP)
      .set("X-Forwarded-For", nextTestIp())
      .send(signupBody(suffix, { slug: "Not A Slug" }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(await prisma.organization.count({ where: { name: `Signup Gym ${suffix}` } })).toBe(0);
  });

  it("rejects missing required fields", async () => {
    const res = await request(app).post(SIGNUP).set("X-Forwarded-For", nextTestIp()).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects client-chosen role, status, and organizationId", async () => {
    const suffix = uniqueSuffix();
    const res = await request(app)
      .post(SIGNUP)
      .set("X-Forwarded-For", nextTestIp())
      .send(
        signupBody(suffix, {
          role: "ADMIN",
          status: "SUSPENDED",
          organizationId: "01h00000000000000000000000",
        }),
      );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(await prisma.organization.findUnique({ where: { slug: `signup-gym-${suffix}` } })).toBeNull();
  });

  it("rate-limits repeated signup attempts from the same IP", async () => {
    const ip = "203.0.113.40";
    const statuses: number[] = [];
    for (let i = 0; i < MAX_SIGNUP_ATTEMPTS + 2; i += 1) {
      const res = await request(app).post(SIGNUP).set("X-Forwarded-For", ip).send({});
      statuses.push(res.status);
    }
    expect(statuses.slice(0, MAX_SIGNUP_ATTEMPTS)).toEqual(Array(MAX_SIGNUP_ATTEMPTS).fill(400));
    expect(statuses.slice(MAX_SIGNUP_ATTEMPTS)).toEqual([429, 429]);

    const blocked = await request(app).post(SIGNUP).set("X-Forwarded-For", ip).send({});
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("rolls back the tenant when a later provisioning step throws", async () => {
    const suffix = uniqueSuffix();
    const input = {
      organization: {
        name: `Rollback Gym ${suffix}`,
        slug: `rollback-gym-${suffix}`,
        email: `rb-${suffix}@example.test`,
      },
      owner: {
        name: "Rollback Owner",
        email: `rb-owner-${suffix}@example.test`,
        password: TEST_PASSWORD,
      },
    };
    const passwordHash = await hashPassword(TEST_PASSWORD);
    await syncSaasPlanCatalog();

    await expect(
      prisma.$transaction(async (tx) => {
        await provisionOrganizationInTransaction(tx, input, passwordHash);
        throw new Error("forced-signup-provision-failure");
      }),
    ).rejects.toThrow("forced-signup-provision-failure");

    expect(await prisma.organization.findUnique({ where: { slug: input.organization.slug } })).toBeNull();
    expect(await prisma.user.count({ where: { email: input.owner.email } })).toBe(0);
    expect(await prisma.branch.count({ where: { name: "Main Branch", organization: { slug: input.organization.slug } } })).toBe(0);
    expect(await prisma.role.count({ where: { organization: { slug: input.organization.slug } } })).toBe(0);
    expect(
      await prisma.organizationSubscription.count({
        where: { organization: { slug: input.organization.slug } },
      }),
    ).toBe(0);
  });

  it("keeps two signup gyms isolated from each other", async () => {
    const aBody = signupBody(`a${uniqueSuffix()}`);
    const bBody = signupBody(`b${uniqueSuffix()}`);
    const a = await request(app).post(SIGNUP).set("X-Forwarded-For", nextTestIp()).send(aBody);
    const b = await request(app).post(SIGNUP).set("X-Forwarded-For", nextTestIp()).send(bBody);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    const loginA = await request(app).post("/api/v1/auth/login").send({
      email: aBody.owner.email,
      password: TEST_PASSWORD,
    });
    const cross = await request(app)
      .get(`/api/v1/organizations/${b.body.data.organization.id}`)
      .set("Authorization", `Bearer ${loginA.body.data.accessToken}`);
    expect(cross.status).toBe(403);
    expect(cross.body.error.code).toBe("ORG_MISMATCH");
  });

  it("does not break existing staff, member, or platform authentication", async () => {
    const staff = await createActorInNewTenant("OWNER", "ExistingStaff");
    const staffMe = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${staff.accessToken}`);
    expect(staffMe.status).toBe(200);

    const member = await prisma.member.create({
      data: {
        id: generateId(),
        organizationId: staff.organization.id,
        branchId: staff.branch.id,
        firstName: "Signup",
        lastName: "Member",
        phone: `+91955${Date.now().toString().slice(-8)}`,
        passwordHash: await hashPassword(TEST_PASSWORD),
      },
    });
    const memberLogin = await request(app).post("/api/v1/auth/member/login").send({
      phone: member.phone,
      password: TEST_PASSWORD,
      organizationSlug: staff.organization.slug,
    });
    expect(memberLogin.status).toBe(200);
    expect(decodeJwtType(memberLogin.body.data.accessToken)).toBe("member_access");

    const platform = await createPlatformOperator();
    const platformMe = await request(app)
      .get("/api/v1/auth/platform/me")
      .set("Authorization", `Bearer ${platform.accessToken}`);
    expect(platformMe.status).toBe(200);

    const staffOnPlatform = await request(app)
      .get("/api/v1/auth/platform/me")
      .set("Authorization", `Bearer ${staff.accessToken}`);
    expect(staffOnPlatform.status).toBe(401);
  });
});
