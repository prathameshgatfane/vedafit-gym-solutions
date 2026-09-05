import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { validate } from "../../middleware/validation.middleware";
import { permissionController } from "./permission.controller";
import { listPermissionsQuerySchema, permissionIdParamsSchema } from "./permission.schema";

export const permissionRouter = Router();

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
