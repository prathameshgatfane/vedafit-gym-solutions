import { apiClient, type ApiSuccess } from "../../lib/api-client";
import type { PlatformDashboard } from "./dashboard.types";

export async function fetchDashboard(): Promise<PlatformDashboard> {
  const { data } = await apiClient.get<ApiSuccess<PlatformDashboard>>("/platform/dashboard");
  return data.data;
}
