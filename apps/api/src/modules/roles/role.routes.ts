import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { validate } from "../../middleware/validation.middleware";
import { roleController } from "./role.controller";
import {
  createRoleSchema,
  listRolesQuerySchema,
  roleParamsSchema,
  updateRoleSchema,
} from "./role.schema";

export const roleRouter = Router({ mergeParams: true });

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
