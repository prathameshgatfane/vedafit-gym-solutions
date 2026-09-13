import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../../test/helpers/app";
import {
  TEST_PASSWORD,
  bearer,
  createActor,
  createActorInNewTenant,
  createPlatformOperator,
  createTestTenant,
  refreshCookieFrom,
  refreshTokenValueFrom,
} from "../../../test/helpers/auth";
import { uniqueSuffix } from "../../../test/helpers/fixtures";
import { generateId } from "../../lib/id";
import { hashPassword } from "../../lib/password";
import { prisma } from "../../lib/prisma";
import { signAccessToken } from "../../lib/jwt";
import { SAAS_ENTITLEMENT_KEY, SAAS_PLAN_CODE } from "../saas/saas-catalog";
import { REFRESH_COOKIE_NAME } from "./auth.controller";

const AUTH = "/api/v1/auth";

describe("POST /auth/login", () => {
  it("returns an access token and sets an httpOnly refresh cookie", async () => {
    const tenant = await createTestTenant("LoginOrg");
    const email = `login-${uniqueSuffix()}@example.test`;
    await prisma.user.create({
      data: {
        id: generateId(),
        organizationId: tenant.organization.id,
        name: "Login User",
        email,
        passwordHash: await hashPassword(TEST_PASSWORD),
        roleId: tenant.roleIdByName.get("OWNER")!,
        branchId: tenant.branch.id,
      },
    });

    const res = await request(app).post(`${AUTH}/login`).send({ email, password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.tokenType).toBe("Bearer");
    expect(res.body.data.expiresIn).toBe(900); // JWT_ACCESS_TTL=15m
    expect(res.body.data.user.email).toBe(email);
    // The password hash must never appear anywhere in the response.
    expect(JSON.stringify(res.body)).not.toContain("$2a$");

    const cookie = refreshCookieFrom(res);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/api/v1/auth");
    expect(cookie).toContain("SameSite=Lax");
    // Secure is off outside production so the cookie survives plain http on localhost.
    expect(cookie).not.toContain("Secure");

    // The raw token is never stored — only its SHA-256 hash.
    const rawToken = refreshTokenValueFrom(res);
    const stored = await prisma.refreshToken.findFirst({ where: { tokenHash: rawToken } });
    expect(stored).toBeNull();
    expect(await prisma.refreshToken.count({ where: { userId: res.body.data.user.id } })).toBe(1);
  });

  it("puts userId/organizationId/branchId/roleId in the access token", async () => {
    const tenant = await createTestTenant("ClaimsOrg");
    const actor = await createActor(tenant, "MANAGER", { branchScoped: true });

    const [, payload] = actor.accessToken.split(".");
    const claims = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8"));

    expect(claims).toMatchObject({
      userId: actor.user.id,
      organizationId: tenant.organization.id,
      branchId: tenant.branch.id,
      roleId: tenant.roleIdByName.get("MANAGER"),
      type: "access",
    });
    expect(claims.exp - claims.iat).toBe(900);
  });

  it("rejects a wrong password with 401 INVALID_CREDENTIALS", async () => {
    const actor = await createActorInNewTenant("OWNER", "WrongPwOrg");

    const res = await request(app)
      .post(`${AUTH}/login`)
      .send({ email: actor.user.email, password: "NotTheRightPassword1!" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("returns the same INVALID_CREDENTIALS for an unknown email (no account enumeration)", async () => {
    const res = await request(app)
      .post(`${AUTH}/login`)
      .send({ email: `ghost-${uniqueSuffix()}@example.test`, password: TEST_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("refuses to log in a deactivated user", async () => {
    const actor = await createActorInNewTenant("OWNER", "InactiveOrg");
    await prisma.user.update({ where: { id: actor.user.id }, data: { status: "INACTIVE" } });

    const res = await request(app)
      .post(`${AUTH}/login`)
      .send({ email: actor.user.email, password: TEST_PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ACCOUNT_INACTIVE");
  });

  it("asks for an organizationSlug when the same email exists in two orgs, then accepts it", async () => {
    const email = `shared-${uniqueSuffix()}@example.test`;
    const passwordHash = await hashPassword(TEST_PASSWORD);

    const tenantA = await createTestTenant("SharedA");
    const tenantB = await createTestTenant("SharedB");
    for (const tenant of [tenantA, tenantB]) {
      await prisma.user.create({
        data: {
          id: generateId(),
          organizationId: tenant.organization.id,
          name: "Shared Email User",
          email,
          passwordHash,
          roleId: tenant.roleIdByName.get("OWNER")!,
        },
      });
    }

    const ambiguous = await request(app)
      .post(`${AUTH}/login`)
      .send({ email, password: TEST_PASSWORD });
    expect(ambiguous.status).toBe(409);
    expect(ambiguous.body.error.code).toBe("AMBIGUOUS_LOGIN");

    const disambiguated = await request(app)
      .post(`${AUTH}/login`)
      .send({ email, password: TEST_PASSWORD, organizationSlug: tenantB.organization.slug });
    expect(disambiguated.status).toBe(200);

    const me = await request(app)
      .get(`${AUTH}/me`)
      .set("Authorization", `Bearer ${disambiguated.body.data.accessToken}`);
    expect(me.body.data.organization.id).toBe(tenantB.organization.id);
  });
});

describe("GET /auth/me", () => {
  it("returns { user, organization, branches, saas } for a real seeded-style user", async () => {
    const tenant = await createTestTenant("MeOrg");
    const actor = await createActor(tenant, "OWNER");

    const res = await request(app).get(`${AUTH}/me`).set(...bearer(actor));

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual(["branches", "organization", "saas", "user"]);

    expect(res.body.data.user).toMatchObject({
      id: actor.user.id,
      email: actor.user.email,
      status: "ACTIVE",
      branchId: null,
    });
    expect(res.body.data.user.role.name).toBe("OWNER");
    // OWNER holds the whole catalog, so a couple of representative keys is enough of a check.
    expect(res.body.data.user.role.permissions).toContain("users.manage");
    expect(res.body.data.user.role.permissions).toContain("roles.manage");
    expect(res.body.data.user).not.toHaveProperty("passwordHash");

    expect(res.body.data.organization).toMatchObject({
      id: tenant.organization.id,
      slug: tenant.organization.slug,
      status: "ACTIVE",
    });

    expect(res.body.data.branches).toHaveLength(1);
    expect(res.body.data.branches[0].id).toBe(tenant.branch.id);

    const subscription = await prisma.organizationSubscription.findUniqueOrThrow({
      where: { organizationId: tenant.organization.id },
      include: { plan: true },
    });
    expect(res.body.data.saas).toMatchObject({
      subscription: { id: subscription.id, status: "ACTIVE" },
      plan: { id: subscription.plan.id, code: SAAS_PLAN_CODE.GROWTH, name: subscription.plan.name },
    });
    expect(res.body.data.saas.entitlements[SAAS_ENTITLEMENT_KEY.MEMBERS_MAX]).toEqual({
      valueType: "UNLIMITED",
      intValue: null,
      boolValue: null,
    });
    expect(res.body.data.saas.entitlements[SAAS_ENTITLEMENT_KEY.LEADS]).toEqual({
      valueType: "BOOLEAN",
      intValue: null,
      boolValue: true,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|refreshToken|refresh_token/);
  });

  it("limits `branches` to the caller's own branch when the user is branch-scoped", async () => {
    const tenant = await createTestTenant("ScopedOrg");
    await prisma.branch.create({
      data: { id: generateId(), organizationId: tenant.organization.id, name: "Second Branch" },
    });
    const actor = await createActor(tenant, "RECEPTIONIST", { branchScoped: true });

    const res = await request(app).get(`${AUTH}/me`).set(...bearer(actor));

    expect(res.status).toBe(200);
    expect(res.body.data.user.branchId).toBe(tenant.branch.id);
    expect(res.body.data.branches.map((b: { id: string }) => b.id)).toEqual([tenant.branch.id]);
  });

  it("rejects a missing, malformed, or invalid token", async () => {
    const noHeader = await request(app).get(`${AUTH}/me`);
    expect(noHeader.status).toBe(401);
    expect(noHeader.body.error.code).toBe("UNAUTHENTICATED");

    const notBearer = await request(app).get(`${AUTH}/me`).set("Authorization", "Basic abc");
    expect(notBearer.body.error.code).toBe("UNAUTHENTICATED");

    const garbage = await request(app).get(`${AUTH}/me`).set("Authorization", "Bearer not.a.jwt");
    expect(garbage.status).toBe(401);
    expect(garbage.body.error.code).toBe("INVALID_TOKEN");
  });

  it("rejects a token signed with the wrong secret", async () => {
    // Same claim shape, different key: proves the signature is actually checked.
    const forged = [
      Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
      Buffer.from(
        JSON.stringify({
          userId: generateId(),
          organizationId: generateId(),
          branchId: null,
          roleId: generateId(),
          type: "access",
          exp: Math.floor(Date.now() / 1000) + 900,
        }),
      ).toString("base64url"),
      "definitely-not-a-valid-signature",
    ].join(".");

    const res = await request(app).get(`${AUTH}/me`).set("Authorization", `Bearer ${forged}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_TOKEN");
  });

  it("returns the caller's own subscription and ignores a client organizationId", async () => {
    const a = await createActorInNewTenant("OWNER", "SaasA");
    const b = await createActorInNewTenant("OWNER", "SaasB");
    const trial = await prisma.saasPlan.findUniqueOrThrow({ where: { code: SAAS_PLAN_CODE.TRIAL } });
    await prisma.organizationSubscription.update({
      where: { organizationId: b.organization.id },
      data: { planId: trial.id, status: "TRIAL" },
    });

    const smuggled = await request(app)
      .get(`${AUTH}/me`)
      .query({ organizationId: b.organization.id })
      .send({ organizationId: b.organization.id, planId: trial.id })
      .set(...bearer(a));

    expect(smuggled.status).toBe(200);
    expect(smuggled.body.data.organization.id).toBe(a.organization.id);
    expect(smuggled.body.data.saas.plan.code).toBe(SAAS_PLAN_CODE.GROWTH);
    expect(smuggled.body.data.saas.subscription.status).toBe("ACTIVE");

    const bMe = await request(app).get(`${AUTH}/me`).set(...bearer(b));
    expect(bMe.status).toBe(200);
    expect(bMe.body.data.organization.id).toBe(b.organization.id);
    expect(bMe.body.data.saas.plan.code).toBe(SAAS_PLAN_CODE.TRIAL);
    expect(bMe.body.data.saas.subscription.status).toBe("TRIAL");
    expect(bMe.body.data.saas.entitlements[SAAS_ENTITLEMENT_KEY.MEMBERS_MAX]).toEqual({
      valueType: "LIMIT",
      intValue: 50,
      boolValue: null,
    });
    expect(bMe.body.data.saas.subscription.id).not.toBe(smuggled.body.data.saas.subscription.id);
  });

  it("returns saas null when the organization has no subscription", async () => {
    const actor = await createActorInNewTenant("OWNER", "NoSub");
    await prisma.organizationSubscription.delete({
      where: { organizationId: actor.organization.id },
    });

    const res = await request(app).get(`${AUTH}/me`).set(...bearer(actor));
    expect(res.status).toBe(200);
    expect(res.body.data.saas).toBeNull();
    expect(res.body.data.organization.id).toBe(actor.organization.id);
    expect(res.body.data.organization.slug).not.toBe("demo-gym");
  });

  it("does not add saas to member or platform /me", async () => {
    const staff = await createActorInNewTenant("OWNER", "AudienceMe");
    const phone = `+9197${uniqueSuffix().slice(0, 8)}`;
    await prisma.member.create({
      data: {
        id: generateId(),
        organizationId: staff.organization.id,
        branchId: staff.branch.id,
        firstName: "Keep",
        lastName: "Isolated",
        phone,
        passwordHash: await hashPassword(TEST_PASSWORD),
      },
    });

    const memberLogin = await request(app).post(`${AUTH}/member/login`).send({
      phone,
      password: TEST_PASSWORD,
      organizationSlug: staff.organization.slug,
    });
    expect(memberLogin.status).toBe(200);
    const memberMe = await request(app)
      .get(`${AUTH}/member/me`)
      .set("Authorization", `Bearer ${memberLogin.body.data.accessToken}`);
    expect(memberMe.status).toBe(200);
    expect(memberMe.body.data).not.toHaveProperty("saas");
    expect(Object.keys(memberMe.body.data).sort()).toEqual(["branch", "member", "organization"]);

    const platform = await createPlatformOperator();
    const platformMe = await request(app)
      .get(`${AUTH}/platform/me`)
      .set("Authorization", `Bearer ${platform.accessToken}`);
    expect(platformMe.status).toBe(200);
    expect(platformMe.body.data).not.toHaveProperty("saas");
    expect(Object.keys(platformMe.body.data).sort()).toEqual(["user"]);
  });
});

describe("POST /auth/refresh — rotation and reuse detection", () => {
  it("rotates the token on each use and keeps the family id stable", async () => {
    const actor = await createActorInNewTenant("OWNER", "RotateOrg");

    const res = await request(app).post(`${AUTH}/refresh`).set("Cookie", actor.refreshCookie);
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));

    const rotated = refreshTokenValueFrom(res);
    expect(rotated).not.toBe(actor.refreshToken);

    const family = await prisma.refreshToken.findMany({
      where: { userId: actor.user.id },
      orderBy: { createdAt: "asc" },
    });
    expect(family).toHaveLength(2);
    expect(family[0]!.familyId).toBe(family[1]!.familyId);
    expect(family[0]!.revokedAt).not.toBeNull(); // the presented token is now spent
    expect(family[1]!.revokedAt).toBeNull(); // its replacement is live
  });

  it("revokes the ENTIRE family when an already-rotated token is replayed", async () => {
    const actor = await createActorInNewTenant("OWNER", "ReuseOrg");

    // Legitimate rotation: R1 -> R2.
    const rotation = await request(app).post(`${AUTH}/refresh`).set("Cookie", actor.refreshCookie);
    expect(rotation.status).toBe(200);
    const liveCookie = refreshCookieFrom(rotation);

    const familyId = (await prisma.refreshToken.findFirstOrThrow({
      where: { userId: actor.user.id },
    })).familyId;

    // Sanity check before the replay: exactly one token in the family is still live (R2).
    expect(
      await prisma.refreshToken.count({ where: { familyId, revokedAt: null } }),
    ).toBe(1);

    // An attacker replays the stolen, already-spent R1.
    const replay = await request(app).post(`${AUTH}/refresh`).set("Cookie", actor.refreshCookie);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe("TOKEN_REUSE_DETECTED");

    // The whole chain is dead — including R2, which was never presented. This is the part that
    // distinguishes family revocation from merely rejecting the replayed token.
    const afterReplay = await prisma.refreshToken.findMany({ where: { familyId } });
    expect(afterReplay).toHaveLength(2);
    expect(afterReplay.every((t) => t.revokedAt !== null)).toBe(true);

    // And the legitimate user's still-held R2 no longer works.
    const victim = await request(app).post(`${AUTH}/refresh`).set("Cookie", liveCookie);
    expect(victim.status).toBe(401);
    expect(victim.body.error.code).toBe("TOKEN_REUSE_DETECTED");

    // The failed refresh also clears the browser's cookie rather than leaving a dead token behind.
    const cleared = (replay.headers["set-cookie"] as unknown as string[]).find((c) =>
      c.startsWith(`${REFRESH_COOKIE_NAME}=`),
    );
    expect(cleared).toContain(`${REFRESH_COOKIE_NAME}=;`);
  });

  it("revokes only the compromised family, leaving the user's other sessions alone", async () => {
    const tenant = await createTestTenant("TwoDeviceOrg");
    const laptop = await createActor(tenant, "OWNER");

    // Same user logs in again (a second device) — a separate family.
    const phoneLogin = await request(app)
      .post(`${AUTH}/login`)
      .send({ email: laptop.user.email, password: TEST_PASSWORD });
    const phoneCookie = refreshCookieFrom(phoneLogin);

    // Compromise the laptop family: rotate, then replay.
    await request(app).post(`${AUTH}/refresh`).set("Cookie", laptop.refreshCookie);
    const replay = await request(app).post(`${AUTH}/refresh`).set("Cookie", laptop.refreshCookie);
    expect(replay.body.error.code).toBe("TOKEN_REUSE_DETECTED");

    // The phone session is untouched.
    const phoneRefresh = await request(app).post(`${AUTH}/refresh`).set("Cookie", phoneCookie);
    expect(phoneRefresh.status).toBe(200);
  });

  it("accepts the refresh token from the body for non-browser clients", async () => {
    const actor = await createActorInNewTenant("OWNER", "BodyTokenOrg");

    const res = await request(app)
      .post(`${AUTH}/refresh`)
      .send({ refreshToken: actor.refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
  });

  it("rejects an unknown token and an expired token", async () => {
    const unknown = await request(app)
      .post(`${AUTH}/refresh`)
      .send({ refreshToken: "this-token-was-never-issued" });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.code).toBe("INVALID_TOKEN");

    const actor = await createActorInNewTenant("OWNER", "ExpiredTokenOrg");
    await prisma.refreshToken.updateMany({
      where: { userId: actor.user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const expired = await request(app).post(`${AUTH}/refresh`).set("Cookie", actor.refreshCookie);
    expect(expired.status).toBe(401);
    expect(expired.body.error.code).toBe("TOKEN_EXPIRED");
  });

  it("returns 401 when no refresh token is supplied at all", async () => {
    const res = await request(app).post(`${AUTH}/refresh`).send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_TOKEN");
  });
});

describe("POST /auth/logout", () => {
  it("revokes the session family and clears the cookie", async () => {
    const actor = await createActorInNewTenant("OWNER", "LogoutOrg");

    const res = await request(app).post(`${AUTH}/logout`).set("Cookie", actor.refreshCookie);
    expect(res.status).toBe(200);

    expect(
      await prisma.refreshToken.count({ where: { userId: actor.user.id, revokedAt: null } }),
    ).toBe(0);

    const afterLogout = await request(app)
      .post(`${AUTH}/refresh`)
      .set("Cookie", actor.refreshCookie);
    expect(afterLogout.status).toBe(401);
  });

  it("is idempotent for an unknown token", async () => {
    const res = await request(app)
      .post(`${AUTH}/logout`)
      .send({ refreshToken: "never-issued-anything" });
    expect(res.status).toBe(200);
  });
});

describe("password reset", () => {
  it("issues a reset token, changes the password, and kills every existing session", async () => {
    const actor = await createActorInNewTenant("OWNER", "ResetOrg");
    const newPassword = "BrandNewPassw0rd!";

    const forgot = await request(app)
      .post(`${AUTH}/forgot-password`)
      .send({ email: actor.user.email });
    expect(forgot.status).toBe(200);
    const resetToken = forgot.body.data.resetToken as string;
    expect(resetToken).toEqual(expect.any(String));

    // Stored hashed, never in plaintext.
    expect(
      await prisma.passwordResetToken.findFirst({ where: { tokenHash: resetToken } }),
    ).toBeNull();

    const reset = await request(app)
      .post(`${AUTH}/reset-password`)
      .send({ token: resetToken, password: newPassword });
    expect(reset.status).toBe(200);

    // Old password no longer works; new one does.
    const oldPw = await request(app)
      .post(`${AUTH}/login`)
      .send({ email: actor.user.email, password: TEST_PASSWORD });
    expect(oldPw.status).toBe(401);

    const newPw = await request(app)
      .post(`${AUTH}/login`)
      .send({ email: actor.user.email, password: newPassword });
    expect(newPw.status).toBe(200);

    // The pre-reset refresh token is dead — a password reset that left sessions alive would
    // leave an attacker logged in.
    const staleRefresh = await request(app)
      .post(`${AUTH}/refresh`)
      .set("Cookie", actor.refreshCookie);
    expect(staleRefresh.status).toBe(401);
  });

  it("burns the reset token after one use", async () => {
    const actor = await createActorInNewTenant("OWNER", "OneShotResetOrg");

    const forgot = await request(app)
      .post(`${AUTH}/forgot-password`)
      .send({ email: actor.user.email });
    const token = forgot.body.data.resetToken as string;

    expect(
      (await request(app).post(`${AUTH}/reset-password`).send({ token, password: "FirstUse123!" }))
        .status,
    ).toBe(200);

    const second = await request(app)
      .post(`${AUTH}/reset-password`)
      .send({ token, password: "SecondUse123!" });
    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe("INVALID_RESET_TOKEN");
  });

  it("rejects an expired reset token", async () => {
    const actor = await createActorInNewTenant("OWNER", "ExpiredResetOrg");
    const forgot = await request(app)
      .post(`${AUTH}/forgot-password`)
      .send({ email: actor.user.email });

    await prisma.passwordResetToken.updateMany({
      where: { userId: actor.user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(app)
      .post(`${AUTH}/reset-password`)
      .send({ token: forgot.body.data.resetToken, password: "TooLate123!" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_RESET_TOKEN");
  });

  it("reports success for an unknown email without issuing a token", async () => {
    const before = await prisma.passwordResetToken.count();

    const res = await request(app)
      .post(`${AUTH}/forgot-password`)
      .send({ email: `nobody-${uniqueSuffix()}@example.test` });

    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
    expect(await prisma.passwordResetToken.count()).toBe(before);
  });

  it("rejects a weak new password", async () => {
    const actor = await createActorInNewTenant("OWNER", "WeakResetOrg");
    const forgot = await request(app)
      .post(`${AUTH}/forgot-password`)
      .send({ email: actor.user.email });

    const res = await request(app)
      .post(`${AUTH}/reset-password`)
      .send({ token: forgot.body.data.resetToken, password: "short" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("login rate limiting", () => {
  it("locks out after the configured number of failed attempts", async () => {
    const actor = await createActorInNewTenant("OWNER", "RateLimitOrg");
    const maxAttempts = 5; // LOGIN_RATE_LIMIT_MAX_ATTEMPTS default

    const statuses: number[] = [];
    for (let attempt = 1; attempt <= maxAttempts + 2; attempt += 1) {
      const res = await request(app)
        .post(`${AUTH}/login`)
        .send({ email: actor.user.email, password: "WrongPassword123!" });
      statuses.push(res.status);
    }

    expect(statuses.slice(0, maxAttempts)).toEqual(Array(maxAttempts).fill(401));
    expect(statuses.slice(maxAttempts)).toEqual([429, 429]);

    const blocked = await request(app)
      .post(`${AUTH}/login`)
      .send({ email: actor.user.email, password: "WrongPassword123!" });
    expect(blocked.body.error.code).toBe("RATE_LIMIT_EXCEEDED");

    // Lockout persists even once the password is right — the limiter runs before the handler.
    const withCorrectPassword = await request(app)
      .post(`${AUTH}/login`)
      .send({ email: actor.user.email, password: TEST_PASSWORD });
    expect(withCorrectPassword.status).toBe(429);
  });

  it("does not let one locked-out account block a different one", async () => {
    const victim = await createActorInNewTenant("OWNER", "NeighbourOrg");
    const attackedEmail = `attacked-${uniqueSuffix()}@example.test`;

    for (let attempt = 0; attempt < 7; attempt += 1) {
      await request(app)
        .post(`${AUTH}/login`)
        .send({ email: attackedEmail, password: "WrongPassword123!" });
    }

    // Same source IP, different account: still able to log in normally.
    const res = await request(app)
      .post(`${AUTH}/login`)
      .send({ email: victim.user.email, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
  });

  it("does not consume the budget on successful logins", async () => {
    const actor = await createActorInNewTenant("OWNER", "HappyPathOrg");

    // Well past the 5-attempt threshold, all successful.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const res = await request(app)
        .post(`${AUTH}/login`)
        .send({ email: actor.user.email, password: TEST_PASSWORD });
      expect(res.status).toBe(200);
    }
  });
});

describe("tenant isolation (tenant.middleware)", () => {
  it("denies org A's token against org B's data on every module", async () => {
    const orgA = await createActorInNewTenant("OWNER", "TenantA");
    const orgB = await createActorInNewTenant("OWNER", "TenantB");
    const bId = orgB.organization.id;

    const crossTenantAttempts = [
      ["GET", `/api/v1/organizations/${bId}`],
      ["PATCH", `/api/v1/organizations/${bId}`],
      ["GET", `/api/v1/organizations/${bId}/branches`],
      ["POST", `/api/v1/organizations/${bId}/branches`],
      ["GET", `/api/v1/organizations/${bId}/branches/${orgB.branch.id}`],
      ["GET", `/api/v1/organizations/${bId}/users`],
      ["POST", `/api/v1/organizations/${bId}/users`],
      ["GET", `/api/v1/organizations/${bId}/users/${orgB.user.id}`],
      ["DELETE", `/api/v1/organizations/${bId}/users/${orgB.user.id}`],
      ["GET", `/api/v1/organizations/${bId}/roles`],
      ["POST", `/api/v1/organizations/${bId}/roles`],
      ["GET", `/api/v1/organizations/${bId}/roles/${orgB.roleIdByName.get("OWNER")}`],
    ] as const;

    for (const [method, path] of crossTenantAttempts) {
      const verb = method.toLowerCase() as "get" | "post" | "patch" | "delete";
      const res = await request(app)[verb](path)
        .set(...bearer(orgA))
        .send({ name: "Attempted cross-tenant write" });

      expect(
        { method, path, status: res.status, code: res.body.error?.code },
        `${method} ${path} should have been denied`,
      ).toEqual({ method, path, status: 403, code: "ORG_MISMATCH" });
    }

    // Nothing leaked into org B.
    expect(await prisma.branch.count({ where: { organizationId: bId } })).toBe(1);
    expect(await prisma.user.count({ where: { organizationId: bId } })).toBe(1);
  });

  it("rejects an organizationId smuggled in the body or query, even on the caller's own URL", async () => {
    const orgA = await createActorInNewTenant("OWNER", "BodyClaimA");
    const orgB = await createActorInNewTenant("OWNER", "BodyClaimB");

    const viaBody = await request(app)
      .post(`/api/v1/organizations/${orgA.organization.id}/branches`)
      .set(...bearer(orgA))
      .send({ name: "Smuggled Branch", organizationId: orgB.organization.id });
    expect(viaBody.status).toBe(403);
    expect(viaBody.body.error.code).toBe("ORG_MISMATCH");

    const viaQuery = await request(app)
      .get(`/api/v1/organizations/${orgA.organization.id}/branches`)
      .query({ organizationId: orgB.organization.id })
      .set(...bearer(orgA));
    expect(viaQuery.status).toBe(403);
    expect(viaQuery.body.error.code).toBe("ORG_MISMATCH");
  });

  it("stops a branch-scoped user from acting on another branch", async () => {
    const tenant = await createTestTenant("BranchScopeOrg");
    const otherBranch = await prisma.branch.create({
      data: { id: generateId(), organizationId: tenant.organization.id, name: "Other Branch" },
    });
    const receptionist = await createActor(tenant, "RECEPTIONIST", { branchScoped: true });

    const res = await request(app)
      .get(`/api/v1/organizations/${tenant.organization.id}/branches/${otherBranch.id}`)
      .set(...bearer(receptionist));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("BRANCH_MISMATCH");

    // Their own branch is still reachable.
    const own = await request(app)
      .get(`/api/v1/organizations/${tenant.organization.id}/branches/${tenant.branch.id}`)
      .set(...bearer(receptionist));
    expect(own.status).toBe(200);
  });

  it("lets an org-wide user name any branch in their own org", async () => {
    const tenant = await createTestTenant("OrgWideOrg");
    const owner = await createActor(tenant, "OWNER"); // branchId: null
    const secondBranch = await prisma.branch.create({
      data: { id: generateId(), organizationId: tenant.organization.id, name: "Second Branch" },
    });

    const res = await request(app)
      .post(`/api/v1/organizations/${tenant.organization.id}/users`)
      .set(...bearer(owner))
      .send({
        name: "Desk Staff",
        email: `desk-${uniqueSuffix()}@example.test`,
        password: TEST_PASSWORD,
        roleId: tenant.roleIdByName.get("RECEPTIONIST"),
        branchId: secondBranch.id,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.branchId).toBe(secondBranch.id);
  });

  it("requires authentication on every module route", async () => {
    const tenant = await createTestTenant("NoAuthOrg");
    const paths = [
      `/api/v1/organizations/${tenant.organization.id}`,
      `/api/v1/organizations/${tenant.organization.id}/branches`,
      `/api/v1/organizations/${tenant.organization.id}/users`,
      `/api/v1/organizations/${tenant.organization.id}/roles`,
      `/api/v1/permissions`,
    ];

    for (const path of paths) {
      const res = await request(app).get(path);
      expect({ path, status: res.status }).toEqual({ path, status: 401 });
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    }
  });

  it("does not trust an org id embedded in a validly-signed token for a different org's URL", async () => {
    // A token can claim any org — the point is that the URL must agree with it, and the data
    // returned is the token's org, never the URL's.
    const orgA = await createActorInNewTenant("OWNER", "ForgedClaimA");
    const orgB = await createActorInNewTenant("OWNER", "ForgedClaimB");

    const tokenClaimingB = signAccessToken({
      userId: orgA.user.id,
      organizationId: orgB.organization.id,
      branchId: null,
      roleId: orgA.roleIdByName.get("OWNER")!,
    });

    // The forged token's org doesn't match org A's URL, so the tenant guard rejects it.
    const res = await request(app)
      .get(`/api/v1/organizations/${orgA.organization.id}`)
      .set("Authorization", `Bearer ${tokenClaimingB}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ORG_MISMATCH");

    // And against org B's URL it can't find user A there either — /me is org-scoped.
    const me = await request(app)
      .get(`${AUTH}/me`)
      .set("Authorization", `Bearer ${tokenClaimingB}`);
    expect(me.status).toBe(404);
  });
});

describe("permission enforcement (permission.middleware)", () => {
  it("blocks a RECEPTIONIST from the ADMIN-only users module", async () => {
    const tenant = await createTestTenant("PermOrg");
    const receptionist = await createActor(tenant, "RECEPTIONIST");
    const orgPath = `/api/v1/organizations/${tenant.organization.id}`;

    const create = await request(app)
      .post(`${orgPath}/users`)
      .set(...bearer(receptionist))
      .send({
        name: "Sneaky Admin",
        email: `sneaky-${uniqueSuffix()}@example.test`,
        password: TEST_PASSWORD,
        roleId: tenant.roleIdByName.get("OWNER"),
      });

    expect(create.status).toBe(403);
    expect(create.body.error.code).toBe("PERMISSION_DENIED");
    expect(create.body.error.message).toContain("users.manage");

    // Reads are gated too — the staff list exposes colleagues' details.
    const list = await request(app).get(`${orgPath}/users`).set(...bearer(receptionist));
    expect(list.status).toBe(403);
    expect(list.body.error.code).toBe("PERMISSION_DENIED");

    // Nothing was written despite the POST.
    expect(
      await prisma.user.count({ where: { organizationId: tenant.organization.id } }),
    ).toBe(1);

    // The same request from an OWNER succeeds, proving it's the permission and not a broken route.
    const owner = await createActor(tenant, "OWNER");
    const allowed = await request(app)
      .post(`${orgPath}/users`)
      .set(...bearer(owner))
      .send({
        name: "Legitimate Staff",
        email: `legit-${uniqueSuffix()}@example.test`,
        password: TEST_PASSWORD,
        roleId: tenant.roleIdByName.get("RECEPTIONIST"),
      });
    expect(allowed.status).toBe(201);
  });

  it("enforces the Section 4.2 matrix per role and route", async () => {
    const tenant = await createTestTenant("MatrixOrg");
    const orgPath = `/api/v1/organizations/${tenant.organization.id}`;

    const owner = await createActor(tenant, "OWNER");
    const admin = await createActor(tenant, "ADMIN");
    const receptionist = await createActor(tenant, "RECEPTIONIST");

    // organizations.update — OWNER only (ADMIN is explicitly excluded in the matrix).
    expect((await request(app).patch(orgPath).set(...bearer(owner)).send({ name: "Renamed" })).status).toBe(200);
    expect((await request(app).patch(orgPath).set(...bearer(admin)).send({ name: "Nope" })).status).toBe(403);

    // roles.manage — OWNER only.
    expect((await request(app).get(`${orgPath}/roles`).set(...bearer(owner))).status).toBe(200);
    expect((await request(app).get(`${orgPath}/roles`).set(...bearer(admin))).status).toBe(403);

    // users.manage — OWNER and ADMIN.
    expect((await request(app).get(`${orgPath}/users`).set(...bearer(admin))).status).toBe(200);
    expect((await request(app).get(`${orgPath}/users`).set(...bearer(receptionist))).status).toBe(403);

    // branches.manage guards writes; reads are open to any authenticated user.
    expect((await request(app).get(`${orgPath}/branches`).set(...bearer(receptionist))).status).toBe(200);
    expect(
      (await request(app).post(`${orgPath}/branches`).set(...bearer(receptionist)).send({ name: "New Branch" }))
        .status,
    ).toBe(403);
    expect(
      (await request(app).post(`${orgPath}/branches`).set(...bearer(admin)).send({ name: "New Branch" })).status,
    ).toBe(201);
  });

  it("re-checks permissions against the database, so revoking one takes effect immediately", async () => {
    const tenant = await createTestTenant("RevokeOrg");
    const admin = await createActor(tenant, "ADMIN");
    const orgPath = `/api/v1/organizations/${tenant.organization.id}`;

    expect((await request(app).get(`${orgPath}/users`).set(...bearer(admin))).status).toBe(200);

    const usersManage = await prisma.permission.findUniqueOrThrow({
      where: { key: "users.manage" },
    });
    await prisma.rolePermission.delete({
      where: {
        roleId_permissionId: {
          roleId: tenant.roleIdByName.get("ADMIN")!,
          permissionId: usersManage.id,
        },
      },
    });

    // Same unexpired access token, permission now gone.
    const after = await request(app).get(`${orgPath}/users`).set(...bearer(admin));
    expect(after.status).toBe(403);
    expect(after.body.error.code).toBe("PERMISSION_DENIED");
  });
});
