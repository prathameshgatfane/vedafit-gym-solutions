import { apiClient, type ApiPaginated, type ApiSuccess } from "../../lib/api-client";
import type {
  NotificationListParams,
  NotificationLog,
  NotificationTemplate,
  ScanResult,
} from "./notification.types";

function path(organizationId: string, suffix = ""): string {
  return `/organizations/${organizationId}/notifications${suffix}`;
}

function toQuery(params: NotificationListParams): Record<string, string | number> {
  const query: Record<string, string | number> = {
    page: params.page,
    limit: params.limit,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  };
  if (params.search.trim()) query.search = params.search.trim();
  if (params.status) query.status = params.status;
  return query;
}

export async function listNotificationLogs(
  organizationId: string,
  params: NotificationListParams,
) {
  const { data } = await apiClient.get<ApiPaginated<NotificationLog>>(
    path(organizationId, "/logs"),
    { params: toQuery(params) },
  );
  return { items: data.data, pagination: data.pagination };
}

export async function listNotificationTemplates(organizationId: string) {
  const { data } = await apiClient.get<ApiSuccess<NotificationTemplate[]>>(
    path(organizationId, "/templates"),
  );
  return data.data;
}

export async function runNotificationScan(organizationId: string) {
  const { data } = await apiClient.post<ApiSuccess<ScanResult>>(path(organizationId, "/run"));
  return data.data;
}
