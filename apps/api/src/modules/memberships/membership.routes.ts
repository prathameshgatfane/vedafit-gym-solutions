import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import {
  requireAllPermissions,
  requirePermission,
} from "../../middleware/permission.middleware";
import { validate } from "../../middleware/validation.middleware";
import { membershipController } from "./membership.controller";
import {
  changePlanSchema,
  createMembershipSchema,
  listMembershipsQuerySchema,
  membershipParamsSchema,
  renewMembershipSchema,
} from "./membership.schema";

// `authenticate` and `tenantScope` are already applied by the parent organizationRouter.
export const membershipRouter = Router({ mergeParams: true });

/**
 * Every lifecycle action is a POST to a named sub-resource rather than a `PATCH { status }`.
 * The transitions in Locked Decision 1.15.1 are not interchangeable status writes — freezing
 * records a timestamp, unfreezing moves `endDate`, renewing inserts a row — so naming the verb
 * keeps the permission split honest (a RECEPTIONIST may renew but not freeze or cancel) and
 * leaves no "just set status to whatever" back door.
 */
membershipRouter.post(
  "/",
  requirePermission("memberships.create"),
  validate(membershipParamsSchema, "params"),
  validate(createMembershipSchema, "body"),
  asyncHandler(membershipController.create),
);

membershipRouter.get(
  "/",
  requirePermission("memberships.view"),
  validate(membershipParamsSchema, "params"),
  validate(listMembershipsQuerySchema, "query"),
  asyncHandler(membershipController.list),
);

membershipRouter.get(
  "/:membershipId",
  requirePermission("memberships.view"),
  validate(membershipParamsSchema, "params"),
  asyncHandler(membershipController.getById),
);

membershipRouter.post(
  "/:membershipId/renew",
  requirePermission("memberships.renew"),
  validate(membershipParamsSchema, "params"),
  validate(renewMembershipSchema, "body"),
  asyncHandler(membershipController.renew),
);

/**
 * Upgrade and downgrade are the same operation — the difference is only which plan costs more —
 * so there is one endpoint, not two. It cancels a term and sells another, hence both permissions.
 */
membershipRouter.post(
  "/:membershipId/change-plan",
  requireAllPermissions("memberships.cancel", "memberships.create"),
  validate(membershipParamsSchema, "params"),
  validate(changePlanSchema, "body"),
  asyncHandler(membershipController.changePlan),
);

membershipRouter.post(
  "/:membershipId/freeze",
  requirePermission("memberships.freeze"),
  validate(membershipParamsSchema, "params"),
  asyncHandler(membershipController.freeze),
);

membershipRouter.post(
  "/:membershipId/unfreeze",
  requirePermission("memberships.freeze"),
  validate(membershipParamsSchema, "params"),
  asyncHandler(membershipController.unfreeze),
);

membershipRouter.post(
  "/:membershipId/cancel",
  requirePermission("memberships.cancel"),
  validate(membershipParamsSchema, "params"),
  asyncHandler(membershipController.cancel),
);
