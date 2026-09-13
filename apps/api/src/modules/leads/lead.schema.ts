import { z } from "zod";
import { createListQuerySchema } from "../../utils/pagination";

export const leadStatusSchema = z.enum([
  "NEW",
  "CONTACTED",
  "TRIAL_SCHEDULED",
  "CONVERTED",
  "LOST",
]);
export type LeadStatus = z.infer<typeof leadStatusSchema>;

/** Pipeline statuses a PATCH is allowed to name. CONVERTED is convert-only (1.20.1). */
export const patchableLeadStatusSchema = z.enum([
  "NEW",
  "CONTACTED",
  "TRIAL_SCHEDULED",
  "LOST",
]);

const phoneSchema = z
  .string()
  .trim()
  .min(7, "Phone number is too short")
  .max(20, "Phone number is too long")
  .regex(/^\+?[\d\s()-]+$/, "Phone number may only contain digits, spaces, +, -, and ()")
  .refine((value) => (value.match(/\d/g) ?? []).length >= 7, "Phone number needs at least 7 digits");

const optionalIsoDatetime = z
  .union([
    z
      .string()
      .trim()
      .min(1)
      .refine((value) => !Number.isNaN(Date.parse(value)), "Not a real date and time"),
    z.literal(""),
    z.null(),
  ])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (value === "" || value === null) return null;
    return value;
  });

export const createLeadSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  phone: phoneSchema,
  source: z.string().trim().max(60).optional(),
  branchId: z.string().trim().min(1).optional(),
  assignedToUserId: z.string().trim().min(1).optional(),
  followUpAt: optionalIsoDatetime,
});
export type CreateLeadInput = z.infer<typeof createLeadSchema>;

export const updateLeadSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    phone: phoneSchema.optional(),
    source: z
      .union([z.string().trim().max(60), z.literal(""), z.null()])
      .optional()
      .transform((value) => (value === "" ? null : value)),
    branchId: z.union([z.string().trim().min(1), z.null()]).optional(),
    assignedToUserId: z.union([z.string().trim().min(1), z.null()]).optional(),
    followUpAt: optionalIsoDatetime,
    status: patchableLeadStatusSchema.optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "Provide at least one field to update",
  });
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

export const convertLeadSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: z.string().trim().min(1, "Last name is required").max(100),
  branchId: z.string().trim().min(1, "Branch is required"),
  email: z
    .union([z.string().trim().email("Enter a valid email address"), z.literal("")])
    .optional()
    .transform((value) => (value === "" || value === undefined ? undefined : value)),
  dateOfBirth: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .optional(),
});
export type ConvertLeadInput = z.infer<typeof convertLeadSchema>;

export const leadParamsSchema = z.object({
  organizationId: z.string().trim().min(1),
  leadId: z.string().trim().min(1).optional(),
});

export const listLeadsQuerySchema = createListQuerySchema([
  "createdAt",
  "followUpAt",
  "name",
]).extend({
  status: leadStatusSchema.optional(),
  branchId: z.string().trim().min(1).optional(),
  assignedToUserId: z.string().trim().min(1).optional(),
});
export type ListLeadsQuery = z.infer<typeof listLeadsQuerySchema>;
