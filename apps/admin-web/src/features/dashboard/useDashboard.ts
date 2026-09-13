import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useSessionStore } from "../../stores/session.store";
import { fetchDashboard } from "./dashboard.api";
import type { Dashboard } from "./dashboard.types";

export const dashboardKeys = {
  all: (organizationId: string) => ["dashboard", organizationId] as const,
  view: (organizationId: string, branchId: string | null) =>
    ["dashboard", organizationId, branchId] as const,
};

export function useDashboard(): UseQueryResult<Dashboard> {
  const organizationId = useSessionStore((s) => s.organization?.id) ?? "";
  const activeBranchId = useSessionStore((s) => s.activeBranchId);

  return useQuery({
    queryKey: dashboardKeys.view(organizationId, activeBranchId),
    queryFn: () => fetchDashboard(organizationId, activeBranchId),
    enabled: organizationId !== "",
  });
}
