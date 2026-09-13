import { z } from "zod";
import { createListQuerySchema } from "../../utils/pagination";

export const trainerParamsSchema = z.object({
  organizationId: z.string().trim().min(1),
  trainerId: z.string().trim().min(1).optional(),
  memberId: z.string().trim().min(1).optional(),
});

export const createTrainerProfileSchema = z.object({
  userId: z.string().trim().min(1),
  specialization: z.string().trim().max(120).optional(),
  commissionPct: z
    .number()
    .min(0, "Commission cannot be negative")
    .max(100, "Commission cannot exceed 100%")
    .refine((value) => Math.round(value * 100) === value * 100, "Commission can have at most 2 decimals")
    .optional(),
});
export type CreateTrainerProfileInput = z.infer<typeof createTrainerProfileSchema>;

export const updateTrainerProfileSchema = z.object({
  specialization: z.string().trim().max(120).nullable().optional(),
  commissionPct: z
    .number()
    .min(0, "Commission cannot be negative")
    .max(100, "Commission cannot exceed 100%")
    .refine((value) => Math.round(value * 100) === value * 100, "Commission can have at most 2 decimals")
    .nullable()
    .optional(),
});
export type UpdateTrainerProfileInput = z.infer<typeof updateTrainerProfileSchema>;

export const assignMemberSchema = z.object({
  memberId: z.string().trim().min(1),
});
export type AssignMemberInput = z.infer<typeof assignMemberSchema>;

export const listTrainersQuerySchema = createListQuerySchema(["createdAt", "name"]);
export type ListTrainersQuery = z.infer<typeof listTrainersQuerySchema>;
