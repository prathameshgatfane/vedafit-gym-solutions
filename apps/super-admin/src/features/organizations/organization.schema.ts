import { z } from "zod";

const ownerPasswordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(200)
  .regex(/[a-z]/, "Password must contain a lowercase letter")
  .regex(/[A-Z]/, "Password must contain an uppercase letter")
  .regex(/[0-9]/, "Password must contain a number");

/** Matches `platformCreateOrganizationSchema` — plan assignment, no client entitlements or prices. */
export const createOrganizationSchema = z
  .object({
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
    credentialMode: z.enum(["generate", "manual"]),
    ownerPassword: z.string(),
    ownerPasswordConfirm: z.string(),
    planId: z.string().trim().min(1, "Select a SaaS plan"),
    subscriptionStatus: z.enum(["TRIAL", "ACTIVE", "PAST_DUE", "CANCELLED"]),
    billingInterval: z.enum(["MONTHLY", "YEARLY"]),
    currentPeriodEnd: z.string(),
  })
  .superRefine((value, ctx) => {
    if (value.credentialMode !== "manual") return;
    const parsed = ownerPasswordSchema.safeParse(value.ownerPassword);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({ ...issue, path: ["ownerPassword"] });
      }
    }
    if (value.ownerPassword !== value.ownerPasswordConfirm) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Passwords do not match",
        path: ["ownerPasswordConfirm"],
      });
    }
  });

export type CreateOrganizationFormValues = z.infer<typeof createOrganizationSchema>;

export const subscriptionFormSchema = z
  .object({
    planId: z.string(),
    status: z.enum(["", "TRIAL", "ACTIVE", "PAST_DUE", "CANCELLED"]),
    billingInterval: z.enum(["", "MONTHLY", "YEARLY"]),
    currentPeriodEnd: z.string(),
  })
  .refine(
    (value) =>
      value.planId !== "" ||
      value.status !== "" ||
      value.billingInterval !== "" ||
      value.currentPeriodEnd.trim() !== "",
    {
      message: "Change at least one of plan, status, billing interval, or period end",
    },
  );

export type SubscriptionFormValues = z.infer<typeof subscriptionFormSchema>;
