import { z } from "zod";
import { createListQuerySchema } from "../../utils/pagination";

export const branchStatusSchema = z.enum(["ACTIVE", "INACTIVE"]);

export const createBranchSchema = z.object({
  name: z.string().trim().min(1).max(255),
  address: z.string().trim().min(1).max(500).optional(),
  phone: z.string().trim().min(1).max(30).optional(),
});
export type CreateBranchInput = z.infer<typeof createBranchSchema>;

export const updateBranchSchema = createBranchSchema.partial().extend({
  status: branchStatusSchema.optional(),
});
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;

export const branchParamsSchema = z.object({
  organizationId: z.string().trim().min(1),
  branchId: z.string().trim().min(1).optional(),
});

export const listBranchesQuerySchema = createListQuerySchema(["createdAt", "name"]).extend({
  status: branchStatusSchema.optional(),
});
