import { z } from "zod";
import { createListQuerySchema } from "../../utils/pagination";

export const userStatusSchema = z.enum(["ACTIVE", "INACTIVE"]);

export const createUserSchema = z.object({
  name: z.string().trim().min(1).max(255),
  email: z.string().trim().email(),
  password: z.string().min(8).max(200),
  roleId: z.string().trim().min(1),
  branchId: z.string().trim().min(1).optional(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  email: z.string().trim().email().optional(),
  password: z.string().min(8).max(200).optional(),
  roleId: z.string().trim().min(1).optional(),
  branchId: z.string().trim().min(1).nullable().optional(),
  status: userStatusSchema.optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const userParamsSchema = z.object({
  organizationId: z.string().trim().min(1),
  userId: z.string().trim().min(1).optional(),
});

export const listUsersQuerySchema = createListQuerySchema([
  "createdAt",
  "name",
  "email",
]).extend({
  status: userStatusSchema.optional(),
});
