import { z } from "zod";
import { strongPasswordSchema } from "../auth/auth.schema";
import {
  createOrganizationSchema,
  listOrganizationsQuerySchema,
  organizationStatusSchema,
} from "../organizations/organization.schema";
import { isSaasLimitEntitlementKey, SAAS_ENTITLEMENT_KEY_VALUES } from "../saas/saas-catalog";

/**
 * Public gym signup (Phase 15.4). Field set matches DEVELOPMENT_PLAN.md 10.4.
 * `.strict()` rejects organizationId, role, status, subscription, and other client-chosen
 * tenant internals — the server creates those via `provisionOrganization`.
 */
const ownerSignupSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    email: z.string().trim().toLowerCase().email("A valid email is required"),
    password: strongPasswordSchema,
  })
  .strict();

const ownerOperatorSchema = z
  .object({
    name: ownerSignupSchema.shape.name,
    email: ownerSignupSchema.shape.email,
    password: strongPasswordSchema.optional(),
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

export const saasBillingIntervalSchema = z.enum(["MONTHLY", "YEARLY"]);

/**
 * Super Admin create (Phase D/E). Public signup stays on `platformSignupSchema` (Trial only).
 * `planId` is required; prices and entitlements are not accepted. `generatePassword: true`
 * makes the server issue a temporary owner password; client passwords are ignored in that mode.
 */
export const platformCreateOrganizationSchema = z
  .object({
    name: platformSignupSchema.shape.name,
    slug: platformSignupSchema.shape.slug,
    email: platformSignupSchema.shape.email,
    phone: platformSignupSchema.shape.phone,
    timezone: platformSignupSchema.shape.timezone,
    branchName: platformSignupSchema.shape.branchName,
    owner: ownerOperatorSchema,
    planId: z.string().trim().min(1),
    subscriptionStatus: organizationSubscriptionStatusSchema.default("TRIAL"),
    billingInterval: saasBillingIntervalSchema.default("MONTHLY"),
    currentPeriodEnd: z.string().datetime().optional(),
    generatePassword: z.boolean().optional().default(false),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.generatePassword && !value.owner.password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Owner password is required when generatePassword is not true",
        path: ["owner", "password"],
      });
    }
  });
export type PlatformCreateOrganizationInput = z.infer<typeof platformCreateOrganizationSchema>;

/**
 * Super Admin assign-plan / subscription lifecycle (Phase F). Organization id is the
 * route param. `.strict()` rejects organizationId, price, entitlements, and other
 * client-chosen SaaS fields — catalog price and live plan entitlements stay server-owned.
 */
export const platformSubscriptionPatchSchema = z
  .object({
    planId: z.string().trim().min(1).optional(),
    status: organizationSubscriptionStatusSchema.optional(),
    billingInterval: saasBillingIntervalSchema.optional(),
    currentPeriodEnd: z.string().datetime().optional(),
  })
  .strict()
  .refine(
    (value) => value.planId || value.status || value.billingInterval || value.currentPeriodEnd,
    {
      message: "At least one of planId, status, billingInterval, or currentPeriodEnd is required",
    },
  );
export type PlatformSubscriptionPatchInput = z.infer<typeof platformSubscriptionPatchSchema>;

export const saasPlanIdParamsSchema = z.object({
  planId: z.string().trim().min(1),
});

export const saasPlanCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(32)
  .regex(/^[a-z][a-z0-9-]*$/, "Code must start with a letter and use lowercase letters, numbers, and hyphens");

export const saasMoneySchema = z
  .union([
    z.number().finite().nonnegative(),
    z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Price must be a non-negative amount"),
  ])
  .transform((value) => Number(value).toFixed(2));

export const saasPlanEntitlementInputSchema = z
  .object({
    key: z.enum(SAAS_ENTITLEMENT_KEY_VALUES),
    valueType: z.enum(["BOOLEAN", "LIMIT", "UNLIMITED"]),
    intValue: z.number().int().nonnegative().nullable().optional(),
    boolValue: z.boolean().nullable().optional(),
  })
  .strict()
  .superRefine((row, ctx) => {
    const limitKey = isSaasLimitEntitlementKey(row.key);
    if (limitKey) {
      if (row.valueType === "BOOLEAN") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Limit keys cannot be BOOLEAN",
          path: ["valueType"],
        });
        return;
      }
      if (row.valueType === "UNLIMITED") {
        if (row.intValue != null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Unlimited keys cannot have intValue",
            path: ["intValue"],
          });
        }
        if (row.boolValue != null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Unlimited keys cannot have boolValue",
            path: ["boolValue"],
          });
        }
        return;
      }
      if (row.intValue == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Limit keys require a non-negative intValue",
          path: ["intValue"],
        });
      }
      if (row.boolValue != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Limit keys cannot have boolValue",
          path: ["boolValue"],
        });
      }
      return;
    }

    if (row.valueType !== "BOOLEAN") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Feature keys must be BOOLEAN",
        path: ["valueType"],
      });
    }
    if (typeof row.boolValue !== "boolean") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Feature keys require boolValue",
        path: ["boolValue"],
      });
    }
    if (row.intValue != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Feature keys cannot have intValue",
        path: ["intValue"],
      });
    }
  });

function uniqueEntitlementKeys(rows: Array<{ key: string }>): boolean {
  return new Set(rows.map((row) => row.key)).size === rows.length;
}

const createEntitlementsSchema = z
  .array(saasPlanEntitlementInputSchema)
  .min(SAAS_ENTITLEMENT_KEY_VALUES.length)
  .refine(uniqueEntitlementKeys, { message: "Duplicate entitlement keys are not allowed" })
  .refine(
    (rows) => SAAS_ENTITLEMENT_KEY_VALUES.every((key) => rows.some((row) => row.key === key)),
    { message: "Every catalog entitlement key is required" },
  );

const patchEntitlementsSchema = z
  .array(saasPlanEntitlementInputSchema)
  .min(1)
  .refine(uniqueEntitlementKeys, { message: "Duplicate entitlement keys are not allowed" });

export const createSaasPlanSchema = z
  .object({
    code: saasPlanCodeSchema,
    name: z.string().trim().min(1).max(255),
    description: z.string().trim().max(2000).nullable().optional(),
    priceMonthly: saasMoneySchema,
    priceYearly: saasMoneySchema,
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code")
      .optional()
      .default("INR"),
    trialDays: z.number().int().nonnegative(),
    isActive: z.boolean().optional().default(true),
    entitlements: createEntitlementsSchema,
  })
  .strict();
export type CreateSaasPlanInput = z.infer<typeof createSaasPlanSchema>;

export const updateSaasPlanSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    priceMonthly: saasMoneySchema.optional(),
    priceYearly: saasMoneySchema.optional(),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code")
      .optional(),
    trialDays: z.number().int().nonnegative().optional(),
    entitlements: patchEntitlementsSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.description !== undefined ||
      value.priceMonthly !== undefined ||
      value.priceYearly !== undefined ||
      value.currency !== undefined ||
      value.trialDays !== undefined ||
      value.entitlements !== undefined,
    { message: "At least one plan field is required" },
  );
export type UpdateSaasPlanInput = z.infer<typeof updateSaasPlanSchema>;
