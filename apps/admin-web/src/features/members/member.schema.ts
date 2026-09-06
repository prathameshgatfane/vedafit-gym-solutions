import { z } from "zod";

/**
 * Mirrors `createMemberSchema` in apps/api/src/modules/members/member.schema.ts, including the
 * deliberately permissive phone rule. The server revalidates everything — this exists so a typo
 * is caught at the field rather than as a round-trip error banner.
 */
export const memberFormSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: z.string().trim().min(1, "Last name is required").max(100),
  phone: z
    .string()
    .trim()
    .min(1, "Phone number is required")
    .max(20, "Phone number is too long")
    .regex(/^\+?[\d\s()-]+$/, "Only digits, spaces, +, -, and () are allowed")
    .refine(
      (value) => (value.match(/\d/g) ?? []).length >= 7,
      "Phone number needs at least 7 digits",
    ),
  // Empty string is the natural "left blank" for a text input; the API layer converts it to null.
  // Not `.default("")` — that would make Zod's input and output types diverge, which React Hook
  // Form's resolver typing can't reconcile. The form supplies "" as its default value instead.
  email: z.union([z.string().trim().email("Enter a valid email address"), z.literal("")]),
  dateOfBirth: z.union([
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
      .refine(
        (value) => new Date(`${value}T00:00:00Z`) <= new Date(),
        "Date of birth is in the future",
      ),
    z.literal(""),
  ]),
  branchId: z.string().min(1, "Select a branch"),
});

export type MemberFormValues = z.infer<typeof memberFormSchema>;
