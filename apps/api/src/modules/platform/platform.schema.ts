import { z } from "zod";
import {
  createOrganizationSchema,
  listOrganizationsQuerySchema,
  organizationStatusSchema,
} from "../organizations/organization.schema";

/**
 * Public gym signup (Phase 15.4). Field set matches DEVELOPMENT_PLAN.md 10.4.
 * `.strict()` rejects organizationId, role, status, subscription, and other client-chosen
 * tenant internals — the server creates those via `provisionOrganization`.
 */
const ownerSignupSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    email: z.string().trim().toLowerCase().email("A valid email is required"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(200)
      .regex(/[a-z]/, "Password must contain a lowercase letter")
      .regex(/[A-Z]/, "Password must contain an uppercase letter")
      .regex(/[0-9]/, "Password must contain a number"),
  })
  .strict();

export const platformSignupSchema = z
  .object({
    name: createOrganizationSchema.shape.name,
    slug: createOrganizationSchema.shape.slug,
    email: createOrganizationSchema.shape.email,
    phone: createOrganizationSchema.shape.phone,
    timezone: z.string().trim().min(1).max(64).optional(),
    branchName: z.string().trim().min(1).max(255).optional(),
    owner: ownerSignupSchema,
  })
  .strict();

export type PlatformSignupInput = z.infer<typeof platformSignupSchema>;

/**
 * Super Admin suspend/restore (Phase 15.7 / 10.7). `.strict()` rejects planId, subscriptionId,
 * organizationId, and other client-chosen SaaS fields — this route only flips org status.
 */
export const platformOrganizationStatusSchema = z
  .object({
    status: organizationStatusSchema,
  })
  .strict();
export type PlatformOrganizationStatusInput = z.infer<typeof platformOrganizationStatusSchema>;

/** 1.9 list params for GET /platform/organizations. `status` is OrganizationStatus only. */
export const platformOrganizationListQuerySchema = listOrganizationsQuerySchema;
export type PlatformOrganizationListQuery = z.infer<typeof platformOrganizationListQuerySchema>;

export const organizationSubscriptionStatusSchema = z.enum([
  "TRIAL",
  "ACTIVE",
  "PAST_DUE",
  "CANCELLED",
]);

/**
 * Super Admin assign-plan / subscription lifecycle (15.8 / 10.7). Does not accept
 * organizationId, entitlement values, or Organization.status.
 */
export const platformSubscriptionPatchSchema = z
  .object({
    planId: z.string().trim().min(1).optional(),
    status: organizationSubscriptionStatusSchema.optional(),
    currentPeriodEnd: z.string().datetime().optional(),
  })
  .strict()
  .refine((value) => value.planId || value.status || value.currentPeriodEnd, {
    message: "At least one of planId, status, or currentPeriodEnd is required",
  });
export type PlatformSubscriptionPatchInput = z.infer<typeof platformSubscriptionPatchSchema>;
