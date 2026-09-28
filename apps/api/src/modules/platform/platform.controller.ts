import type { Request, Response } from "express";
import { getPlatformAuth } from "../../middleware/auth.middleware";
import {
  activateSaasPlan,
  archiveSaasPlan,
  createSaasPlan,
  getSaasPlan,
  updateSaasPlan,
} from "../saas/saas-plan.service";
import { getOrganizationUsage } from "../saas/saas-usage.service";
import {
  createOrganizationAsOperator,
  getPlatformDashboard,
  getPlatformOrganization,
  listPlatformOrganizations,
  listSaasPlans,
  signupOrganization,
  updateOrganizationStatus,
  updateOrganizationSubscription,
} from "./platform.service";
import type {
  CreateSaasPlanInput,
  PlatformCreateOrganizationInput,
  PlatformOrganizationListQuery,
  PlatformOrganizationStatusInput,
  PlatformSignupInput,
  PlatformSubscriptionPatchInput,
  UpdateSaasPlanInput,
} from "./platform.schema";

export const platformController = {
  async signup(req: Request, res: Response): Promise<void> {
    const data = await signupOrganization(req.body as PlatformSignupInput);
    res.status(201).json({
      success: true,
      data,
      message: "Organization created. Sign in with POST /api/v1/auth/login.",
    });
  },

  async createOrganization(req: Request, res: Response): Promise<void> {
    const actor = getPlatformAuth(req);
    const data = await createOrganizationAsOperator(
      req.body as PlatformCreateOrganizationInput,
      actor.platformUserId,
    );
    res.status(201).json({
      success: true,
      data,
      message: "Organization created. Sign in with POST /api/v1/auth/login.",
    });
  },

  async listOrganizations(req: Request, res: Response): Promise<void> {
    getPlatformAuth(req);
    const { items, pagination } = await listPlatformOrganizations(
      req.query as unknown as PlatformOrganizationListQuery,
    );
    res.status(200).json({ success: true, data: items, pagination });
  },

  async getOrganization(req: Request<{ organizationId: string }>, res: Response): Promise<void> {
    getPlatformAuth(req);
    const data = await getPlatformOrganization(req.params.organizationId);
    res.status(200).json({ success: true, data });
  },

  async getOrganizationUsage(req: Request<{ organizationId: string }>, res: Response): Promise<void> {
    getPlatformAuth(req);
    const data = await getOrganizationUsage(req.params.organizationId);
    res.status(200).json({ success: true, data });
  },

  async patchOrganizationStatus(
    req: Request<{ organizationId: string }>,
    res: Response,
  ): Promise<void> {
    const actor = getPlatformAuth(req);
    const org = await updateOrganizationStatus(
      req.params.organizationId,
      (req.body as PlatformOrganizationStatusInput).status,
      actor.platformUserId,
    );
    res.status(200).json({
      success: true,
      data: org,
      message: "Organization status updated",
    });
  },

  async patchOrganizationSubscription(
    req: Request<{ organizationId: string }>,
    res: Response,
  ): Promise<void> {
    const actor = getPlatformAuth(req);
    const data = await updateOrganizationSubscription(
      req.params.organizationId,
      req.body as PlatformSubscriptionPatchInput,
      actor.platformUserId,
    );
    res.status(200).json({
      success: true,
      data,
      message: "Organization subscription updated",
    });
  },

  async listPlans(req: Request, res: Response): Promise<void> {
    getPlatformAuth(req);
    const data = await listSaasPlans();
    res.status(200).json({ success: true, data });
  },

  async getPlan(req: Request<{ planId: string }>, res: Response): Promise<void> {
    getPlatformAuth(req);
    const data = await getSaasPlan(req.params.planId);
    res.status(200).json({ success: true, data });
  },

  async createPlan(req: Request, res: Response): Promise<void> {
    const actor = getPlatformAuth(req);
    const data = await createSaasPlan(req.body as CreateSaasPlanInput, actor.platformUserId);
    res.status(201).json({ success: true, data, message: "SaaS plan created" });
  },

  async patchPlan(req: Request<{ planId: string }>, res: Response): Promise<void> {
    const actor = getPlatformAuth(req);
    const data = await updateSaasPlan(
      req.params.planId,
      req.body as UpdateSaasPlanInput,
      actor.platformUserId,
    );
    res.status(200).json({ success: true, data, message: "SaaS plan updated" });
  },

  async activatePlan(req: Request<{ planId: string }>, res: Response): Promise<void> {
    const actor = getPlatformAuth(req);
    const data = await activateSaasPlan(req.params.planId, actor.platformUserId);
    res.status(200).json({ success: true, data, message: "SaaS plan activated" });
  },

  async archivePlan(req: Request<{ planId: string }>, res: Response): Promise<void> {
    const actor = getPlatformAuth(req);
    const data = await archiveSaasPlan(req.params.planId, actor.platformUserId);
    res.status(200).json({ success: true, data, message: "SaaS plan archived" });
  },

  async dashboard(req: Request, res: Response): Promise<void> {
    getPlatformAuth(req);
    const data = await getPlatformDashboard();
    res.status(200).json({ success: true, data });
  },
};
