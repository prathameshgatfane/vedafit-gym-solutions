import { apiClient, type ApiPaginated, type ApiSuccess } from "../../lib/api-client";
import type { TrainerFormValues } from "./trainer.schema";
import type {
  TrainerCandidate,
  TrainerListParams,
  TrainerProfile,
} from "./trainer.types";

export interface TrainerPage {
  items: TrainerProfile[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

function trainersPath(organizationId: string, suffix = ""): string {
  return `/organizations/${organizationId}/trainers${suffix}`;
}

function toQuery(params: TrainerListParams): Record<string, string | number> {
  const query: Record<string, string | number> = {
    page: params.page,
    limit: params.limit,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  };
  if (params.search.trim()) query.search = params.search.trim();
  return query;
}

function toPayload(values: TrainerFormValues, mode: "create" | "edit") {
  const specialization = values.specialization.trim();
  const commission =
    values.commissionPct.trim() === "" ? null : Number(values.commissionPct);
  return {
    ...(mode === "create" ? { userId: values.userId } : {}),
    specialization: specialization === "" ? null : specialization,
    commissionPct: commission,
  };
}

export async function listTrainers(
  organizationId: string,
  params: TrainerListParams,
): Promise<TrainerPage> {
  const { data } = await apiClient.get<ApiPaginated<TrainerProfile>>(
    trainersPath(organizationId),
    { params: toQuery(params) },
  );
  return { items: data.data, pagination: data.pagination };
}

export async function listTrainerCandidates(
  organizationId: string,
): Promise<TrainerCandidate[]> {
  const { data } = await apiClient.get<ApiSuccess<TrainerCandidate[]>>(
    trainersPath(organizationId, "/candidates"),
  );
  return data.data;
}

export async function getTrainer(
  organizationId: string,
  trainerId: string,
): Promise<TrainerProfile> {
  const { data } = await apiClient.get<ApiSuccess<TrainerProfile>>(
    trainersPath(organizationId, `/${trainerId}`),
  );
  return data.data;
}

export async function createTrainer(
  organizationId: string,
  values: TrainerFormValues,
): Promise<TrainerProfile> {
  const { data } = await apiClient.post<ApiSuccess<TrainerProfile>>(
    trainersPath(organizationId),
    toPayload(values, "create"),
  );
  return data.data;
}

export async function updateTrainer(
  organizationId: string,
  trainerId: string,
  values: TrainerFormValues,
): Promise<TrainerProfile> {
  const { data } = await apiClient.patch<ApiSuccess<TrainerProfile>>(
    trainersPath(organizationId, `/${trainerId}`),
    toPayload(values, "edit"),
  );
  return data.data;
}

export async function assignTrainerMember(
  organizationId: string,
  trainerId: string,
  memberId: string,
): Promise<TrainerProfile> {
  const { data } = await apiClient.post<ApiSuccess<TrainerProfile>>(
    trainersPath(organizationId, `/${trainerId}/members`),
    { memberId },
  );
  return data.data;
}

export async function unassignTrainerMember(
  organizationId: string,
  trainerId: string,
  memberId: string,
): Promise<TrainerProfile> {
  const { data } = await apiClient.delete<ApiSuccess<TrainerProfile>>(
    trainersPath(organizationId, `/${trainerId}/members/${memberId}`),
  );
  return data.data;
}
