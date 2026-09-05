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

  // Members (module lands Phase 4 — code reserved now since 1.3's dedup pattern is shared)
  MEMBER_NOT_FOUND: "MEMBER_NOT_FOUND",
  DUPLICATE_PHONE: "DUPLICATE_PHONE",

  // Auth (Phase 2 — reserved now so error-codes.ts doesn't need a breaking rename later)
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  ORG_MISMATCH: "ORG_MISMATCH",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
