import type { Request, Response } from "express";
import { roleService } from "./role.service";
import type { CreateRoleInput, UpdateRoleInput } from "./role.schema";

type OrgParams = { organizationId: string };
type RoleParams = { organizationId: string; roleId: string };

export const roleController = {
  async create(req: Request<OrgParams>, res: Response) {
    const role = await roleService.create(req.params.organizationId, req.body as CreateRoleInput);
    res.status(201).json({ success: true, data: role, message: "Role created" });
  },

  async list(req: Request<OrgParams>, res: Response) {
    const { items, pagination } = await roleService.list(
      req.params.organizationId,
      req.query as unknown as Parameters<typeof roleService.list>[1],
    );
    res.status(200).json({ success: true, data: items, pagination });
  },

  async getById(req: Request<RoleParams>, res: Response) {
    const role = await roleService.getById(req.params.organizationId, req.params.roleId);
    res.status(200).json({ success: true, data: role });
  },

  async update(req: Request<RoleParams>, res: Response) {
    const role = await roleService.update(
      req.params.organizationId,
      req.params.roleId,
      req.body as UpdateRoleInput,
    );
    res.status(200).json({ success: true, data: role, message: "Role updated" });
  },
};
