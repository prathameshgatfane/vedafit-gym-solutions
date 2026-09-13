import { env } from "../../config/env";
import { AppError } from "../../lib/app-error";
import { ErrorCode } from "../../lib/error-codes";
import { generateId } from "../../lib/id";
import { accessTokenTtlSeconds, signAccessToken } from "../../lib/jwt";
import { logger } from "../../lib/logger";
import { hashPassword, verifyPassword } from "../../lib/password";
import { prisma, withGeneratedId } from "../../lib/prisma";
import { generateOpaqueToken, hashToken } from "../../lib/tokens";
import type { AuthContext } from "../../middleware/auth.middleware";
import { getOrganizationSaasSnapshot, toGymAuthSaas } from "../saas/saas-entitlements.service";
import type { ForgotPasswordInput, LoginInput, ResetPasswordInput } from "./auth.schema";

/**
 * A bcrypt hash of a value nobody knows, compared against when no user matches the submitted
 * email. Without it, a failed lookup returns in ~0ms while a wrong password takes ~100ms, which
 * is enough to enumerate valid addresses.
 */
const DUMMY_PASSWORD_HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

export interface IssuedSession {
  accessToken: string;
  /** Raw refresh token — handed to the controller to be set as an httpOnly cookie and never logged. */
  refreshToken: string;
  expiresIn: number;
  refreshTokenExpiresAt: Date;
}

