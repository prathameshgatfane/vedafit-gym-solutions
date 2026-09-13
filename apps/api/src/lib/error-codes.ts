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

  // Membership plans (Phase 5)
  MEMBERSHIP_PLAN_NOT_FOUND: "MEMBERSHIP_PLAN_NOT_FOUND",
  DUPLICATE_PLAN_NAME: "DUPLICATE_PLAN_NAME",
  /** A retired plan can't be sold — reactivate it or pick another. */
  MEMBERSHIP_PLAN_INACTIVE: "MEMBERSHIP_PLAN_INACTIVE",

  // Memberships (Phase 5)
  MEMBERSHIP_NOT_FOUND: "MEMBERSHIP_NOT_FOUND",
  /** An edge outside the Locked Decision 1.15.1 transition matrix was attempted. */
  INVALID_MEMBERSHIP_TRANSITION: "INVALID_MEMBERSHIP_TRANSITION",
  /** One live membership per member (1.15.1) — renew or change plan instead of stacking. */
  MEMBERSHIP_OVERLAP: "MEMBERSHIP_OVERLAP",

  // Invoices (Phase 6)
  INVOICE_NOT_FOUND: "INVOICE_NOT_FOUND",
  /** A cancelled invoice is terminal — it takes no further payments (1.16.2). */
  INVOICE_NOT_PAYABLE: "INVOICE_NOT_PAYABLE",

  // Payments (Phase 6)
  PAYMENT_NOT_FOUND: "PAYMENT_NOT_FOUND",
  /** Overpayment is refused rather than credited forward or auto-refunded (1.16.2). */
  PAYMENT_EXCEEDS_INVOICE: "PAYMENT_EXCEEDS_INVOICE",
  /** Refunds against one payment are capped at what it collected (1.16.3). */
  REFUND_EXCEEDS_PAYMENT: "REFUND_EXCEEDS_PAYMENT",
  /** Reversing a reversal is a new payment, not a refund (1.16.3). */
  INVALID_REFUND_TARGET: "INVALID_REFUND_TARGET",

  // Attendance (Phase 7)
  ATTENDANCE_NOT_FOUND: "ATTENDANCE_NOT_FOUND",
  /**
   * No membership covers this member today. Not a refusal so much as a speed bump: 1.17.1 allows
   * the check-in, but only when the caller resubmits with an explicit `override`.
   */
  MEMBERSHIP_NOT_ACTIVE: "MEMBERSHIP_NOT_ACTIVE",
  /** Org-wide staff must say which branch a check-in happened at — it is never guessed (1.17.3). */
  BRANCH_REQUIRED: "BRANCH_REQUIRED",

  // Trainers (Phase 9)
  TRAINER_PROFILE_NOT_FOUND: "TRAINER_PROFILE_NOT_FOUND",
  /** The user already has a profile — 1:1 (1.19.3). */
  TRAINER_PROFILE_EXISTS: "TRAINER_PROFILE_EXISTS",
  /**
   * A profile can only be attached to a live user whose role holds `attendance.view` and not
   * `trainers.manage` (1.19.3).
   */
  USER_NOT_ELIGIBLE_TRAINER: "USER_NOT_ELIGIBLE_TRAINER",
  ASSIGNMENT_NOT_FOUND: "ASSIGNMENT_NOT_FOUND",

  // Leads (Phase 10)
  LEAD_NOT_FOUND: "LEAD_NOT_FOUND",
  /** An edge outside Locked Decision 1.20.1 was attempted. */
  INVALID_LEAD_TRANSITION: "INVALID_LEAD_TRANSITION",
  /** A second open lead with this phone already exists in the org (1.20.4). */
  DUPLICATE_OPEN_LEAD: "DUPLICATE_OPEN_LEAD",
  /** Converted leads are history — PATCH and a second convert are refused (1.20.2). */
  LEAD_CONVERTED: "LEAD_CONVERTED",
  /** Convert is refused from LOST; reopen to CONTACTED first (1.20.1). */
  LEAD_NOT_CONVERTIBLE: "LEAD_NOT_CONVERTIBLE",
  /** assignedToUserId must be a live user whose role holds leads.manage (1.20.3). */
  USER_NOT_ELIGIBLE_ASSIGNEE: "USER_NOT_ELIGIBLE_ASSIGNEE",

  // Expenses (Phase 11)
  EXPENSE_NOT_FOUND: "EXPENSE_NOT_FOUND",
  /** `from` is after `to`, or the window is longer than 24 months (1.21.4). */
  EXPENSE_RANGE_INVALID: "EXPENSE_RANGE_INVALID",

  // Notifications (Phase 12)
  NOTIFICATION_LOG_NOT_FOUND: "NOTIFICATION_LOG_NOT_FOUND",
  NOTIFICATION_TEMPLATE_NOT_FOUND: "NOTIFICATION_TEMPLATE_NOT_FOUND",

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

  // SaaS entitlements (Phase 15.6)
  /** A boolean plan flag is off (e.g. `leads` on the trial catalog). */
  FEATURE_DISABLED: "FEATURE_DISABLED",
  /** A LIMIT entitlement would be exceeded by this write (`COUNT + delta`). */
  PLAN_LIMIT_REACHED: "PLAN_LIMIT_REACHED",
  /** Platform assign-plan: `planId` is not a row in `saas_plans`. */
  SAAS_PLAN_NOT_FOUND: "SAAS_PLAN_NOT_FOUND",
  /** Org has no `organization_subscriptions` row (unexpected after 15.5 backfill). */
  ORGANIZATION_SUBSCRIPTION_NOT_FOUND: "ORGANIZATION_SUBSCRIPTION_NOT_FOUND",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
