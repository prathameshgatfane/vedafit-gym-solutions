import type { Request, Response } from "express";
import { getPlatformAuth } from "../../middleware/auth.middleware";
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
  PlatformOrganizationListQuery,
  PlatformOrganizationStatusInput,
  PlatformSignupInput,
  PlatformSubscriptionPatchInput,
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
      req.body as PlatformSignupInput,
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

  async dashboard(req: Request, res: Response): Promise<void> {
    getPlatformAuth(req);
    const data = await getPlatformDashboard();
    res.status(200).json({ success: true, data });
  },
};
