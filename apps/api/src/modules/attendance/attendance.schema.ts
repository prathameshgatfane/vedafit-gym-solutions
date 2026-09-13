import { z } from "zod";
import { createListQuerySchema } from "../../utils/pagination";

export const attendanceOverrideReasonSchema = z.enum([
  "NO_MEMBERSHIP",
  "EXPIRED",
  "FROZEN",
  "CANCELLED",
  "NOT_STARTED",
]);

const calendarDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const markAttendanceSchema = z.object({
  memberId: z.string().trim().min(1, "Member is required"),
  /**
   * Only meaningful for org-wide staff. A branch-scoped caller's branch comes from their JWT and
   * a mismatched value here is rejected rather than ignored (Locked Decision 1.17.3).
   */
  branchId: z.string().trim().min(1).optional(),
  /**
   * Locked Decision 1.17.1 — a check-in with no covering membership is refused once with
   * `MEMBERSHIP_NOT_ACTIVE` and recorded only when the caller says so on purpose. Defaulting this
   * to `true` would put the whole decision back in the UI's hands.
   */
  override: z.boolean().optional().default(false),
});
export type MarkAttendanceInput = z.infer<typeof markAttendanceSchema>;

export const attendanceParamsSchema = z.object({
  organizationId: z.string().trim().min(1),
  attendanceId: z.string().trim().min(1).optional(),
});

export const listAttendanceQuerySchema = createListQuerySchema([
  "checkedInAt",
  "attendanceDate",
]).extend({
  memberId: z.string().trim().min(1).optional(),
  branchId: z.string().trim().min(1).optional(),
  /** Inclusive calendar-day range. `date` is the shorthand the daily register uses. */
  date: calendarDate.optional(),
  dateFrom: calendarDate.optional(),
  dateTo: calendarDate.optional(),
  /** `true` narrows to visits recorded outside a valid membership (1.17.1). */
  overridesOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});
export type ListAttendanceQuery = z.infer<typeof listAttendanceQuerySchema>;
