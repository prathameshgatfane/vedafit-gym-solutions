import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useSessionStore } from "../../stores/session.store";
import {
  listNotificationLogs,
  listNotificationTemplates,
  runNotificationScan,
} from "./notifications.api";
import type { NotificationListParams, NotificationLog, NotificationTemplate, ScanResult } from "./notification.types";

export const notificationKeys = {
  all: (organizationId: string) => ["notifications", organizationId] as const,
  logs: (organizationId: string, params: NotificationListParams) =>
    ["notifications", organizationId, "logs", params] as const,
  templates: (organizationId: string) => ["notifications", organizationId, "templates"] as const,
};

function useOrganizationId(): string {
  return useSessionStore((s) => s.organization?.id) ?? "";
}

export function useNotificationLogs(
  params: NotificationListParams,
): UseQueryResult<{ items: NotificationLog[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
  const organizationId = useOrganizationId();
  return useQuery({
    queryKey: notificationKeys.logs(organizationId, params),
    queryFn: () => listNotificationLogs(organizationId, params),
    enabled: organizationId !== "",
    placeholderData: keepPreviousData,
  });
}

export function useNotificationTemplates(): UseQueryResult<NotificationTemplate[]> {
  const organizationId = useOrganizationId();
  return useQuery({
    queryKey: notificationKeys.templates(organizationId),
    queryFn: () => listNotificationTemplates(organizationId),
    enabled: organizationId !== "",
  });
}

export function useRunNotificationScan() {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => runNotificationScan(organizationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.all(organizationId) });
    },
  });
}

export type { ScanResult };
