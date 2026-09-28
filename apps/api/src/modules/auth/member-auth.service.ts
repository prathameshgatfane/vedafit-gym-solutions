import { env } from "../../config/env";
import { AppError } from "../../lib/app-error";
import { ErrorCode } from "../../lib/error-codes";
import { generateId } from "../../lib/id";
import { accessTokenTtlSeconds, signMemberAccessToken } from "../../lib/jwt";
import { logger } from "../../lib/logger";
import { hashPassword, verifyPassword } from "../../lib/password";
import { prisma, withGeneratedId } from "../../lib/prisma";
import { generateOpaqueToken, hashToken } from "../../lib/tokens";
import type { MemberAccessTokenPayload } from "../../lib/jwt";
import type { MemberChangePasswordInput, MemberLoginInput } from "./auth.schema";

const DUMMY_PASSWORD_HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

export interface IssuedMemberSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

function refreshTokenExpiry(): Date {
  return new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

async function issueMemberSession(
  member: { id: string; organizationId: string },
  familyId: string,
): Promise<IssuedMemberSession> {
  const accessToken = signMemberAccessToken({
    memberId: member.id,
    organizationId: member.organizationId,
  });
  const refreshToken = generateOpaqueToken();

  await prisma.memberRefreshToken.create({
    data: withGeneratedId({
      memberId: member.id,
      familyId,
      tokenHash: hashToken(refreshToken),
      expiresAt: refreshTokenExpiry(),
    }),
  });

  return { accessToken, refreshToken, expiresIn: accessTokenTtlSeconds() };
}

async function revokeFamily(familyId: string): Promise<number> {
  const { count } = await prisma.memberRefreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count;
}

function toProfile(member: {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  status: string;
  branchId: string;
}) {
  return {
    id: member.id,
    firstName: member.firstName,
    lastName: member.lastName,
    phone: member.phone,
    email: member.email,
    status: member.status,
    branchId: member.branchId,
  };
}

export const memberAuthService = {
  async login(input: MemberLoginInput) {
    const member = await prisma.member.findFirst({
      where: {
        phone: input.phone,
        deletedAt: null,
        organization: { slug: input.organizationSlug },
      },
      include: { organization: true, branch: { select: { id: true, name: true } } },
    });

    if (!member || !member.passwordHash) {
      await verifyPassword(input.password, DUMMY_PASSWORD_HASH);
      throw new AppError(401, ErrorCode.INVALID_CREDENTIALS, "Invalid phone or password");
    }

    const ok = await verifyPassword(input.password, member.passwordHash);
    if (!ok) {
      throw new AppError(401, ErrorCode.INVALID_CREDENTIALS, "Invalid phone or password");
    }

    if (member.status !== "ACTIVE" || member.organization.status !== "ACTIVE") {
      throw new AppError(403, ErrorCode.ACCOUNT_INACTIVE, "This account is not active");
    }

    const session = await issueMemberSession(member, generateId());
    logger.info({ memberId: member.id, organizationId: member.organizationId }, "Member login succeeded");
    return {
      session,
      member: toProfile(member),
      organization: {
        id: member.organization.id,
        name: member.organization.name,
        slug: member.organization.slug,
      },
      branch: member.branch,
    };
  },

  async refresh(rawToken: string) {
    const stored = await prisma.memberRefreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { member: { include: { organization: true } } },
    });

    if (!stored) {
      throw new AppError(401, ErrorCode.INVALID_TOKEN, "Refresh token is invalid");
    }

    if (stored.revokedAt) {
      await revokeFamily(stored.familyId);
      throw new AppError(
        401,
        ErrorCode.TOKEN_REUSE_DETECTED,
        "Refresh token has already been used — all sessions for this login have been revoked",
      );
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new AppError(401, ErrorCode.TOKEN_EXPIRED, "Refresh token has expired");
    }

    if (
      stored.member.deletedAt ||
      stored.member.status !== "ACTIVE" ||
      stored.member.organization.status !== "ACTIVE"
    ) {
      await revokeFamily(stored.familyId);
      throw new AppError(403, ErrorCode.ACCOUNT_INACTIVE, "This account is not active");
    }

    const { count } = await prisma.memberRefreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) {
      await revokeFamily(stored.familyId);
      throw new AppError(
        401,
        ErrorCode.TOKEN_REUSE_DETECTED,
        "Refresh token has already been used — all sessions for this login have been revoked",
      );
    }

    const session = await issueMemberSession(stored.member, stored.familyId);
    return { session };
  },

  async logout(rawToken: string | undefined) {
    if (!rawToken) return;
    const stored = await prisma.memberRefreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      select: { familyId: true },
    });
    if (!stored) return;
    await revokeFamily(stored.familyId);
  },

  async me(auth: MemberAccessTokenPayload) {
    const member = await prisma.member.findFirst({
      where: { id: auth.memberId, organizationId: auth.organizationId, deletedAt: null },
      include: {
        organization: { select: { id: true, name: true, slug: true, timezone: true } },
        branch: { select: { id: true, name: true } },
      },
    });
    if (!member) {
      throw AppError.notFound(ErrorCode.MEMBER_NOT_FOUND, "Authenticated member no longer exists");
    }
    return {
      member: toProfile(member),
      organization: member.organization,
      branch: member.branch,
    };
  },

  /**
   * Member-initiated password change. Wrong current password is the same 401 as a failed
   * login (dummy bcrypt when the hash is missing). On success every live refresh family is
   * revoked and a new session is issued so this device stays signed in and others do not.
   */
  async changePassword(auth: MemberAccessTokenPayload, input: MemberChangePasswordInput) {
    const member = await prisma.member.findFirst({
      where: { id: auth.memberId, organizationId: auth.organizationId, deletedAt: null },
      include: { organization: { select: { status: true } } },
    });

    if (!member || !member.passwordHash) {
      await verifyPassword(input.currentPassword, DUMMY_PASSWORD_HASH);
      throw new AppError(401, ErrorCode.INVALID_CREDENTIALS, "Invalid phone or password");
    }

    const ok = await verifyPassword(input.currentPassword, member.passwordHash);
    if (!ok) {
      throw new AppError(401, ErrorCode.INVALID_CREDENTIALS, "Invalid phone or password");
    }

    if (member.status !== "ACTIVE" || member.organization.status !== "ACTIVE") {
      throw new AppError(403, ErrorCode.ACCOUNT_INACTIVE, "This account is not active");
    }

    const passwordHash = await hashPassword(input.newPassword);
    await prisma.$transaction([
      prisma.member.update({
        where: { id: member.id },
        data: { passwordHash },
      }),
      prisma.memberRefreshToken.updateMany({
        where: { memberId: member.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    const session = await issueMemberSession(member, generateId());
    logger.info({ memberId: member.id, organizationId: member.organizationId }, "Member password changed");
    return session;
  },
};
