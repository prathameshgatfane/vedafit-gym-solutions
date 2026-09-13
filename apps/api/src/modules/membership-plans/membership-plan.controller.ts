import type { Request, Response } from "express";
import { getAuth } from "../../middleware/auth.middleware";
import { membershipPlanService, type PlanScope } from "./membership-plan.service";
import type {
  CreateMembershipPlanInput,
  ListMembershipPlansQuery,
  UpdateMembershipPlanInput,
} from "./membership-plan.schema";

type OrgParams = { organizationId: string };
type PlanParams = { organizationId: string; planId: string };

/** Scope comes from the verified JWT, never the URL — same contract as every other module. */
function scopeFrom(req: Request): PlanScope {
  return { organizationId: getAuth(req).organizationId };
}

export const membershipPlanController = {
  async create(req: Request<OrgParams>, res: Response) {
    const plan = await membershipPlanService.create(
      scopeFrom(req),
      req.body as CreateMembershipPlanInput,
    );
    res.status(201).json({ success: true, data: plan, message: "Membership plan created" });
  },

  async list(req: Request<OrgParams>, res: Response) {
    const { items, pagination } = await membershipPlanService.list(
      scopeFrom(req),
      req.query as unknown as ListMembershipPlansQuery,
    );
    res.status(200).json({ success: true, data: items, pagination });
  },

  async getById(req: Request<PlanParams>, res: Response) {
    const plan = await membershipPlanService.getById(scopeFrom(req), req.params.planId);
    res.status(200).json({ success: true, data: plan });
  },

  async update(req: Request<PlanParams>, res: Response) {
    const plan = await membershipPlanService.update(
      scopeFrom(req),
      req.params.planId,
      req.body as UpdateMembershipPlanInput,
    );
    res.status(200).json({ success: true, data: plan, message: "Membership plan updated" });
  },
};
