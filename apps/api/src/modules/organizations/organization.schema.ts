import { z } from "zod";
import { createListQuerySchema } from "../../utils/pagination";

export const organizationStatusSchema = z.enum(["ACTIVE", "SUSPENDED"]);

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(255),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase letters, numbers, and hyphens only"),
  email: z.string().trim().email(),
  phone: z.string().trim().min(1).max(30).optional(),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

/**
 * Tenant PATCH may change contact fields. `status` is platform-only (15.7
 * `PATCH /platform/organizations/:id/status`). `.strict()` so a gym OWNER cannot
 * smuggle `status: SUSPENDED` — extra keys are 400, not silently dropped.
 */
export const updateOrganizationSchema = createOrganizationSchema
  .omit({ slug: true })
  .partial()
  .strict();
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

export const organizationIdParamsSchema = z.object({
  organizationId: z.string().trim().min(1),
});

export const listOrganizationsQuerySchema = createListQuerySchema([
  "createdAt",
  "name",
  "slug",
]).extend({
  status: organizationStatusSchema.optional(),
});
