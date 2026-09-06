import type { Request, Response } from "express";
import { organizationService } from "./organization.service";
import type { UpdateOrganizationInput } from "./organization.schema";

/**
 * No `create`/`list` handlers: organization creation and cross-org listing are not part of the
 * tenant-facing API. Orgs are bootstrapped by the seed script until Phase 15's super-admin layer
 * (Locked Decision 1.7), and `organizationService.create`/`list` remain available for the seed
 * script, tests, and that future phase. See Section 9 (2026-09-06).
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
