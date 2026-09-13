import type { Request, Response } from "express";
import { getAuth } from "../../middleware/auth.middleware";
import type { ListNotificationLogsQuery, UpdateTemplateInput } from "./notification.schema";
import { notificationService, type NotificationScope } from "./notification.service";

type OrgParams = { organizationId: string };
type LogParams = OrgParams & { logId: string };
type TemplateParams = OrgParams & { templateId: string };

function scopeFrom(req: Request): NotificationScope {
  const auth = getAuth(req);
  return { organizationId: auth.organizationId, branchId: auth.branchId };
}

export const notificationController = {
  async listLogs(req: Request<OrgParams>, res: Response) {
    const { items, pagination } = await notificationService.listLogs(
      scopeFrom(req),
      req.query as unknown as ListNotificationLogsQuery,
    );
    res.status(200).json({ success: true, data: items, pagination });
  },

  async getLog(req: Request<LogParams>, res: Response) {
    const log = await notificationService.getLog(scopeFrom(req), req.params.logId);
    res.status(200).json({ success: true, data: log });
  },

  async listTemplates(req: Request<OrgParams>, res: Response) {
    const templates = await notificationService.listTemplates(scopeFrom(req));
    res.status(200).json({ success: true, data: templates });
  },

  async updateTemplate(req: Request<TemplateParams>, res: Response) {
    const template = await notificationService.updateTemplate(
      scopeFrom(req),
      req.params.templateId,
      req.body as UpdateTemplateInput,
    );
    res.status(200).json({ success: true, data: template, message: "Template updated" });
  },

  async run(req: Request<OrgParams>, res: Response) {
    const result = await notificationService.run(scopeFrom(req));
    res.status(202).json({
      success: true,
      data: result,
      message: `Queued ${result.queued} notification${result.queued === 1 ? "" : "s"}`,
    });
  },
};
