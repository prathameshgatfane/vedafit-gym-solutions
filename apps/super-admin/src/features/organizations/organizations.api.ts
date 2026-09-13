import { apiClient, type ApiPaginated, type ApiSuccess } from "../../lib/api-client";
import type {
  CreatedOrganization,
  OrganizationDetail,
  OrganizationListItem,
  OrganizationListQuery,
  OrganizationStatus,
  SubscriptionPatchInput,
} from "./organization.types";
import type { CreateOrganizationFormValues } from "./organization.schema";

export async function listOrganizations(query: OrganizationListQuery) {
  const { data } = await apiClient.get<ApiPaginated<OrganizationListItem>>(
    "/platform/organizations",
    {
      params: {
        page: query.page,
        limit: query.limit,
        search: query.search || undefined,
        status: query.status,
        sortBy: query.sortBy,
        sortOrder: query.sortOrder,
      },
    },
  );
  return { items: data.data, pagination: data.pagination };
}

export async function getOrganization(organizationId: string): Promise<OrganizationDetail> {
  const { data } = await apiClient.get<ApiSuccess<OrganizationDetail>>(
    `/platform/organizations/${organizationId}`,
  );
  return data.data;
}

export async function createOrganization(
  values: CreateOrganizationFormValues,
): Promise<CreatedOrganization> {
  const body = {
    name: values.name,
    slug: values.slug,
    email: values.email,
    ...(values.phone ? { phone: values.phone } : {}),
    ...(values.timezone ? { timezone: values.timezone } : {}),
    ...(values.branchName ? { branchName: values.branchName } : {}),
    owner: {
      name: values.ownerName,
      email: values.ownerEmail,
      password: values.ownerPassword,
    },
  };
  const { data } = await apiClient.post<ApiSuccess<CreatedOrganization>>(
    "/platform/organizations",
    body,
  );
  return data.data;
}

export async function updateOrganizationStatus(
  organizationId: string,
  status: OrganizationStatus,
) {
  const { data } = await apiClient.patch<ApiSuccess<{ id: string; status: OrganizationStatus }>>(
    `/platform/organizations/${organizationId}/status`,
    { status },
  );
  return data.data;
}

export async function updateOrganizationSubscription(
  organizationId: string,
  input: SubscriptionPatchInput,
) {
  const { data } = await apiClient.patch<
    ApiSuccess<{
      organization: { id: string; status: OrganizationStatus };
      subscription: OrganizationDetail["subscription"];
    }>
  >(`/platform/organizations/${organizationId}/subscription`, input);
  return data.data;
}
