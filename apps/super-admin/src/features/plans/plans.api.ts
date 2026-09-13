import { apiClient, type ApiSuccess } from "../../lib/api-client";
import type { SaasPlan } from "./plan.types";

export async function listSaasPlans(): Promise<SaasPlan[]> {
  const { data } = await apiClient.get<ApiSuccess<SaasPlan[]>>("/platform/plans");
  return data.data;
}
