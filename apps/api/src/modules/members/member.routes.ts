import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { requirePermission } from "../../middleware/permission.middleware";
import { validate } from "../../middleware/validation.middleware";
import { memberController } from "./member.controller";
import {
  createMemberSchema,
  listMembersQuerySchema,
  memberParamsSchema,
  updateMemberSchema,
} from "./member.schema";

// `authenticate` and `tenantScope` are already applied by the parent organizationRouter.
export const memberRouter = Router({ mergeParams: true });

/**
 * Permissions are per-action rather than one module-wide guard, because the Section 4.2 matrix
 * splits them: a RECEPTIONIST may create, view and update members but not archive them.
 */
memberRouter.post(
  "/",
  requirePermission("members.create"),
  validate(memberParamsSchema, "params"),
  validate(createMemberSchema, "body"),
  asyncHandler(memberController.create),
);

memberRouter.get(
  "/",
  requirePermission("members.view"),
  validate(memberParamsSchema, "params"),
  validate(listMembersQuerySchema, "query"),
  asyncHandler(memberController.list),
);

memberRouter.get(
  "/:memberId",
  requirePermission("members.view"),
  validate(memberParamsSchema, "params"),
  asyncHandler(memberController.getById),
);

memberRouter.patch(
  "/:memberId",
  requirePermission("members.update"),
  validate(memberParamsSchema, "params"),
  validate(updateMemberSchema, "body"),
  asyncHandler(memberController.update),
);

/**
 * A state transition, not a deletion — the record stays readable and listable under
 * `?status=ARCHIVED` — so this is a POST to a named sub-resource rather than `DELETE /:memberId`.
 * It also leaves room for a `POST /:memberId/restore` later without reusing a verb misleadingly.
 */
memberRouter.post(
  "/:memberId/archive",
  requirePermission("members.archive"),
  validate(memberParamsSchema, "params"),
  asyncHandler(memberController.archive),
);
