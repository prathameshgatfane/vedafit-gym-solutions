import { apiClient, type ApiPaginated, type ApiSuccess } from "../../lib/api-client";
import type { Membership, MembershipListParams } from "./membership.types";

export interface MembershipPage {
  items: Membership[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

function path(organizationId: string, suffix = ""): string {
  return `/organizations/${organizationId}/memberships${suffix}`;
}

/** Empty filters are dropped rather than sent blank, so the URL says what it means. */
function toQuery(
  params: MembershipListParams,
  extra: { memberId?: string } = {},
): Record<string, string | number> {
  const query: Record<string, string | number> = {
    page: params.page,
    limit: params.limit,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  };
  if (params.search.trim()) query.search = params.search.trim();
  if (params.status) query.status = params.status;
  if (extra.memberId) query.memberId = extra.memberId;
  return query;
}

export async function listMemberships(
  organizationId: string,
  params: MembershipListParams,
  extra: { memberId?: string } = {},
): Promise<MembershipPage> {
  const { data } = await apiClient.get<ApiPaginated<Membership>>(path(organizationId), {
    params: toQuery(params, extra),
  });
  return { items: data.data, pagination: data.pagination };
}

export async function getMembership(
  organizationId: string,
  membershipId: string,
): Promise<Membership> {
  const { data } = await apiClient.get<ApiSuccess<Membership>>(
    path(organizationId, `/${membershipId}`),
  );
  return data.data;
}

export async function createMembership(
  organizationId: string,
  input: { memberId: string; planId: string; startDate?: string },
): Promise<Membership> {
  const { data } = await apiClient.post<ApiSuccess<Membership>>(path(organizationId), {
    memberId: input.memberId,
    planId: input.planId,
    // Omitted rather than sent blank so the API applies its own "starts today" default.
    startDate: input.startDate || undefined,
  });
  return data.data;
}

/** Returns a *new* membership row — renewal never edits the term it was called on (1.15.3). */
export async function renewMembership(
  organizationId: string,
  membershipId: string,
  planId?: string,
): Promise<Membership> {
  const { data } = await apiClient.post<ApiSuccess<Membership>>(
    path(organizationId, `/${membershipId}/renew`),
    planId ? { planId } : {},
  );
  return data.data;
}

/**
 * Mid-term switch: cancels the current term and starts the new plan today. `forfeitedDays` is the
 * unused time given up — proration is deferred (1.15.4), so it is reported, not credited.
 */
export async function changeMembershipPlan(
  organizationId: string,
  membershipId: string,
  planId: string,
): Promise<{ membership: Membership; forfeitedDays: number }> {
  const { data } = await apiClient.post<ApiSuccess<Membership> & { meta: { forfeitedDays: number } }>(
    path(organizationId, `/${membershipId}/change-plan`),
    { planId },
  );
  return { membership: data.data, forfeitedDays: data.meta.forfeitedDays };
}

export type MembershipAction = "freeze" | "unfreeze" | "cancel";

export async function runMembershipAction(
  organizationId: string,
  membershipId: string,
  action: MembershipAction,
): Promise<Membership> {
  const { data } = await apiClient.post<ApiSuccess<Membership>>(
    path(organizationId, `/${membershipId}/${action}`),
    {},
  );
  return data.data;
}
