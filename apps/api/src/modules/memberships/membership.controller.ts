import type { Request, Response } from "express";
import { getAuth } from "../../middleware/auth.middleware";
import { membershipService, type MembershipScope } from "./membership.service";
import type {
  ChangePlanInput,
  CreateMembershipInput,
  ListMembershipsQuery,
  RenewMembershipInput,
} from "./membership.schema";

type OrgParams = { organizationId: string };
type MembershipParams = { organizationId: string; membershipId: string };

/** Scope comes from the verified JWT, never the URL — same contract as every other module. */
function scopeFrom(req: Request): MembershipScope {
  const auth = getAuth(req);
  return { organizationId: auth.organizationId, branchId: auth.branchId };
}

export const membershipController = {
  async create(req: Request<OrgParams>, res: Response) {
    const membership = await membershipService.create(
      scopeFrom(req),
      req.body as CreateMembershipInput,
    );
    res.status(201).json({ success: true, data: membership, message: "Membership created" });
  },

  async list(req: Request<OrgParams>, res: Response) {
    const { items, pagination } = await membershipService.list(
      scopeFrom(req),
      req.query as unknown as ListMembershipsQuery,
    );
    res.status(200).json({ success: true, data: items, pagination });
  },

  async getById(req: Request<MembershipParams>, res: Response) {
    const membership = await membershipService.getById(scopeFrom(req), req.params.membershipId);
    res.status(200).json({ success: true, data: membership });
  },

  async renew(req: Request<MembershipParams>, res: Response) {
    const membership = await membershipService.renew(
      scopeFrom(req),
      req.params.membershipId,
      req.body as RenewMembershipInput,
    );
    // 201: a renewal is a new membership row, not an edit of the one in the URL (1.15.3).
    res.status(201).json({ success: true, data: membership, message: "Membership renewed" });
  },

  async changePlan(req: Request<MembershipParams>, res: Response) {
    const { membership, forfeitedDays, forfeitedValue } = await membershipService.changePlan(
      scopeFrom(req),
      req.params.membershipId,
      req.body as ChangePlanInput,
    );
    res.status(201).json({
      success: true,
      data: membership,
      // Surfaced rather than swallowed: proration is deferred (1.15.4/1.16.1), so the caller is
      // told exactly how much unused time the switch gave up and what it was worth at the old
      // term's own rate. Reported only — refunding it is a separate, `payments.refund`-gated act.
      meta: { forfeitedDays, forfeitedValue },
      message:
        forfeitedDays > 0
          ? `Plan changed — ${forfeitedDays} unused day${forfeitedDays === 1 ? "" : "s"} forfeited`
          : "Plan changed",
    });
  },

  async freeze(req: Request<MembershipParams>, res: Response) {
    const membership = await membershipService.freeze(scopeFrom(req), req.params.membershipId);
    res.status(200).json({ success: true, data: membership, message: "Membership frozen" });
  },

  async unfreeze(req: Request<MembershipParams>, res: Response) {
    const membership = await membershipService.unfreeze(scopeFrom(req), req.params.membershipId);
    res.status(200).json({
      success: true,
      data: membership,
      message: `Membership unfrozen — now ends ${membership.endDate}`,
    });
  },

  async cancel(req: Request<MembershipParams>, res: Response) {
    const membership = await membershipService.cancel(scopeFrom(req), req.params.membershipId);
    res.status(200).json({ success: true, data: membership, message: "Membership cancelled" });
  },
};
