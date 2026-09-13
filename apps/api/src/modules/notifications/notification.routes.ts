import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { requirePermission } from "../../middleware/permission.middleware";
import { validate } from "../../middleware/validation.middleware";
import { notificationController } from "./notification.controller";
import {
  listNotificationLogsQuerySchema,
  notificationParamsSchema,
  updateTemplateSchema,
} from "./notification.schema";

export const notificationRouter = Router({ mergeParams: true });

notificationRouter.use(requirePermission("notifications.manage"));

notificationRouter.get(
  "/logs",
  validate(notificationParamsSchema, "params"),
  validate(listNotificationLogsQuerySchema, "query"),
  asyncHandler(notificationController.listLogs),
);

notificationRouter.get(
  "/logs/:logId",
  validate(notificationParamsSchema, "params"),
  asyncHandler(notificationController.getLog),
);

notificationRouter.get(
  "/templates",
  validate(notificationParamsSchema, "params"),
  asyncHandler(notificationController.listTemplates),
);

notificationRouter.patch(
  "/templates/:templateId",
  validate(notificationParamsSchema, "params"),
  validate(updateTemplateSchema, "body"),
  asyncHandler(notificationController.updateTemplate),
);

notificationRouter.post(
  "/run",
  validate(notificationParamsSchema, "params"),
  asyncHandler(notificationController.run),
);
