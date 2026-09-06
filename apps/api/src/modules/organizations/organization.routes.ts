import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { authenticate } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { tenantScope } from "../../middleware/tenant.middleware";
import { validate } from "../../middleware/validation.middleware";
import { organizationController } from "./organization.controller";
import { organizationIdParamsSchema, updateOrganizationSchema } from "./organization.schema";
import { branchRouter } from "../branches/branch.routes";
import { userRouter } from "../users/user.routes";
import { roleRouter } from "../roles/role.routes";

export const organizationRouter = Router();

// Nothing under /organizations is reachable without a valid access token.
organizationRouter.use(authenticate);

/**
 * One guard covering every org-scoped path below, including the nested routers, because this
 * `use()` prefix-matches `/:organizationId/anything`. The URL's organizationId is a
 * client-supplied claim like any other, so it is checked against the JWT before a handler runs —
 * this is what makes org A's token useless against org B on every module at once (Section 6).
 */
organizationRouter.use("/:organizationId", tenantScope);

/**
 * Note: there is deliberately no `POST /organizations` or `GET /organizations` (list-all).
 * Organizations are bootstrapped by the seed script until the super-admin layer in Phase 15
 * (Locked Decision 1.7), and a list-all endpoint would be cross-tenant by construction.
 * See Section 9 (2026-09-06).
 */
organizationRouter.get(
  "/:organizationId",
  validate(organizationIdParamsSchema, "params"),
  asyncHandler(organizationController.getById),
);

organizationRouter.patch(
  "/:organizationId",
  requirePermission("organizations.update"),
  validate(organizationIdParamsSchema, "params"),
  validate(updateOrganizationSchema, "body"),
  asyncHandler(organizationController.update),
);

organizationRouter.use("/:organizationId/branches", branchRouter);
organizationRouter.use("/:organizationId/users", userRouter);
organizationRouter.use("/:organizationId/roles", roleRouter);