function refreshTokenExpiry(): Date {
  return new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Mints an access token plus a refresh token belonging to `familyId`. A fresh login starts a new
 * family; a rotation continues the existing one.
 */
async function issueSession(
  user: { id: string; organizationId: string; branchId: string | null; roleId: string },
  familyId: string,
): Promise<IssuedSession> {
  const accessToken = signAccessToken({
    userId: user.id,
    organizationId: user.organizationId,
    branchId: user.branchId,
    roleId: user.roleId,
  });

  const refreshToken = generateOpaqueToken();
  const expiresAt = refreshTokenExpiry();

  await prisma.refreshToken.create({
    data: withGeneratedId({
      userId: user.id,
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

/** Revokes every still-live token in a rotation chain. Used on reuse detection and on logout. */
async function revokeFamily(familyId: string): Promise<number> {
  const { count } = await prisma.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count;
}

export const authService = {
  async login(input: LoginInput) {
    // `email` is unique per organization, not globally (Locked Decision 1.3), so a bare email can
    // legitimately match users in several orgs.
    const candidates = await prisma.user.findMany({
      where: {
        email: input.email,
        deletedAt: null,
        organization: input.organizationSlug ? { slug: input.organizationSlug } : undefined,
      },
      include: { organization: true },
    });

    if (candidates.length === 0) {
      await verifyPassword(input.password, DUMMY_PASSWORD_HASH);
      throw new AppError(401, ErrorCode.INVALID_CREDENTIALS, "Invalid email or password");
    }

    const matches: typeof candidates = [];
    for (const candidate of candidates) {
      if (await verifyPassword(input.password, candidate.passwordHash)) {
        matches.push(candidate);
      }
    }

    if (matches.length === 0) {
      throw new AppError(401, ErrorCode.INVALID_CREDENTIALS, "Invalid email or password");
    }

    if (matches.length > 1) {
      throw new AppError(
        409,
        ErrorCode.AMBIGUOUS_LOGIN,
        "This email belongs to more than one organization — retry with an organizationSlug",
        { organizationSlugs: matches.map((m) => m.organization.slug) },
      );
    }

    const user = matches[0]!;

    // Deliberately checked after the password: an attacker shouldn't be able to tell a
    // deactivated account from a wrong password.
    if (user.status !== "ACTIVE") {
      throw new AppError(403, ErrorCode.ACCOUNT_INACTIVE, "This account is not active");
    }
    if (user.organization.status !== "ACTIVE") {
      throw new AppError(403, ErrorCode.ACCOUNT_INACTIVE, "This organization is suspended");
    }

    const session = await issueSession(user, generateId());
    logger.info({ userId: user.id, organizationId: user.organizationId }, "Login succeeded");
    return { session, user };
  },

  /**
   * Rotate-on-use with family-wide reuse detection.
   *
   * Every successful refresh revokes the presented token and issues a replacement in the same
   * family. So a token that is *already* revoked can only mean one of two things: it was rotated
   * before (and someone kept a copy), or the session was logged out. Either way it's evidence
   * that a token leaked, and the safe response is to kill the whole chain — including the
   * currently-valid token the legitimate user is holding — and force a fresh login.
   */
  async refresh(rawToken: string) {
    const tokenHash = hashToken(rawToken);

    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { include: { organization: true } } },
    });

    if (!stored) {
      throw new AppError(401, ErrorCode.INVALID_TOKEN, "Refresh token is invalid");
    }

    if (stored.revokedAt) {
      const revokedCount = await revokeFamily(stored.familyId);
      logger.warn(
        { userId: stored.userId, familyId: stored.familyId, revokedCount },
        "Refresh token reuse detected — entire token family revoked",
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

    if (stored.user.deletedAt || stored.user.status !== "ACTIVE") {
      await revokeFamily(stored.familyId);
      throw new AppError(403, ErrorCode.ACCOUNT_INACTIVE, "This account is not active");
    }

    // Phase 15.7 / 10.21.7: login already refuses a SUSPENDED org; refresh must too so a
    // pre-suspend session cannot mint a new access JWT after Super Admin flips the switch.
    // Access tokens issued before suspend remain valid until TTL (10.13) — this check is
    // refresh-only, not authenticate().
    if (stored.user.organization.status !== "ACTIVE") {
      await revokeFamily(stored.familyId);
      throw new AppError(403, ErrorCode.ACCOUNT_INACTIVE, "This organization is suspended");
    }

    // Conditional update: `revokedAt: null` in the WHERE clause means two concurrent refreshes
    // with the same token can't both win — the loser sees count 0 and is treated as a replay.
    const { count } = await prisma.refreshToken.updateMany({
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

    const session = await issueSession(stored.user, stored.familyId);
    return { session, user: stored.user };
  },

  /** Idempotent: an unknown or already-revoked token still reports success, since the caller's
   * intent (end this session) is satisfied either way. */
  async logout(rawToken: string | undefined) {
    if (!rawToken) return;

    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      select: { familyId: true },
    });
    if (!stored) return;

    await revokeFamily(stored.familyId);
  },

  async me(auth: AuthContext) {
    const user = await prisma.user.findFirst({
      where: { id: auth.userId, organizationId: auth.organizationId, deletedAt: null },
      include: {
        organization: true,
        role: { include: { permissions: { include: { permission: true } } } },
      },
    });

    if (!user) {
      throw AppError.notFound(ErrorCode.USER_NOT_FOUND, "Authenticated user no longer exists");
    }

    // A branch-scoped user sees only their own branch; org-wide roles see every active branch.
    const branches = await prisma.branch.findMany({
      where: {
        organizationId: auth.organizationId,
        status: "ACTIVE",
        id: auth.branchId ?? undefined,
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, address: true, phone: true, status: true },
    });

    // JWT organizationId only (10.12). Missing subscription → null; do not invent a plan.
    const saas = toGymAuthSaas(await getOrganizationSaasSnapshot(auth.organizationId));

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        status: user.status,
        branchId: user.branchId,
        role: {
          id: user.role.id,
          name: user.role.name,
          permissions: user.role.permissions.map((rp) => rp.permission.key).sort(),
        },
      },
      organization: {
        id: user.organization.id,
        name: user.organization.name,
        slug: user.organization.slug,
        email: user.organization.email,
        phone: user.organization.phone,
        status: user.organization.status,
        // Added in Phase 7. The browser's timezone is not the gym's, so an admin travelling — or
        // simply a machine with the wrong clock zone — would otherwise read the attendance
        // register in the wrong day's terms (1.17.4).
        timezone: user.organization.timezone,
      },
      branches,
      saas,
    };
  },

  /**
   * Always reports success, whether or not the email exists — a differing response is a free
   * account-enumeration oracle.
   *
   * Returns the raw token so the controller can expose it outside production. There's no mail
   * transport until Phase 12, and a reset flow that can't be exercised end-to-end is a reset flow
   * nobody finds out is broken.
   */
  async forgotPassword(input: ForgotPasswordInput): Promise<{ resetToken?: string }> {
    const users = await prisma.user.findMany({
      where: { email: input.email, deletedAt: null, status: "ACTIVE" },
    });

    if (users.length !== 1) {
      logger.info(
        { email: input.email, matches: users.length },
        "Password reset requested for an email with no single active match — no-op",
      );
      return {};
    }

    const user = users[0]!;

    // One live reset link at a time: requesting a new one invalidates the previous.
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const resetToken = generateOpaqueToken();
    await prisma.passwordResetToken.create({
      data: withGeneratedId({
        userId: user.id,
        tokenHash: hashToken(resetToken),
        expiresAt: new Date(Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60 * 1000),
      }),
    });

    logger.info({ userId: user.id }, "Password reset token issued");
    return { resetToken };
  },

  async resetPassword(input: ResetPasswordInput) {
    const stored = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(input.token) },
    });

    if (!stored || stored.usedAt || stored.expiresAt.getTime() <= Date.now()) {
      throw new AppError(
        400,
        ErrorCode.INVALID_RESET_TOKEN,
        "This password reset link is invalid or has expired",
      );
    }

    const passwordHash = await hashPassword(input.password);

    await prisma.$transaction([
      prisma.user.update({ where: { id: stored.userId }, data: { passwordHash } }),
      prisma.passwordResetToken.update({
        where: { id: stored.id },
        data: { usedAt: new Date() },
      }),
      // Changing a password ends every existing session — otherwise a stolen refresh token
      // survives the very action taken to lock the attacker out.
      prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    logger.info({ userId: stored.userId }, "Password reset completed; all sessions revoked");
  },
};
