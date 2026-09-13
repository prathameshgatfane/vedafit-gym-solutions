import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../../test/helpers/app";
import {
  TEST_PASSWORD,
  bearer,
  createActorInNewTenant,
  createPlatformOperator,
  platformRefreshCookieFrom,
  platformRefreshTokenValueFrom,
} from "../../../test/helpers/auth";
import { uniqueSuffix } from "../../../test/helpers/fixtures";
import { generateId } from "../../lib/id";
import { hashPassword } from "../../lib/password";
import { prisma } from "../../lib/prisma";
import { PLATFORM_REFRESH_COOKIE_NAME } from "./auth.controller";

const PLATFORM = "/api/v1/auth/platform";
const STAFF = "/api/v1/auth";

async function loginMember(organizationSlug: string, phone: string) {
  const res = await request(app).post(`${STAFF}/member/login`).send({
    phone,
    password: TEST_PASSWORD,
    organizationSlug,
  });
  expect(res.status).toBe(200);
  return res.body.data.accessToken as string;
}

describe("POST /auth/platform/login", () => {
  it("returns a platform_access token and an httpOnly platform_refresh cookie", async () => {
    const operator = await createPlatformOperator();

    expect(operator.accessToken).toEqual(expect.any(String));
    const [, payload] = operator.accessToken.split(".");
    const claims = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8"));
    expect(claims).toMatchObject({
      type: "platform_access",
      platformUserId: operator.user.id,
    });
    expect(claims.organizationId).toBeUndefined();
    expect(claims.userId).toBeUndefined();
    expect(claims.memberId).toBeUndefined();
    expect(claims.exp - claims.iat).toBe(900);

    const cookie = operator.refreshCookie;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/api/v1/auth/platform");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Secure");

    const stored = await prisma.platformRefreshToken.findFirst({
      where: { tokenHash: operator.refreshToken },
    });
    expect(stored).toBeNull();
    expect(
      await prisma.platformRefreshToken.count({ where: { platformUserId: operator.user.id } }),
    ).toBe(1);
  });

  it("never returns a password hash", async () => {
    const operator = await createPlatformOperator();
    const res = await request(app)
      .post(`${PLATFORM}/login`)
      .send({ email: operator.user.email, password: TEST_PASSWORD });
    expect(JSON.stringify(res.body)).not.toContain("$2a$");
    expect(res.body.data.user.passwordHash).toBeUndefined();
  });

  it("rejects a wrong password with 401 INVALID_CREDENTIALS", async () => {
    const operator = await createPlatformOperator();
    const res = await request(app)
      .post(`${PLATFORM}/login`)
      .send({ email: operator.user.email, password: "NotTheRightPassword1!" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("returns the same INVALID_CREDENTIALS for an unknown email", async () => {
    const res = await request(app)
      .post(`${PLATFORM}/login`)
      .send({ email: `ghost-${uniqueSuffix()}@vedafit.test`, password: TEST_PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("does not accept a gym staff email as a platform login", async () => {
    const staff = await createActorInNewTenant("OWNER", "NotPlatform");
    const res = await request(app)
      .post(`${PLATFORM}/login`)
      .send({ email: staff.user.email, password: TEST_PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("refuses an INACTIVE platform user after a correct password", async () => {
    const operator = await createPlatformOperator();
    await prisma.platformUser.update({
      where: { id: operator.user.id },
      data: { status: "INACTIVE" },
    });
    const res = await request(app)
      .post(`${PLATFORM}/login`)
      .send({ email: operator.user.email, password: TEST_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ACCOUNT_INACTIVE");
  });
});

describe("GET /auth/platform/me", () => {
  it("accepts a valid platform token", async () => {
    const operator = await createPlatformOperator();
    const res = await request(app)
      .get(`${PLATFORM}/me`)
      .set("Authorization", `Bearer ${operator.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(operator.user.id);
    expect(res.body.data.user.email).toBe(operator.user.email);
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("$2a$");
  });
});

describe("identity boundaries", () => {
  it("rejects a platform token on staff /auth/me", async () => {
    const operator = await createPlatformOperator();
    const res = await request(app)
      .get(`${STAFF}/me`)
      .set("Authorization", `Bearer ${operator.accessToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_TOKEN");
  });

  it("rejects a platform token on a tenant-scoped staff route", async () => {
    const staff = await createActorInNewTenant("OWNER", "PlatIso");
    const operator = await createPlatformOperator();
    const res = await request(app)
      .get(`/api/v1/organizations/${staff.organization.id}`)
      .set("Authorization", `Bearer ${operator.accessToken}`);
    expect(res.status).toBe(401);
  });

  it("rejects a platform token on member /auth/member/me", async () => {
    const operator = await createPlatformOperator();
    const res = await request(app)
      .get(`${STAFF}/member/me`)
      .set("Authorization", `Bearer ${operator.accessToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_TOKEN");
  });

  it("rejects a staff token on /auth/platform/me", async () => {
    const staff = await createActorInNewTenant("OWNER", "StaffVsPlat");
    const res = await request(app).get(`${PLATFORM}/me`).set(...bearer(staff));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_TOKEN");
  });

  it("rejects a member token on /auth/platform/me", async () => {
    const staff = await createActorInNewTenant("OWNER", "MemVsPlat");
    const phone = `+9198${uniqueSuffix().slice(0, 8)}`;
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
    const memberToken = await loginMember(staff.organization.slug, phone);
    const res = await request(app)
      .get(`${PLATFORM}/me`)
      .set("Authorization", `Bearer ${memberToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_TOKEN");
  });
});

describe("POST /auth/platform/refresh", () => {
  it("rotates the cookie and issues a new access token", async () => {
    const operator = await createPlatformOperator();
    const firstHashCount = await prisma.platformRefreshToken.count({
      where: { platformUserId: operator.user.id, revokedAt: null },
    });
    expect(firstHashCount).toBe(1);

    const res = await request(app)
      .post(`${PLATFORM}/refresh`)
      .set("Cookie", operator.refreshCookie);
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    const rotated = platformRefreshCookieFrom(res);
    expect(rotated).toContain(PLATFORM_REFRESH_COOKIE_NAME);
    expect(platformRefreshTokenValueFrom(res)).not.toBe(operator.refreshToken);
    const live = await prisma.platformRefreshToken.count({
      where: { platformUserId: operator.user.id, revokedAt: null },
    });
    expect(live).toBe(1);
  });

  it("revokes the whole family when a rotated token is replayed", async () => {
    const operator = await createPlatformOperator();
    const first = await request(app)
      .post(`${PLATFORM}/refresh`)
      .set("Cookie", operator.refreshCookie);
    expect(first.status).toBe(200);

    const replay = await request(app)
      .post(`${PLATFORM}/refresh`)
      .set("Cookie", operator.refreshCookie);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe("TOKEN_REUSE_DETECTED");

    const live = await prisma.platformRefreshToken.count({
      where: { platformUserId: operator.user.id, revokedAt: null },
    });
    expect(live).toBe(0);
  });
});

describe("POST /auth/platform/logout", () => {
  it("revokes the family so refresh cannot continue", async () => {
    const operator = await createPlatformOperator();
    const out = await request(app)
      .post(`${PLATFORM}/logout`)
      .set("Cookie", operator.refreshCookie);
    expect(out.status).toBe(200);

    const refresh = await request(app)
      .post(`${PLATFORM}/refresh`)
      .set("Cookie", operator.refreshCookie);
    expect(refresh.status).toBe(401);
    expect(refresh.body.error.code).toBe("TOKEN_REUSE_DETECTED");
  });
});

describe("existing audiences still work", () => {
  it("staff login and /auth/me still succeed", async () => {
    const staff = await createActorInNewTenant("OWNER", "StaffStill");
    const res = await request(app).get(`${STAFF}/me`).set(...bearer(staff));
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(staff.user.email);
    expect(res.body.data.organization.id).toBe(staff.organization.id);
  });

  it("member login and tenant isolation still succeed", async () => {
    const staff = await createActorInNewTenant("OWNER", "MemStill");
    const other = await createActorInNewTenant("OWNER", "MemOther");
    const phone = `+9197${uniqueSuffix().slice(0, 8)}`;
    const member = await prisma.member.create({
      data: {
        id: generateId(),
        organizationId: staff.organization.id,
        branchId: staff.branch.id,
        firstName: "Keep",
        lastName: "Going",
        phone,
        passwordHash: await hashPassword(TEST_PASSWORD),
      },
    });
    const token = await loginMember(staff.organization.slug, phone);
    const me = await request(app)
      .get(`${STAFF}/member/me`)
      .set("Authorization", `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.data.member.id).toBe(member.id);

    const cross = await request(app)
      .get(`/api/v1/organizations/${other.organization.id}`)
      .set(...bearer(staff));
    expect(cross.status).toBe(403);
    expect(cross.body.error.code).toBe("ORG_MISMATCH");
  });
});
