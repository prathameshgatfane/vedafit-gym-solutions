import request from "supertest";
import { generateId } from "../../src/lib/id";
import { hashPassword } from "../../src/lib/password";
import { prisma } from "../../src/lib/prisma";
import {
  syncOrganizationRoleMatrix,
  syncPermissionCatalog,
} from "../../src/lib/rbac-catalog";
import { REFRESH_COOKIE_NAME } from "../../src/modules/auth/auth.controller";
import { app } from "./app";
import { uniqueSuffix } from "./fixtures";

/** Password used by every helper-created test user. Meets the reset-password complexity rules. */
export const TEST_PASSWORD = "TestPassw0rd!";

export interface TestTenant {
  organization: { id: string; name: string; slug: string; email: string };
  branch: { id: string; name: string };
  /** Role name → role id, for all six default roles (Section 4.2). */
  roleIdByName: Map<string, string>;
}

/**
 * Builds an isolated organization with a branch and the full default role matrix, so tests can
 * exercise real permission keys instead of ad hoc ones. The permission catalog is global and
 * upserted, so calling this repeatedly is cheap after the first time.
 */
export async function createTestTenant(namePrefix = "Tenant"): Promise<TestTenant> {
  await syncPermissionCatalog();

  const suffix = uniqueSuffix();
  const organization = await prisma.organization.create({
    data: {
      id: generateId(),
      name: `${namePrefix} ${suffix}`,
      slug: `${namePrefix.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${suffix}`,
      email: `tenant-${suffix}@example.test`,
    },
  });

  const branch = await prisma.branch.create({
    data: { id: generateId(), organizationId: organization.id, name: `Branch ${suffix}` },
  });

  const roleIdByName = await syncOrganizationRoleMatrix(organization.id);

  return { organization, branch, roleIdByName };
}

export interface TestActor extends TestTenant {
  user: { id: string; name: string; email: string; branchId: string | null };
  roleName: string;
  password: string;
  accessToken: string;
  /** Raw `Set-Cookie` value for the refresh cookie, ready to hand back to supertest. */
  refreshCookie: string;
  /** Raw refresh token value, for tests that need to replay it directly. */
  refreshToken: string;
}

/** Extracts the refresh cookie from a login/refresh response's Set-Cookie header. */
export function refreshCookieFrom(res: request.Response): string {
  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  const cookie = raw?.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
  if (!cookie) {
    throw new Error(`Response did not set a ${REFRESH_COOKIE_NAME} cookie`);
  }
  return cookie;
}

export function refreshTokenValueFrom(res: request.Response): string {
  const cookie = refreshCookieFrom(res);
  return decodeURIComponent(cookie.split(";")[0]!.split("=")[1]!);
}

/**
 * Creates a user with the given default role inside `tenant` and logs them in through the real
 * `POST /auth/login` endpoint — so every test that needs credentials is also, incidentally,
 * exercising the login path rather than minting a token behind the API's back.
 */
export async function createActor(
  tenant: TestTenant,
  roleName = "OWNER",
  options: { branchScoped?: boolean } = {},
): Promise<TestActor> {
  const roleId = tenant.roleIdByName.get(roleName);
  if (!roleId) {
    throw new Error(`Unknown default role "${roleName}"`);
  }

  const suffix = uniqueSuffix();
  const email = `${roleName.toLowerCase()}-${suffix}@example.test`;

  const user = await prisma.user.create({
    data: {
      id: generateId(),
      organizationId: tenant.organization.id,
      name: `${roleName} ${suffix}`,
      email,
      passwordHash: await hashPassword(TEST_PASSWORD),
      roleId,
      branchId: options.branchScoped ? tenant.branch.id : null,
    },
  });

  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password: TEST_PASSWORD });

  if (res.status !== 200) {
    throw new Error(`Test login failed (${res.status}): ${JSON.stringify(res.body)}`);
  }

  return {
    ...tenant,
    user,
    roleName,
    password: TEST_PASSWORD,
    accessToken: res.body.data.accessToken as string,
    refreshCookie: refreshCookieFrom(res),
    refreshToken: refreshTokenValueFrom(res),
  };
}

/** Convenience: a fresh tenant plus one logged-in actor in it. */
export async function createActorInNewTenant(
  roleName = "OWNER",
  namePrefix = "Tenant",
): Promise<TestActor> {
  return createActor(await createTestTenant(namePrefix), roleName);
}

/** `Authorization` header value for supertest: `.set(...bearer(actor))`. */
export function bearer(actor: TestActor): [string, string] {
  return ["Authorization", `Bearer ${actor.accessToken}`];
}
