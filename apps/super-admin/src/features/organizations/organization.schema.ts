import { z } from "zod";

/** Matches `platformSignupSchema` — no planId, status, or entitlement fields. */
export const createOrganizationSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(255),
  slug: z
    .string()
    .trim()
    .min(1, "Slug is required")
    .max(100)
    .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers, and hyphens only"),
  email: z.string().trim().email("Enter a valid email address"),
  phone: z.string().trim().max(30),
  timezone: z.string().trim().max(64),
  branchName: z.string().trim().max(255),
  ownerName: z.string().trim().min(1, "Owner name is required").max(255),
  ownerEmail: z.string().trim().email("Enter a valid owner email"),
  ownerPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(200)
    .regex(/[a-z]/, "Password must contain a lowercase letter")
    .regex(/[A-Z]/, "Password must contain an uppercase letter")
    .regex(/[0-9]/, "Password must contain a number"),
});

export type CreateOrganizationFormValues = z.infer<typeof createOrganizationSchema>;

export const subscriptionFormSchema = z
  .object({
    planId: z.string(),
    status: z.enum(["", "TRIAL", "ACTIVE", "PAST_DUE", "CANCELLED"]),
    currentPeriodEnd: z.string(),
  })
  .refine((value) => value.planId !== "" || value.status !== "" || value.currentPeriodEnd.trim() !== "", {
    message: "Change at least one of plan, status, or period end",
  });

export type SubscriptionFormValues = z.infer<typeof subscriptionFormSchema>;
