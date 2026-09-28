import { z } from "zod";
import { createListQuerySchema } from "../../utils/pagination";
import { strongPasswordSchema } from "../auth/auth.schema";

export const memberStatusSchema = z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]);

/**
 * Deliberately permissive: gyms take numbers in whatever shape the walk-in gives them
 * (`+91 98765 43210`, `098765-43210`), and rejecting a real customer's number at the form is a
 * worse failure than storing an unusual one. We only insist it contains enough digits to be a
 * phone number at all.
 *
 * Note this means duplicate detection is an exact-string match on the trimmed value — see
 * DEVELOPMENT_PLAN.md Section 9 on deferring E.164 normalization.
 */
const phoneSchema = z
  .string()
  .trim()
  .min(7, "Phone number is too short")
  .max(20, "Phone number is too long")
  .regex(/^\+?[\d\s()-]+$/, "Phone number may only contain digits, spaces, +, -, and ()")
  .refine((value) => (value.match(/\d/g) ?? []).length >= 7, "Phone number needs at least 7 digits");

/**
 * A date of birth is a calendar date, not an instant. Accepting only `YYYY-MM-DD` (and storing it
 * at UTC midnight) keeps it from drifting a day when it crosses a timezone boundary.
 */
const dateOfBirthSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Not a real date")
  .refine((value) => new Date(`${value}T00:00:00Z`) <= new Date(), "Date of birth is in the future");

/** Optional free-text that should become NULL, not "", when the user clears the field. */
const optionalEmail = z
  .union([z.string().trim().email("Enter a valid email address"), z.literal("")])
  .optional()
  .transform((value) => (value === "" || value === undefined ? undefined : value));

export const createMemberSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: z.string().trim().min(1, "Last name is required").max(100),
  phone: phoneSchema,
  email: optionalEmail,
  dateOfBirth: dateOfBirthSchema.optional(),
  branchId: z.string().trim().min(1, "Branch is required"),
});
export type CreateMemberInput = z.infer<typeof createMemberSchema>;

/**
 * `status` accepts ACTIVE/INACTIVE only. Archiving is its own endpoint with its own permission
 * (`members.archive`); allowing it through here would let anyone holding `members.update` —
 * a RECEPTIONIST, per the Section 4.2 matrix — archive members by the back door.
 */
export const updateMemberSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().min(1).max(100).optional(),
    phone: phoneSchema.optional(),
    email: z
      .union([z.string().trim().email("Enter a valid email address"), z.literal(""), z.null()])
      .optional()
      .transform((value) => (value === "" ? null : value)),
    dateOfBirth: z.union([dateOfBirthSchema, z.null()]).optional(),
    branchId: z.string().trim().min(1).optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "Provide at least one field to update",
  });
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

export const memberParamsSchema = z.object({
  organizationId: z.string().trim().min(1),
  memberId: z.string().trim().min(1).optional(),
});

export const listMembersQuerySchema = createListQuerySchema([
  "createdAt",
  "firstName",
  "lastName",
  "phone",
]).extend({
  status: memberStatusSchema.optional(),
  /**
   * Org-wide callers can narrow to one branch. A branch-scoped caller is pinned to their own
   * branch by the service regardless of what they send here, and `tenantScope` rejects them
   * outright for naming someone else's.
   */
  branchId: z.string().trim().min(1).optional(),
});
export type ListMembersQuery = z.infer<typeof listMembersQuerySchema>;

/**
 * Staff enable or reset of the member portal login (1.23.2). Omit `password` to have the API
 * generate a readable 10-character temporary password. The plaintext is returned once on this
 * POST and is never stored or logged.
 */
export const portalPasswordSchema = z
  .object({
    password: strongPasswordSchema.optional(),
  })
  .default({});
export type PortalPasswordInput = z.infer<typeof portalPasswordSchema>;
