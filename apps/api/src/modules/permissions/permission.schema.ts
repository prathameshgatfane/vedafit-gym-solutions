import { z } from "zod";
import { createListQuerySchema } from "../../utils/pagination";

// Permissions are a seeded, developer-controlled system catalog (grows per phase, never shrinks
// per Section 4.1) — no create/update/delete endpoints, read-only API.
export const listPermissionsQuerySchema = createListQuerySchema(["key"]);

export const permissionIdParamsSchema = z.object({
  permissionId: z.string().trim().min(1),
});
