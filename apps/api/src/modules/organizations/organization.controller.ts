import type { Request, Response } from "express";
import { organizationService } from "./organization.service";
import type { UpdateOrganizationInput } from "./organization.schema";

/**
 * No `create`/`list` handlers: organization creation and cross-org listing are not part of the
 * tenant-facing API. Orgs are bootstrapped by `provisionOrganization` (Phase 15.3) from the
 * seed script; public signup and Super Admin create will call the same function later.
 * `organizationService.create`/`list` remain available for tests and incomplete org rows.
 */
export const organizationController = {
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
