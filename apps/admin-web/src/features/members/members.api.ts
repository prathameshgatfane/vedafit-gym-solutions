import { apiClient, type ApiPaginated, type ApiSuccess } from "../../lib/api-client";
import type { MemberFormValues } from "./member.schema";
import type { Member, MemberListParams } from "./member.types";

export interface MemberPage {
  items: Member[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

function membersPath(organizationId: string, suffix = ""): string {
  return `/organizations/${organizationId}/members${suffix}`;
}

/** Empty filters are dropped rather than sent blank, so the URL says what it means. */
function toQuery(params: MemberListParams): Record<string, string | number> {
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

export async function listMembers(
  organizationId: string,
  params: MemberListParams,
): Promise<MemberPage> {
  const { data } = await apiClient.get<ApiPaginated<Member>>(membersPath(organizationId), {
    params: toQuery(params),
  });
  return { items: data.data, pagination: data.pagination };
}

export async function getMember(organizationId: string, memberId: string): Promise<Member> {
  const { data } = await apiClient.get<ApiSuccess<Member>>(
    membersPath(organizationId, `/${memberId}`),
  );
  return data.data;
}

/** Blank optional fields become `undefined` on create and `null` on edit — see below. */
function toCreatePayload(values: MemberFormValues) {
  return {
    firstName: values.firstName,
    lastName: values.lastName,
    phone: values.phone,
    branchId: values.branchId,
    email: values.email || undefined,
    dateOfBirth: values.dateOfBirth || undefined,
  };
}

export async function createMember(
  organizationId: string,
  values: MemberFormValues,
): Promise<Member> {
  const { data } = await apiClient.post<ApiSuccess<Member>>(
    membersPath(organizationId),
    toCreatePayload(values),
  );
  return data.data;
}

export async function updateMember(
  organizationId: string,
  memberId: string,
  values: MemberFormValues,
): Promise<Member> {
  const { data } = await apiClient.patch<ApiSuccess<Member>>(
    membersPath(organizationId, `/${memberId}`),
    {
      firstName: values.firstName,
      lastName: values.lastName,
      phone: values.phone,
      branchId: values.branchId,
      // On edit, an emptied field is an instruction to clear the value, so it must be an explicit
      // `null`. `undefined` would mean "leave it alone" and the change would silently not stick.
      email: values.email || null,
      dateOfBirth: values.dateOfBirth || null,
    },
  );
  return data.data;
}

export async function archiveMember(
  organizationId: string,
  memberId: string,
): Promise<Member> {
  const { data } = await apiClient.post<ApiSuccess<Member>>(
    membersPath(organizationId, `/${memberId}/archive`),
    {},
  );
  return data.data;
}
