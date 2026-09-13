import { z } from "zod";

/**
 * Mirrors `createMembershipPlanSchema` in
 * apps/api/src/modules/membership-plans/membership-plan.schema.ts. The server revalidates
 * everything — this exists so a typo is caught at the field rather than as a round-trip banner.
 *
 * Price and duration are strings here because they come from text inputs; an empty input is `""`,
 * not `NaN`, and "please enter a price" is a better message than "expected number, got nan".
 */
export const planFormSchema = z.object({
  name: z.string().trim().min(1, "Plan name is required").max(100),
  price: z
    .string()
    .trim()
    .min(1, "Price is required")
    .refine((value) => /^\d+(\.\d{1,2})?$/.test(value), "Enter an amount with up to 2 decimals")
    .refine((value) => Number(value) <= 99_999_999.99, "Price is too large"),
  durationDays: z
    .string()
    .trim()
    .min(1, "Duration is required")
    .refine((value) => /^\d+$/.test(value), "Enter a whole number of days")
    .refine((value) => Number(value) >= 1, "Duration must be at least 1 day")
    .refine((value) => Number(value) <= 1826, "Duration cannot exceed 5 years"),
  status: z.enum(["ACTIVE", "INACTIVE"]),
});

export type PlanFormValues = z.infer<typeof planFormSchema>;
