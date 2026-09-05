import { z } from "zod";
import { createListQuerySchema } from "../../utils/pagination";

export const createRoleSchema = z.object({
  name: z.string().trim().min(1).max(100),
  permissionKeys: z.array(z.string().trim().min(1)).default([]),
});
export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  // Omit entirely to leave permissions untouched; pass [] to clear all.
  permissionKeys: z.array(z.string().trim().min(1)).optional(),
});
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

export const roleParamsSchema = z.object({
  organizationId: z.string().trim().min(1),
  roleId: z.string().trim().min(1).optional(),
});

export const listRolesQuerySchema = createListQuerySchema(["createdAt", "name"]);
