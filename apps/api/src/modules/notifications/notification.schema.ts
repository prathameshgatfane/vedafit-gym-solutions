import { z } from "zod";
import { createListQuerySchema } from "../../utils/pagination";

export const notificationEventSchema = z.enum(["MEMBERSHIP_EXPIRING", "PAYMENT_DUE"]);
export const notificationChannelSchema = z.enum(["SMS", "EMAIL", "PUSH"]);
export const notificationLogStatusSchema = z.enum(["QUEUED", "SENT", "FAILED"]);

export const notificationParamsSchema = z.object({
  organizationId: z.string().trim().min(1),
  logId: z.string().trim().min(1).optional(),
  templateId: z.string().trim().min(1).optional(),
});

export const listNotificationLogsQuerySchema = createListQuerySchema([
  "createdAt",
  "sentAt",
  "event",
]).extend({
  status: notificationLogStatusSchema.optional(),
  event: notificationEventSchema.optional(),
  channel: notificationChannelSchema.optional(),
});
export type ListNotificationLogsQuery = z.infer<typeof listNotificationLogsQuerySchema>;

export const updateTemplateSchema = z.object({
  body: z.string().trim().min(1).max(1000),
});
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
