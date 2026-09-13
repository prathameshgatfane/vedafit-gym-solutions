import { apiClient, type ApiSuccess } from "../../lib/api-client";
import type { Dashboard } from "./dashboard.types";

export async function fetchDashboard(
  organizationId: string,
  branchId?: string | null,
): Promise<Dashboard> {
  const { data } = await apiClient.get<ApiSuccess<Dashboard>>(
    `/organizations/${organizationId}/reports/dashboard`,
    { params: branchId ? { branchId } : undefined },
  );
  return data.data;
}
