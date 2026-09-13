import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { requirePermission } from "../../middleware/permission.middleware";
import { validate } from "../../middleware/validation.middleware";
import { leadController } from "./lead.controller";
import {
  convertLeadSchema,
  createLeadSchema,
  leadParamsSchema,
  listLeadsQuerySchema,
  updateLeadSchema,
} from "./lead.schema";

export const leadRouter = Router({ mergeParams: true });

leadRouter.use(requirePermission("leads.manage"));

leadRouter.get(
  "/assignees",
  validate(leadParamsSchema, "params"),
  asyncHandler(leadController.assignees),
);

leadRouter.get(
  "/",
  validate(leadParamsSchema, "params"),
  validate(listLeadsQuerySchema, "query"),
  asyncHandler(leadController.list),
);

leadRouter.post(
  "/",
  validate(leadParamsSchema, "params"),
  validate(createLeadSchema, "body"),
  asyncHandler(leadController.create),
);

leadRouter.get(
  "/:leadId",
  validate(leadParamsSchema, "params"),
  asyncHandler(leadController.getById),
);

leadRouter.patch(
  "/:leadId",
  validate(leadParamsSchema, "params"),
  validate(updateLeadSchema, "body"),
  asyncHandler(leadController.update),
);

leadRouter.post(
  "/:leadId/convert",
  validate(leadParamsSchema, "params"),
  validate(convertLeadSchema, "body"),
  asyncHandler(leadController.convert),
);
