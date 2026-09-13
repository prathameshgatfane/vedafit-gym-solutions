import { z } from "zod";

export const reportParamsSchema = z.object({
  organizationId: z.string().trim().min(1),
});

/**
 * Dashboard query. `branchId` is only meaningful for org-wide staff; a branch-scoped caller's
 * branch comes from the JWT and a mismatch is rejected by `tenantScope` before this is parsed.
 *
 * `expiringWithinDays` overrides the 7-day default (Locked Decision 1.18.4), capped at 90 so a
 * `?expiringWithinDays=9999` cannot turn the widget into "every active member".
 */
export const dashboardQuerySchema = z.object({
  branchId: z.string().trim().min(1).optional(),
  expiringWithinDays: z.coerce.number().int().min(1).max(90).optional().default(7),
});
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

/** Gym-local `YYYY-MM`. Same shape `formatLocalMonth` serializes (1.21.4). */
const localMonthStringSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM");

export const profitLossQuerySchema = z.object({
  branchId: z.string().trim().min(1).optional(),
  from: localMonthStringSchema.optional(),
  to: localMonthStringSchema.optional(),
});
export type ProfitLossQuery = z.infer<typeof profitLossQuerySchema>;
