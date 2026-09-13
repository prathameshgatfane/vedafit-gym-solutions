import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { requirePermission } from "../../middleware/permission.middleware";
import { validate } from "../../middleware/validation.middleware";
import { reportController } from "./report.controller";
import {
  dashboardQuerySchema,
  profitLossQuerySchema,
  reportParamsSchema,
} from "./report.schema";

// `authenticate` and `tenantScope` are already applied by the parent organizationRouter.
export const reportRouter = Router({ mergeParams: true });

// The dashboard is every role's home screen; widgets the caller cannot see are omitted (1.18.6).
reportRouter.get(
  "/dashboard",
  validate(reportParamsSchema, "params"),
  validate(dashboardQuerySchema, "query"),
  asyncHandler(reportController.dashboard),
);

// The dedicated P&L is the screen `reports.view` was always for (1.18.6 / 1.21.4).
reportRouter.get(
  "/profit-loss",
  requirePermission("reports.view"),
  validate(reportParamsSchema, "params"),
  validate(profitLossQuerySchema, "query"),
  asyncHandler(reportController.profitLoss),
);
