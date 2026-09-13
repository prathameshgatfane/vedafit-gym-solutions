import { z } from "zod";
import { createListQuerySchema } from "../../utils/pagination";

export const membershipPlanStatusSchema = z.enum(["ACTIVE", "INACTIVE"]);

/**
 * Money arrives as a JSON number but is stored as DECIMAL(10,2), so anything the column can't
 * hold exactly is rejected here rather than silently rounded by MySQL. Two decimal places, and
 * under the 10-digit precision the column allows.
 */
const priceSchema = z.coerce
  .number({ invalid_type_error: "Price must be a number" })
  .min(0, "Price cannot be negative")
  .max(99_999_999.99, "Price is too large")
  .refine((value) => Number.isFinite(value), "Price must be a number")
  .refine((value) => Math.round(value * 100) === value * 100, "Price can have at most 2 decimals");

/**
 * A plan's duration is what `endDate` is computed from on every sale (1.15.3), so a zero-day or
 * absurd plan would produce memberships that are broken on arrival. Capped at ~5 years.
 */
const durationDaysSchema = z.coerce
  .number({ invalid_type_error: "Duration must be a number" })
  .int("Duration must be a whole number of days")
  .min(1, "Duration must be at least 1 day")
  .max(1826, "Duration cannot exceed 5 years");

export const createMembershipPlanSchema = z.object({
  name: z.string().trim().min(1, "Plan name is required").max(100),
  price: priceSchema,
  durationDays: durationDaysSchema,
  status: membershipPlanStatusSchema.optional(),
});
export type CreateMembershipPlanInput = z.infer<typeof createMembershipPlanSchema>;

/**
 * `price` and `durationDays` are editable precisely because editing them must NOT reach already
 * issued memberships — that is the whole point of the `priceAtPurchase` snapshot (Section 3,
 * 1.15.3). New terms pick up the new numbers; existing ones never do.
 */
export const updateMembershipPlanSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    price: priceSchema.optional(),
    durationDays: durationDaysSchema.optional(),
    status: membershipPlanStatusSchema.optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "Provide at least one field to update",
  });
export type UpdateMembershipPlanInput = z.infer<typeof updateMembershipPlanSchema>;

export const membershipPlanParamsSchema = z.object({
  organizationId: z.string().trim().min(1),
  planId: z.string().trim().min(1).optional(),
});

export const listMembershipPlansQuerySchema = createListQuerySchema([
  "name",
  "price",
  "durationDays",
  "createdAt",
]).extend({
  status: membershipPlanStatusSchema.optional(),
});
export type ListMembershipPlansQuery = z.infer<typeof listMembershipPlansQuerySchema>;
