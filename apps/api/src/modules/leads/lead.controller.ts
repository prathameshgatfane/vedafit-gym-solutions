import type { Request, Response } from "express";
import { getAuth } from "../../middleware/auth.middleware";
import type {
  ConvertLeadInput,
  CreateLeadInput,
  ListLeadsQuery,
  UpdateLeadInput,
} from "./lead.schema";
import { leadService, type LeadScope } from "./lead.service";

type OrgParams = { organizationId: string };
type LeadParams = OrgParams & { leadId: string };

function scopeFrom(req: Request): LeadScope {
  const auth = getAuth(req);
  return {
    organizationId: auth.organizationId,
    branchId: auth.branchId,
    userId: auth.userId,
  };
}

export const leadController = {
  async list(req: Request<OrgParams>, res: Response) {
    const { items, pagination } = await leadService.list(
      scopeFrom(req),
      req.query as unknown as ListLeadsQuery,
    );
    res.status(200).json({ success: true, data: items, pagination });
  },

  async assignees(req: Request<OrgParams>, res: Response) {
    const data = await leadService.assignees(scopeFrom(req));
    res.status(200).json({ success: true, data });
  },

  async getById(req: Request<LeadParams>, res: Response) {
    const lead = await leadService.getById(scopeFrom(req), req.params.leadId);
    res.status(200).json({ success: true, data: lead });
  },

  async create(req: Request<OrgParams>, res: Response) {
    const lead = await leadService.create(scopeFrom(req), req.body as CreateLeadInput);
    res.status(201).json({ success: true, data: lead, message: "Lead created" });
  },

  async update(req: Request<LeadParams>, res: Response) {
    const lead = await leadService.update(
      scopeFrom(req),
      req.params.leadId,
      req.body as UpdateLeadInput,
    );
    res.status(200).json({ success: true, data: lead, message: "Lead updated" });
  },

  async convert(req: Request<LeadParams>, res: Response) {
    const lead = await leadService.convert(
      scopeFrom(req),
      req.params.leadId,
      req.body as ConvertLeadInput,
    );
    res.status(200).json({ success: true, data: lead, message: "Lead converted" });
  },
};
