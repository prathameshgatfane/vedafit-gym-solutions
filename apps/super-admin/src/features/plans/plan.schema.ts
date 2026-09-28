import { z } from "zod";
import { isLimitEntitlementKey, SAAS_ENTITLEMENT_KEYS } from "./entitlement-catalog";

const entitlementKeySchema = z.enum(SAAS_ENTITLEMENT_KEYS as [string, ...string[]]);

export const planEntitlementFormSchema = z
  .object({
    key: entitlementKeySchema,
    valueType: z.enum(["BOOLEAN", "LIMIT", "UNLIMITED"]),
    intValue: z.string().optional(),
    boolValue: z.boolean().optional(),
  })
  .superRefine((row, ctx) => {
    if (isLimitEntitlementKey(row.key)) {
      if (row.valueType === "BOOLEAN") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Limit entitlements cannot be boolean",
          path: ["valueType"],
        });
        return;
      }
      if (row.valueType === "LIMIT") {
        if (!row.intValue || !/^\d+$/.test(row.intValue)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Enter a whole number, or choose Unlimited",
            path: ["intValue"],
          });
        }
      }
      return;
    }
    if (row.valueType !== "BOOLEAN") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Feature entitlements must be enabled or disabled",
        path: ["valueType"],
      });
    }
  });

export const planFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(255),
  code: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Code is required")
    .max(32)
    .regex(
      /^[a-z][a-z0-9-]*$/,
      "Use a letter first, then lowercase letters, numbers, or hyphens",
    ),
  description: z.string().trim().max(2000),
  priceMonthly: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Monthly price cannot be negative"),
  priceYearly: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Yearly price cannot be negative"),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code"),
  trialDays: z.coerce.number().int().nonnegative("Trial days cannot be negative"),
  entitlements: z
    .array(planEntitlementFormSchema)
    .refine(
      (rows) => new Set(rows.map((row) => row.key)).size === rows.length,
      { message: "Duplicate entitlement keys are not allowed" },
    )
    .refine(
      (rows) => SAAS_ENTITLEMENT_KEYS.every((key) => rows.some((row) => row.key === key)),
      { message: "Every catalog entitlement is required" },
    ),
});

export type PlanFormValues = z.infer<typeof planFormSchema>;
