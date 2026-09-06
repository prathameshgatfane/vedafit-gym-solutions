/**
 * Central error code registry — see docs/architecture/DEVELOPMENT_PLAN.md Locked Decision 1.10.
 * Extended module-by-module as phases add features. No ad hoc inline string error codes anywhere
 * else in the codebase — always reference `ErrorCode.X` here.
 */
export const ErrorCode = {
  // Generic
  VALIDATION_ERROR: "VALIDATION_ERROR",
  NOT_FOUND: "NOT_FOUND",
  INTERNAL_ERROR: "INTERNAL_ERROR",

  // Organizations
  ORGANIZATION_NOT_FOUND: "ORGANIZATION_NOT_FOUND",
  DUPLICATE_ORGANIZATION_SLUG: "DUPLICATE_ORGANIZATION_SLUG",

  // Branches
  BRANCH_NOT_FOUND: "BRANCH_NOT_FOUND",

  // Roles / Permissions
  ROLE_NOT_FOUND: "ROLE_NOT_FOUND",
  DUPLICATE_ROLE_NAME: "DUPLICATE_ROLE_NAME",
  PERMISSION_NOT_FOUND: "PERMISSION_NOT_FOUND",

  // Users
  USER_NOT_FOUND: "USER_NOT_FOUND",
  DUPLICATE_EMAIL: "DUPLICATE_EMAIL",

  // Members (Phase 4)
  MEMBER_NOT_FOUND: "MEMBER_NOT_FOUND",
  DUPLICATE_PHONE: "DUPLICATE_PHONE",

  // Auth (Phase 2)
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  ORG_MISMATCH: "ORG_MISMATCH",
  BRANCH_MISMATCH: "BRANCH_MISMATCH",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  INVALID_TOKEN: "INVALID_TOKEN",
  /** A refresh token that was already rotated (or revoked) was presented again. */
  TOKEN_REUSE_DETECTED: "TOKEN_REUSE_DETECTED",
  ACCOUNT_INACTIVE: "ACCOUNT_INACTIVE",
  /** Same email exists in more than one org — the caller must say which one. */
  AMBIGUOUS_LOGIN: "AMBIGUOUS_LOGIN",
  INVALID_RESET_TOKEN: "INVALID_RESET_TOKEN",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
