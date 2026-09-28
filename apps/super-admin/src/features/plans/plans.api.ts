import { apiClient, type ApiSuccess } from "../../lib/api-client";
import type { CreateSaasPlanInput, SaasPlan, UpdateSaasPlanInput } from "./plan.types";

export async function listSaasPlans(): Promise<SaasPlan[]> {
  const { data } = await apiClient.get<ApiSuccess<SaasPlan[]>>("/platform/plans");
  return data.data;
}

export async function getSaasPlan(planId: string): Promise<SaasPlan> {
  const { data } = await apiClient.get<ApiSuccess<SaasPlan>>(`/platform/plans/${planId}`);
  return data.data;
}

export async function createSaasPlan(input: CreateSaasPlanInput): Promise<SaasPlan> {
  const { data } = await apiClient.post<ApiSuccess<SaasPlan>>("/platform/plans", input);
  return data.data;
}

export async function updateSaasPlan(planId: string, input: UpdateSaasPlanInput): Promise<SaasPlan> {
  const { data } = await apiClient.patch<ApiSuccess<SaasPlan>>(`/platform/plans/${planId}`, input);
  return data.data;
}

export async function activateSaasPlan(planId: string): Promise<SaasPlan> {
  const { data } = await apiClient.post<ApiSuccess<SaasPlan>>(`/platform/plans/${planId}/activate`);
  return data.data;
}

export async function archiveSaasPlan(planId: string): Promise<SaasPlan> {
  const { data } = await apiClient.post<ApiSuccess<SaasPlan>>(`/platform/plans/${planId}/archive`);
  return data.data;
}
