import type { Request, Response } from "express";
import { getAuth } from "../../middleware/auth.middleware";
import type { DashboardQuery, ProfitLossQuery } from "./report.schema";
import { reportService, type ReportScope } from "./report.service";

type OrgParams = { organizationId: string };

function scopeFrom(req: Request): ReportScope {
  const auth = getAuth(req);
  return {
    organizationId: auth.organizationId,
    branchId: auth.branchId,
    roleId: auth.roleId,
    userId: auth.userId,
  };
}

export const reportController = {
  async dashboard(req: Request<OrgParams>, res: Response) {
    const dashboard = await reportService.dashboard(
      scopeFrom(req),
      req.query as unknown as DashboardQuery,
    );
    res.status(200).json({ success: true, data: dashboard });
  },

  async profitLoss(req: Request<OrgParams>, res: Response) {
    const report = await reportService.profitLoss(
      scopeFrom(req),
      req.query as unknown as ProfitLossQuery,
    );
    res.status(200).json({ success: true, data: report });
  },
};
