import { z } from "zod";
import { createListQuerySchema } from "../../utils/pagination";

export const membershipStatusSchema = z.enum(["ACTIVE", "EXPIRED", "FROZEN", "CANCELLED"]);

/**
 * A term boundary is a calendar date, not an instant — same reasoning (and same shape) as
 * `member.dateOfBirth`. See utils/dates.ts.
 */
const calendarDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Not a real date");

export const createMembershipSchema = z.object({
  memberId: z.string().trim().min(1, "Member is required"),
  planId: z.string().trim().min(1, "Plan is required"),
  /**
   * Optional, defaults to today. Backdating is allowed on purpose: gyms enter paper signups days
   * late, and refusing the real start date would just push staff into entering a wrong one.
   */
  startDate: calendarDateSchema.optional(),
});
export type CreateMembershipInput = z.infer<typeof createMembershipSchema>;

/**
 * Renewal defaults to the same plan. Passing a different `planId` is the *clean* way to change
 * plan — it takes effect at the term boundary, so nothing is forfeited (Locked Decision 1.15.3).
 */
export const renewMembershipSchema = z.object({
  planId: z.string().trim().min(1).optional(),
});
export type RenewMembershipInput = z.infer<typeof renewMembershipSchema>;

/**
 * Mid-term plan switch. Separate from renewal because it is destructive: the current term is
 * cancelled and its remaining days are forfeited (Locked Decision 1.15.4 — proration deferred).
 */
export const changePlanSchema = z.object({
  planId: z.string().trim().min(1, "Plan is required"),
});
export type ChangePlanInput = z.infer<typeof changePlanSchema>;

export const membershipParamsSchema = z.object({
  organizationId: z.string().trim().min(1),
  membershipId: z.string().trim().min(1).optional(),
});

export const listMembershipsQuerySchema = createListQuerySchema([
  "startDate",
  "endDate",
  "createdAt",
]).extend({
  status: membershipStatusSchema.optional(),
  memberId: z.string().trim().min(1).optional(),
  planId: z.string().trim().min(1).optional(),
  branchId: z.string().trim().min(1).optional(),
});
export type ListMembershipsQuery = z.infer<typeof listMembershipsQuerySchema>;
