import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { requirePermission } from "../../middleware/permission.middleware";
import { tenantScope } from "../../middleware/tenant.middleware";
import { validate } from "../../middleware/validation.middleware";
import { branchController } from "./branch.controller";
import {
  branchParamsSchema,
  createBranchSchema,
  listBranchesQuerySchema,
  updateBranchSchema,
} from "./branch.schema";

// mergeParams: mounted at /organizations/:organizationId/branches — needs the parent's param.
// `authenticate` and `tenantScope` are already applied by the parent organizationRouter.
export const branchRouter = Router({ mergeParams: true });

/**
 * Re-run the tenant guard once `:branchId` is actually parsed. The parent router mounts
 * `tenantScope` at `/:organizationId`, and at that depth Express has only populated
 * `organizationId` — a `:branchId` further down the path is still invisible, so a branch-scoped
 * user reaching for a sibling branch would slip through. Running it again here closes that.
 */
branchRouter.use("/:branchId", tenantScope);

branchRouter.post(
  "/",
  requirePermission("branches.manage"),
  validate(branchParamsSchema, "params"),
  validate(createBranchSchema, "body"),
  asyncHandler(branchController.create),
);

// Readable by any authenticated member of the org — every role needs to know which branches
// exist to make sense of the rest of the UI.
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
  requirePermission("branches.manage"),
  validate(branchParamsSchema, "params"),
  validate(updateBranchSchema, "body"),
  asyncHandler(branchController.update),
);
