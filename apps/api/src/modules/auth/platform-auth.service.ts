import { env } from "../../config/env";
import { AppError } from "../../lib/app-error";
import { ErrorCode } from "../../lib/error-codes";
import { generateId } from "../../lib/id";
import { accessTokenTtlSeconds, signPlatformAccessToken } from "../../lib/jwt";
import { logger } from "../../lib/logger";
import { verifyPassword } from "../../lib/password";
import { prisma, withGeneratedId } from "../../lib/prisma";
import { generateOpaqueToken, hashToken } from "../../lib/tokens";
import type { PlatformAccessTokenPayload } from "../../lib/jwt";
import type { PlatformLoginInput } from "./auth.schema";

const DUMMY_PASSWORD_HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

export interface IssuedPlatformSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshTokenExpiresAt: Date;
}

function refreshTokenExpiry(): Date {
  return new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

async function issuePlatformSession(
  user: { id: string },
  familyId: string,
): Promise<IssuedPlatformSession> {
  const accessToken = signPlatformAccessToken({ platformUserId: user.id });
  const refreshToken = generateOpaqueToken();
  const expiresAt = refreshTokenExpiry();

  await prisma.platformRefreshToken.create({
    data: withGeneratedId({
      platformUserId: user.id,
      familyId,
      tokenHash: hashToken(refreshToken),
      expiresAt,
    }),
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: accessTokenTtlSeconds(),
    refreshTokenExpiresAt: expiresAt,
  };
}

async function revokeFamily(familyId: string): Promise<number> {
  const { count } = await prisma.platformRefreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count;
}

function toPublicUser(user: { id: string; name: string; email: string; status: string }) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    status: user.status,
  };
}

export const platformAuthService = {
  async login(input: PlatformLoginInput) {
    const user = await prisma.platformUser.findUnique({
      where: { email: input.email },
    });

    if (!user) {
      await verifyPassword(input.password, DUMMY_PASSWORD_HASH);
      logger.info({ email: input.email }, "Platform login failed (unknown email)");
      throw new AppError(401, ErrorCode.INVALID_CREDENTIALS, "Invalid email or password");
    }

    const ok = await verifyPassword(input.password, user.passwordHash);
    if (!ok) {
      logger.info({ platformUserId: user.id }, "Platform login failed (bad password)");
      throw new AppError(401, ErrorCode.INVALID_CREDENTIALS, "Invalid email or password");
    }

    if (user.status !== "ACTIVE") {
      throw new AppError(403, ErrorCode.ACCOUNT_INACTIVE, "This account is not active");
    }

    const session = await issuePlatformSession(user, generateId());
    logger.info({ platformUserId: user.id }, "Platform login succeeded");
    return { session, user: toPublicUser(user) };
  },

  async refresh(rawToken: string) {
    const stored = await prisma.platformRefreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { platformUser: true },
    });

    if (!stored) {
      throw new AppError(401, ErrorCode.INVALID_TOKEN, "Refresh token is invalid");
    }

    if (stored.revokedAt) {
      const revokedCount = await revokeFamily(stored.familyId);
      logger.warn(
        { platformUserId: stored.platformUserId, familyId: stored.familyId, revokedCount },
        "Platform refresh token reuse detected — entire token family revoked",
      );
      throw new AppError(
        401,
        ErrorCode.TOKEN_REUSE_DETECTED,
        "Refresh token has already been used — all sessions for this login have been revoked",
      );
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new AppError(401, ErrorCode.TOKEN_EXPIRED, "Refresh token has expired");
    }

    if (stored.platformUser.status !== "ACTIVE") {
      await revokeFamily(stored.familyId);
      throw new AppError(403, ErrorCode.ACCOUNT_INACTIVE, "This account is not active");
    }

    const { count } = await prisma.platformRefreshToken.updateMany({
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

    const session = await issuePlatformSession(stored.platformUser, stored.familyId);
    return { session, user: toPublicUser(stored.platformUser) };
  },

  async logout(rawToken: string | undefined) {
    if (!rawToken) return;
    const stored = await prisma.platformRefreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      select: { familyId: true, platformUserId: true },
    });
    if (!stored) return;
    await revokeFamily(stored.familyId);
    logger.info({ platformUserId: stored.platformUserId }, "Platform logout — token family revoked");
  },

  async me(auth: PlatformAccessTokenPayload) {
    const user = await prisma.platformUser.findUnique({
      where: { id: auth.platformUserId },
    });
    if (!user || user.status !== "ACTIVE") {
      throw AppError.notFound(ErrorCode.USER_NOT_FOUND, "Authenticated platform user no longer exists");
    }
    return { user: toPublicUser(user) };
  },
};
