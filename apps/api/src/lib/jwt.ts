import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { AppError } from "./app-error";
import { ErrorCode } from "./error-codes";

/**
 * Everything the server needs to answer "who is calling, and on whose behalf" without a DB
 * round-trip. Per Section 6, `organizationId`/`branchId` are read from here and nowhere else —
 * never from the request body, query, or URL.
 */
export interface AccessTokenPayload {
  userId: string;
  organizationId: string;
  /** null for org-wide roles (OWNER/ADMIN/ACCOUNTANT); set for branch-scoped staff. */
  branchId: string | null;
  roleId: string;
}

/** Distinguishes our access tokens from any other JWT that happens to be signed with the same key. */
const TOKEN_TYPE = "access";

interface EncodedAccessToken extends AccessTokenPayload {
  type: typeof TOKEN_TYPE;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  const claims: EncodedAccessToken = { ...payload, type: TOKEN_TYPE };
  return jwt.sign(claims, env.JWT_SECRET, {
    // Cast: @types/jsonwebtoken narrows this to a template-literal duration type, which an
    // env-provided string can't satisfy statically. The value is validated at runtime by
    // jsonwebtoken itself (it throws on an unparseable duration at signing time).
    expiresIn: env.JWT_ACCESS_TTL as jwt.SignOptions["expiresIn"],
  });
}

/**
 * Verifies signature + expiry and returns the claims. Throws `AppError` (401) rather than
 * jsonwebtoken's own error types so the caller never has to know which JWT library is in use.
 */
export function verifyAccessToken(token: string): AccessTokenPayload {
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, env.JWT_SECRET);
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError(401, ErrorCode.TOKEN_EXPIRED, "Access token has expired");
    }
    throw new AppError(401, ErrorCode.INVALID_TOKEN, "Access token is invalid");
  }

  if (
    typeof decoded !== "object" ||
    decoded === null ||
    (decoded as EncodedAccessToken).type !== TOKEN_TYPE
  ) {
    throw new AppError(401, ErrorCode.INVALID_TOKEN, "Access token is invalid");
  }

  const claims = decoded as EncodedAccessToken;
  if (!claims.userId || !claims.organizationId || !claims.roleId) {
    throw new AppError(401, ErrorCode.INVALID_TOKEN, "Access token is missing required claims");
  }

  return {
    userId: claims.userId,
    organizationId: claims.organizationId,
    branchId: claims.branchId ?? null,
    roleId: claims.roleId,
  };
}

/** Member-portal access token (1.23.2). A different `type` so a staff JWT cannot call /me. */
export interface MemberAccessTokenPayload {
  memberId: string;
  organizationId: string;
}

const MEMBER_TOKEN_TYPE = "member_access";

interface EncodedMemberAccessToken extends MemberAccessTokenPayload {
  type: typeof MEMBER_TOKEN_TYPE;
}

export function signMemberAccessToken(payload: MemberAccessTokenPayload): string {
  const claims: EncodedMemberAccessToken = { ...payload, type: MEMBER_TOKEN_TYPE };
  return jwt.sign(claims, env.JWT_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL as jwt.SignOptions["expiresIn"],
  });
}

export function verifyMemberAccessToken(token: string): MemberAccessTokenPayload {
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, env.JWT_SECRET);
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError(401, ErrorCode.TOKEN_EXPIRED, "Access token has expired");
    }
    throw new AppError(401, ErrorCode.INVALID_TOKEN, "Access token is invalid");
  }

  if (
    typeof decoded !== "object" ||
    decoded === null ||
    (decoded as EncodedMemberAccessToken).type !== MEMBER_TOKEN_TYPE
  ) {
    throw new AppError(401, ErrorCode.INVALID_TOKEN, "Access token is invalid");
  }

  const claims = decoded as EncodedMemberAccessToken;
  if (!claims.memberId || !claims.organizationId) {
    throw new AppError(401, ErrorCode.INVALID_TOKEN, "Access token is missing required claims");
  }

  return { memberId: claims.memberId, organizationId: claims.organizationId };
}

/** Platform operator access token (1.24.1). No organizationId — Super Admin is not tenant-scoped. */
export interface PlatformAccessTokenPayload {
  platformUserId: string;
}

const PLATFORM_TOKEN_TYPE = "platform_access";

interface EncodedPlatformAccessToken extends PlatformAccessTokenPayload {
  type: typeof PLATFORM_TOKEN_TYPE;
}

export function signPlatformAccessToken(payload: PlatformAccessTokenPayload): string {
  const claims: EncodedPlatformAccessToken = { ...payload, type: PLATFORM_TOKEN_TYPE };
  return jwt.sign(claims, env.JWT_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL as jwt.SignOptions["expiresIn"],
  });
}

export function verifyPlatformAccessToken(token: string): PlatformAccessTokenPayload {
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, env.JWT_SECRET);
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError(401, ErrorCode.TOKEN_EXPIRED, "Access token has expired");
    }
    throw new AppError(401, ErrorCode.INVALID_TOKEN, "Access token is invalid");
  }

  if (
    typeof decoded !== "object" ||
    decoded === null ||
    (decoded as EncodedPlatformAccessToken).type !== PLATFORM_TOKEN_TYPE
  ) {
    throw new AppError(401, ErrorCode.INVALID_TOKEN, "Access token is invalid");
  }

  const claims = decoded as EncodedPlatformAccessToken;
  if (!claims.platformUserId) {
    throw new AppError(401, ErrorCode.INVALID_TOKEN, "Access token is missing required claims");
  }

  return { platformUserId: claims.platformUserId };
}

/** Access-token lifetime in seconds, for the `expiresIn` field of the login/refresh response. */
export function accessTokenTtlSeconds(): number {
  const probe = jwt.decode(signAccessToken({
    userId: "probe",
    organizationId: "probe",
    branchId: null,
    roleId: "probe",
  })) as { iat: number; exp: number };
  return probe.exp - probe.iat;
}
