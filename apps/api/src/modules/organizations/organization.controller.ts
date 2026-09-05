import type { Request, Response } from "express";
import { organizationService } from "./organization.service";
import type { CreateOrganizationInput, UpdateOrganizationInput } from "./organization.schema";

export const organizationController = {
  async create(req: Request, res: Response) {
    const org = await organizationService.create(req.body as CreateOrganizationInput);
    res.status(201).json({ success: true, data: org, message: "Organization created" });
  },

  async list(req: Request, res: Response) {
    const { items, pagination } = await organizationService.list(
      req.query as unknown as Parameters<typeof organizationService.list>[0],
    );
    res.status(200).json({ success: true, data: items, pagination });
  },

  async getById(req: Request<{ organizationId: string }>, res: Response) {
    const org = await organizationService.getById(req.params.organizationId);
    res.status(200).json({ success: true, data: org });
  },

  async update(req: Request<{ organizationId: string }>, res: Response) {
    const org = await organizationService.update(
      req.params.organizationId,
      req.body as UpdateOrganizationInput,
    );
    res.status(200).json({ success: true, data: org, message: "Organization updated" });
  },
};
