import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { requirePermission } from "../../middleware/permission.middleware";
import { validate } from "../../middleware/validation.middleware";
import { roleController } from "./role.controller";
import {
  createRoleSchema,
  listRolesQuerySchema,
  roleParamsSchema,
  updateRoleSchema,
} from "./role.schema";

// `authenticate` and `tenantScope` are already applied by the parent organizationRouter.
export const roleRouter = Router({ mergeParams: true });

/**
 * Editing roles is editing the permission system itself, so the whole module sits behind
 * `roles.manage` — OWNER only in the Section 4.2 matrix, deliberately not granted to ADMIN.
 */
roleRouter.use(requirePermission("roles.manage"));

roleRouter.post(
  "/",
  validate(roleParamsSchema, "params"),
  validate(createRoleSchema, "body"),
  asyncHandler(roleController.create),
);

roleRouter.get(
  "/",
  validate(roleParamsSchema, "params"),
  validate(listRolesQuerySchema, "query"),
  asyncHandler(roleController.list),
);

roleRouter.get(
  "/:roleId",
  validate(roleParamsSchema, "params"),
  asyncHandler(roleController.getById),
);

roleRouter.patch(
  "/:roleId",
  validate(roleParamsSchema, "params"),
  validate(updateRoleSchema, "body"),
  asyncHandler(roleController.update),
);
