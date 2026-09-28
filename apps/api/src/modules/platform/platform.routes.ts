import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { authenticatePlatform } from "../../middleware/auth.middleware";
import { validate } from "../../middleware/validation.middleware";
import { organizationIdParamsSchema } from "../organizations/organization.schema";
import { platformController } from "./platform.controller";
import { signupRateLimiter } from "./platform.rate-limit";
import {
  createSaasPlanSchema,
  platformCreateOrganizationSchema,
  platformOrganizationListQuerySchema,
  platformOrganizationStatusSchema,
  platformSignupSchema,
  platformSubscriptionPatchSchema,
  saasPlanIdParamsSchema,
  updateSaasPlanSchema,
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
  validate(platformCreateOrganizationSchema, "body"),
  asyncHandler(platformController.createOrganization),
);

platformRouter.get(
  "/organizations/:organizationId",
  authenticatePlatform,
  validate(organizationIdParamsSchema, "params"),
  asyncHandler(platformController.getOrganization),
);

platformRouter.get(
  "/organizations/:organizationId/usage",
  authenticatePlatform,
  validate(organizationIdParamsSchema, "params"),
  asyncHandler(platformController.getOrganizationUsage),
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

platformRouter.post(
  "/plans",
  authenticatePlatform,
  validate(createSaasPlanSchema, "body"),
  asyncHandler(platformController.createPlan),
);

platformRouter.get(
  "/plans/:planId",
  authenticatePlatform,
  validate(saasPlanIdParamsSchema, "params"),
  asyncHandler(platformController.getPlan),
);

platformRouter.patch(
  "/plans/:planId",
  authenticatePlatform,
  validate(saasPlanIdParamsSchema, "params"),
  validate(updateSaasPlanSchema, "body"),
  asyncHandler(platformController.patchPlan),
);

platformRouter.post(
  "/plans/:planId/activate",
  authenticatePlatform,
  validate(saasPlanIdParamsSchema, "params"),
  asyncHandler(platformController.activatePlan),
);

platformRouter.post(
  "/plans/:planId/archive",
  authenticatePlatform,
  validate(saasPlanIdParamsSchema, "params"),
  asyncHandler(platformController.archivePlan),
);

platformRouter.get(
  "/dashboard",
  authenticatePlatform,
  asyncHandler(platformController.dashboard),
);
