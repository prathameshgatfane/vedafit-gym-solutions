import type { Request, Response } from "express";
import { userService } from "./user.service";
import type { CreateUserInput, UpdateUserInput } from "./user.schema";

type OrgParams = { organizationId: string };
type UserParams = { organizationId: string; userId: string };

export const userController = {
  async create(req: Request<OrgParams>, res: Response) {
    const user = await userService.create(req.params.organizationId, req.body as CreateUserInput);
    res.status(201).json({ success: true, data: user, message: "User created" });
  },

  async list(req: Request<OrgParams>, res: Response) {
    const { items, pagination } = await userService.list(
      req.params.organizationId,
      req.query as unknown as Parameters<typeof userService.list>[1],
    );
    res.status(200).json({ success: true, data: items, pagination });
  },

  async getById(req: Request<UserParams>, res: Response) {
    const user = await userService.getById(req.params.organizationId, req.params.userId);
    res.status(200).json({ success: true, data: user });
  },

  async update(req: Request<UserParams>, res: Response) {
    const user = await userService.update(
      req.params.organizationId,
      req.params.userId,
      req.body as UpdateUserInput,
    );
    res.status(200).json({ success: true, data: user, message: "User updated" });
  },

  async remove(req: Request<UserParams>, res: Response) {
    await userService.softDelete(req.params.organizationId, req.params.userId);
    res.status(200).json({ success: true, data: null, message: "User deleted" });
  },
};
