import { apiClient, type ApiPaginated, type ApiSuccess } from "../../lib/api-client";
import type { PlanFormValues } from "./plan.schema";
import type { MembershipPlan, PlanListParams } from "./plan.types";

export interface PlanPage {
  items: MembershipPlan[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

function plansPath(organizationId: string, suffix = ""): string {
  return `/organizations/${organizationId}/membership-plans${suffix}`;
}

/** Empty filters are dropped rather than sent blank, so the URL says what it means. */
function toQuery(params: PlanListParams): Record<string, string | number> {
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

/** The form holds text; the API wants numbers. One place converts, so no screen does it ad hoc. */
function toPayload(values: PlanFormValues) {
  return {
    name: values.name,
    price: Number(values.price),
    durationDays: Number(values.durationDays),
    status: values.status,
  };
}

export async function listPlans(
  organizationId: string,
  params: PlanListParams,
): Promise<PlanPage> {
  const { data } = await apiClient.get<ApiPaginated<MembershipPlan>>(plansPath(organizationId), {
    params: toQuery(params),
  });
  return { items: data.data, pagination: data.pagination };
}

/**
 * The catalog a sale can actually pick from. Kept separate from the paginated list because a
 * plan picker wants every sellable plan at once, not page 1 of the admin table.
 */
export async function listSellablePlans(organizationId: string): Promise<MembershipPlan[]> {
  const { data } = await apiClient.get<ApiPaginated<MembershipPlan>>(plansPath(organizationId), {
    params: { status: "ACTIVE", limit: 100, sortBy: "name", sortOrder: "asc" },
  });
  return data.data;
}

export async function getPlan(organizationId: string, planId: string): Promise<MembershipPlan> {
  const { data } = await apiClient.get<ApiSuccess<MembershipPlan>>(
    plansPath(organizationId, `/${planId}`),
  );
  return data.data;
}

export async function createPlan(
  organizationId: string,
  values: PlanFormValues,
): Promise<MembershipPlan> {
  const { data } = await apiClient.post<ApiSuccess<MembershipPlan>>(
    plansPath(organizationId),
    toPayload(values),
  );
  return data.data;
}

export async function updatePlan(
  organizationId: string,
  planId: string,
  values: PlanFormValues,
): Promise<MembershipPlan> {
  const { data } = await apiClient.patch<ApiSuccess<MembershipPlan>>(
    plansPath(organizationId, `/${planId}`),
    toPayload(values),
  );
  return data.data;
}

/** Retiring a plan stops new sales; it never touches memberships already sold from it. */
export async function setPlanStatus(
  organizationId: string,
  planId: string,
  status: "ACTIVE" | "INACTIVE",
): Promise<MembershipPlan> {
  const { data } = await apiClient.patch<ApiSuccess<MembershipPlan>>(
    plansPath(organizationId, `/${planId}`),
    { status },
  );
  return data.data;
}
