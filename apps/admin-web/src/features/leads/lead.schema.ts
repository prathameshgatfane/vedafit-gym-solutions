import { z } from "zod";

const phoneSchema = z
  .string()
  .trim()
  .min(7, "Phone number is too short")
  .max(20, "Phone number is too long")
  .regex(/^\+?[\d\s()-]+$/, "Phone number may only contain digits, spaces, +, -, and ()")
  .refine((value) => (value.match(/\d/g) ?? []).length >= 7, "Phone number needs at least 7 digits");

export const leadFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  phone: phoneSchema,
  source: z.string().trim().max(60),
  branchId: z.string(),
  assignedToUserId: z.string(),
  followUpAt: z.string(),
});

export type LeadFormValues = z.infer<typeof leadFormSchema>;

export const convertLeadSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: z.string().trim().min(1, "Last name is required").max(100),
  branchId: z.string().trim().min(1, "Pick a home branch"),
  email: z.string().trim(),
});

export type ConvertLeadValues = z.infer<typeof convertLeadSchema>;

/** Lead `name` is a CRM label; a member needs first + last (1.20.2). */
export function splitLeadName(name: string): { firstName: string; lastName: string } {
  const trimmed = name.trim();
  const space = trimmed.indexOf(" ");
  if (space === -1) return { firstName: trimmed || "Member", lastName: "Member" };
  const firstName = trimmed.slice(0, space).trim() || "Member";
  const lastName = trimmed.slice(space + 1).trim() || "Member";
  return { firstName, lastName };
}
