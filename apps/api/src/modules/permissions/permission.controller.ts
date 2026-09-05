import type { Request, Response } from "express";
import { permissionService } from "./permission.service";

export const permissionController = {
  async list(req: Request, res: Response) {
    const { items, pagination } = await permissionService.list(
      req.query as unknown as Parameters<typeof permissionService.list>[0],
    );
    res.status(200).json({ success: true, data: items, pagination });
  },

  async getById(req: Request<{ permissionId: string }>, res: Response) {
    const permission = await permissionService.getById(req.params.permissionId);
    res.status(200).json({ success: true, data: permission });
  },
};
