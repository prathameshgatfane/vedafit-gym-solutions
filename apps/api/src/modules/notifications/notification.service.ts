import type { Prisma } from "@prisma/client";
import { AppError } from "../../lib/app-error";
import { ErrorCode } from "../../lib/error-codes";
import { prisma } from "../../lib/prisma";
import { formatCalendarDate } from "../../utils/dates";
import { buildPaginationMeta, paginationSkipTake } from "../../utils/pagination";
import { scanOrganization } from "../../services/notification/scan";
import { ensureDefaultTemplates } from "../../services/notification/templates";
import type { ListNotificationLogsQuery, UpdateTemplateInput } from "./notification.schema";

export interface NotificationScope {
  organizationId: string;
  branchId: string | null;
}

const logInclude = {
  member: { select: { id: true, firstName: true, lastName: true, phone: true } },
} satisfies Prisma.NotificationLogInclude;

function toLogResponse(row: Prisma.NotificationLogGetPayload<{ include: typeof logInclude }>) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    memberId: row.memberId,
    event: row.event,
    channel: row.channel,
    status: row.status,
    entityType: row.entityType,
    entityId: row.entityId,
    localDate: formatCalendarDate(row.localDate),
    body: row.body,
    lastError: row.lastError,
    sentAt: row.sentAt,
    createdAt: row.createdAt,
    member: row.member,
  };
}

export const notificationService = {
  async listLogs(scope: NotificationScope, query: ListNotificationLogsQuery) {
    const search = query.search?.trim();
    const where: Prisma.NotificationLogWhereInput = {
      organizationId: scope.organizationId,
      status: query.status,
      event: query.event,
      channel: query.channel,
      OR: search
        ? [
            { body: { contains: search } },
            { member: { firstName: { contains: search } } },
            { member: { lastName: { contains: search } } },
            { member: { phone: { contains: search } } },
          ]
        : undefined,
    };

    const orderBy: Prisma.NotificationLogOrderByWithRelationInput =
      query.sortBy === "sentAt"
        ? { sentAt: query.sortOrder }
        : query.sortBy === "event"
          ? { event: query.sortOrder }
          : { createdAt: query.sortOrder };

    const [rows, total] = await Promise.all([
      prisma.notificationLog.findMany({
        where,
        include: logInclude,
        orderBy,
        ...paginationSkipTake(query),
      }),
      prisma.notificationLog.count({ where }),
    ]);

    return {
      items: rows.map(toLogResponse),
      pagination: buildPaginationMeta(query.page, query.limit, total),
    };
  },

  async getLog(scope: NotificationScope, logId: string) {
    const log = await prisma.notificationLog.findFirst({
      where: { id: logId, organizationId: scope.organizationId },
      include: logInclude,
    });
    if (!log) {
      throw AppError.notFound(ErrorCode.NOTIFICATION_LOG_NOT_FOUND, `Notification "${logId}" not found`);
    }
    return toLogResponse(log);
  },

  async listTemplates(scope: NotificationScope) {
    await ensureDefaultTemplates(scope.organizationId);
    return prisma.notificationTemplate.findMany({
      where: { organizationId: scope.organizationId },
      orderBy: [{ event: "asc" }, { channel: "asc" }],
    });
  },

  async updateTemplate(scope: NotificationScope, templateId: string, input: UpdateTemplateInput) {
    const existing = await prisma.notificationTemplate.findFirst({
      where: { id: templateId, organizationId: scope.organizationId },
    });
    if (!existing) {
      throw AppError.notFound(
        ErrorCode.NOTIFICATION_TEMPLATE_NOT_FOUND,
        `Template "${templateId}" not found`,
      );
    }
    return prisma.notificationTemplate.update({
      where: { id: templateId },
      data: { body: input.body },
    });
  },

  async run(scope: NotificationScope) {
    return scanOrganization(scope.organizationId, new Date());
  },
};
