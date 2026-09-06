import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { authenticate } from "../../middleware/auth.middleware";
import { validate } from "../../middleware/validation.middleware";
import { permissionController } from "./permission.controller";
import { listPermissionsQuerySchema, permissionIdParamsSchema } from "./permission.schema";

export const permissionRouter = Router();

/**
 * The permission catalog is global, not tenant data — the same keys exist for every org — so this
 * router needs `authenticate` but no `tenantScope`. Any signed-in user may read it; the admin UI
 * needs the list to render the role editor.
 */
permissionRouter.use(authenticate);

permissionRouter.get(
  "/",
  validate(listPermissionsQuerySchema, "query"),
  asyncHandler(permissionController.list),
);

permissionRouter.get(
  "/:permissionId",
  validate(permissionIdParamsSchema, "params"),
  asyncHandler(permissionController.getById),
);
