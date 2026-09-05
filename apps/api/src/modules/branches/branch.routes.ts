import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { validate } from "../../middleware/validation.middleware";
import { branchController } from "./branch.controller";
import {
  branchParamsSchema,
  createBranchSchema,
  listBranchesQuerySchema,
  updateBranchSchema,
} from "./branch.schema";

// mergeParams: mounted at /organizations/:organizationId/branches — needs the parent's param.
export const branchRouter = Router({ mergeParams: true });

branchRouter.post(
  "/",
  validate(branchParamsSchema, "params"),
  validate(createBranchSchema, "body"),
  asyncHandler(branchController.create),
);

branchRouter.get(
  "/",
  validate(branchParamsSchema, "params"),
  validate(listBranchesQuerySchema, "query"),
  asyncHandler(branchController.list),
);

branchRouter.get(
  "/:branchId",
  validate(branchParamsSchema, "params"),
  asyncHandler(branchController.getById),
);

branchRouter.patch(
  "/:branchId",
  validate(branchParamsSchema, "params"),
  validate(updateBranchSchema, "body"),
  asyncHandler(branchController.update),
);
