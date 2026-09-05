import type { Request, Response } from "express";
import { branchService } from "./branch.service";
import type { CreateBranchInput, UpdateBranchInput } from "./branch.schema";

type OrgParams = { organizationId: string };
type BranchParams = { organizationId: string; branchId: string };

export const branchController = {
  async create(req: Request<OrgParams>, res: Response) {
    const branch = await branchService.create(
      req.params.organizationId,
      req.body as CreateBranchInput,
    );
    res.status(201).json({ success: true, data: branch, message: "Branch created" });
  },

  async list(req: Request<OrgParams>, res: Response) {
    const { items, pagination } = await branchService.list(
      req.params.organizationId,
      req.query as unknown as Parameters<typeof branchService.list>[1],
    );
    res.status(200).json({ success: true, data: items, pagination });
  },

  async getById(req: Request<BranchParams>, res: Response) {
    const branch = await branchService.getById(req.params.organizationId, req.params.branchId);
    res.status(200).json({ success: true, data: branch });
  },

  async update(req: Request<BranchParams>, res: Response) {
    const branch = await branchService.update(
      req.params.organizationId,
      req.params.branchId,
      req.body as UpdateBranchInput,
    );
    res.status(200).json({ success: true, data: branch, message: "Branch updated" });
  },
};
