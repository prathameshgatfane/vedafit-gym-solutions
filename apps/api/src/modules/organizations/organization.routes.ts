import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { validate } from "../../middleware/validation.middleware";
import { organizationController } from "./organization.controller";
import {
  createOrganizationSchema,
  listOrganizationsQuerySchema,
  organizationIdParamsSchema,
  updateOrganizationSchema,
} from "./organization.schema";
import { branchRouter } from "../branches/branch.routes";
import { userRouter } from "../users/user.routes";
import { roleRouter } from "../roles/role.routes";

export const organizationRouter = Router();

organizationRouter.post(
  "/",
  validate(createOrganizationSchema, "body"),
  asyncHandler(organizationController.create),
);

organizationRouter.get(
  "/",
  validate(listOrganizationsQuerySchema, "query"),
  asyncHandler(organizationController.list),
);

organizationRouter.get(
  "/:organizationId",
  validate(organizationIdParamsSchema, "params"),
  asyncHandler(organizationController.getById),
);

organizationRouter.patch(
  "/:organizationId",
  validate(organizationIdParamsSchema, "params"),
  validate(updateOrganizationSchema, "body"),
  asyncHandler(organizationController.update),
);

// Nested, org-scoped resources. No auth/tenant middleware yet (Phase 2) — organizationId comes
// straight from the URL for now; once tenant.middleware.ts exists it will validate this against
// the caller's JWT instead of trusting the URL outright.
organizationRouter.use("/:organizationId/branches", branchRouter);
organizationRouter.use("/:organizationId/users", userRouter);
organizationRouter.use("/:organizationId/roles", roleRouter);
