import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { requirePermission } from "../../middleware/permission.middleware";
import { validate } from "../../middleware/validation.middleware";
import { membershipPlanController } from "./membership-plan.controller";
import {
  createMembershipPlanSchema,
  listMembershipPlansQuerySchema,
  membershipPlanParamsSchema,
  updateMembershipPlanSchema,
} from "./membership-plan.schema";

// `authenticate` and `tenantScope` are already applied by the parent organizationRouter.
export const membershipPlanRouter = Router({ mergeParams: true });

/**
 * Read and write are split: anyone who can sell a membership needs to read the catalog to pick a
 * plan (a RECEPTIONIST holds `membership-plans.view`), but only managers and up can change what
 * the gym charges.
 *
 * There is deliberately no DELETE. A plan is referenced by every membership ever sold from it, so
 * removing the row would either orphan that history or be blocked by the foreign key; retiring a
 * plan is `PATCH { status: "INACTIVE" }`, which stops new sales and leaves history intact.
 */
membershipPlanRouter.post(
  "/",
  requirePermission("membership-plans.manage"),
  validate(membershipPlanParamsSchema, "params"),
  validate(createMembershipPlanSchema, "body"),
  asyncHandler(membershipPlanController.create),
);

membershipPlanRouter.get(
  "/",
  requirePermission("membership-plans.view"),
  validate(membershipPlanParamsSchema, "params"),
  validate(listMembershipPlansQuerySchema, "query"),
  asyncHandler(membershipPlanController.list),
);

membershipPlanRouter.get(
  "/:planId",
  requirePermission("membership-plans.view"),
  validate(membershipPlanParamsSchema, "params"),
  asyncHandler(membershipPlanController.getById),
);

membershipPlanRouter.patch(
  "/:planId",
  requirePermission("membership-plans.manage"),
  validate(membershipPlanParamsSchema, "params"),
  validate(updateMembershipPlanSchema, "body"),
  asyncHandler(membershipPlanController.update),
);
