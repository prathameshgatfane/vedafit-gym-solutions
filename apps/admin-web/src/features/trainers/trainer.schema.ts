import { z } from "zod";

/**
 * Mirrors the create/update schemas in apps/api/src/modules/trainers/trainer.schema.ts.
 * Commission is a string here because it comes from a text input; empty means "no rate".
 */
const commissionField = z
  .string()
  .trim()
  .refine(
    (value) => value === "" || /^\d+(\.\d{1,2})?$/.test(value),
    "Enter a percentage with up to 2 decimals",
  )
  .refine((value) => value === "" || Number(value) <= 100, "Commission cannot exceed 100%")
  .refine((value) => value === "" || Number(value) >= 0, "Commission cannot be negative");

export const trainerFormSchema = z.object({
  userId: z.string().trim().min(1, "Pick a staff member"),
  specialization: z.string().trim().max(120, "Keep specialization under 120 characters"),
  commissionPct: commissionField,
});

export type TrainerFormValues = z.infer<typeof trainerFormSchema>;
