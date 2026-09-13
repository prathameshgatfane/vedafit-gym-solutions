import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { authenticatePlatform } from "../../middleware/auth.middleware";
import { validate } from "../../middleware/validation.middleware";
import { organizationIdParamsSchema } from "../organizations/organization.schema";
import { platformController } from "./platform.controller";
import { signupRateLimiter } from "./platform.rate-limit";
import {
  platformOrganizationListQuerySchema,
  platformOrganizationStatusSchema,
  platformSignupSchema,
  platformSubscriptionPatchSchema,
} from "./platform.schema";

export const platformRouter = Router();

// Public. Limiter runs before validation so malformed spam is counted too.
platformRouter.post(
  "/signup",
  signupRateLimiter,
  validate(platformSignupSchema, "body"),
  asyncHandler(platformController.signup),
);

// Phase 15.8. `organizationId` is a resource id (10.5) — do not run tenantScope here.
platformRouter.get(
  "/organizations",
  authenticatePlatform,
  validate(platformOrganizationListQuerySchema, "query"),
  asyncHandler(platformController.listOrganizations),
);

platformRouter.post(
  "/organizations",
  authenticatePlatform,
  validate(platformSignupSchema, "body"),
  asyncHandler(platformController.createOrganization),
);

platformRouter.get(
  "/organizations/:organizationId",
  authenticatePlatform,
  validate(organizationIdParamsSchema, "params"),
  asyncHandler(platformController.getOrganization),
);

// Phase 15.7.
platformRouter.patch(
  "/organizations/:organizationId/status",
  authenticatePlatform,
  validate(organizationIdParamsSchema, "params"),
  validate(platformOrganizationStatusSchema, "body"),
  asyncHandler(platformController.patchOrganizationStatus),
);

platformRouter.patch(
  "/organizations/:organizationId/subscription",
  authenticatePlatform,
  validate(organizationIdParamsSchema, "params"),
  validate(platformSubscriptionPatchSchema, "body"),
  asyncHandler(platformController.patchOrganizationSubscription),
);

platformRouter.get(
  "/plans",
  authenticatePlatform,
  asyncHandler(platformController.listPlans),
);

platformRouter.get(
  "/dashboard",
  authenticatePlatform,
  asyncHandler(platformController.dashboard),
);
