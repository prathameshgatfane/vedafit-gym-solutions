import { apiClient, type ApiPaginated, type ApiSuccess } from "../../lib/api-client";
import type { ConvertLeadValues, LeadFormValues } from "./lead.schema";
import type { Lead, LeadAssignee, LeadListParams, LeadStatus } from "./lead.types";

export interface LeadPage {
  items: Lead[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

function leadsPath(organizationId: string, suffix = ""): string {
  return `/organizations/${organizationId}/leads${suffix}`;
}

function toQuery(params: LeadListParams): Record<string, string | number> {
  const query: Record<string, string | number> = {
    page: params.page,
    limit: params.limit,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  };
  if (params.search.trim()) query.search = params.search.trim();
  if (params.status) query.status = params.status;
  if (params.assignedToUserId) query.assignedToUserId = params.assignedToUserId;
  return query;
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function toPayload(values: LeadFormValues, mode: "create" | "edit") {
  const source = emptyToNull(values.source);
  const branchId = emptyToNull(values.branchId);
  const assignedToUserId = emptyToNull(values.assignedToUserId);
  const followUpAt = emptyToNull(values.followUpAt);

  if (mode === "create") {
    return {
      name: values.name.trim(),
      phone: values.phone.trim(),
      ...(source ? { source } : {}),
      ...(branchId ? { branchId } : {}),
      ...(assignedToUserId ? { assignedToUserId } : {}),
      ...(followUpAt ? { followUpAt } : {}),
    };
  }

  return {
    name: values.name.trim(),
    phone: values.phone.trim(),
    source,
    branchId,
    assignedToUserId,
    followUpAt,
  };
}

export async function listLeads(
  organizationId: string,
  params: LeadListParams,
): Promise<LeadPage> {
  const { data } = await apiClient.get<ApiPaginated<Lead>>(leadsPath(organizationId), {
    params: toQuery(params),
  });
  return { items: data.data, pagination: data.pagination };
}

export async function listLeadAssignees(organizationId: string): Promise<LeadAssignee[]> {
  const { data } = await apiClient.get<ApiSuccess<LeadAssignee[]>>(
    leadsPath(organizationId, "/assignees"),
  );
  return data.data;
}

export async function getLead(organizationId: string, leadId: string): Promise<Lead> {
  const { data } = await apiClient.get<ApiSuccess<Lead>>(leadsPath(organizationId, `/${leadId}`));
  return data.data;
}

export async function createLead(
  organizationId: string,
  values: LeadFormValues,
): Promise<Lead> {
  const { data } = await apiClient.post<ApiSuccess<Lead>>(
    leadsPath(organizationId),
    toPayload(values, "create"),
  );
  return data.data;
}

export async function updateLead(
  organizationId: string,
  leadId: string,
  values: LeadFormValues,
): Promise<Lead> {
  const { data } = await apiClient.patch<ApiSuccess<Lead>>(
    leadsPath(organizationId, `/${leadId}`),
    toPayload(values, "edit"),
  );
  return data.data;
}

export async function transitionLead(
  organizationId: string,
  leadId: string,
  status: LeadStatus,
): Promise<Lead> {
  const { data } = await apiClient.patch<ApiSuccess<Lead>>(
    leadsPath(organizationId, `/${leadId}`),
    { status },
  );
  return data.data;
}

export async function convertLead(
  organizationId: string,
  leadId: string,
  values: ConvertLeadValues,
): Promise<Lead> {
  const { data } = await apiClient.post<ApiSuccess<Lead>>(
    leadsPath(organizationId, `/${leadId}/convert`),
    {
      firstName: values.firstName.trim(),
      lastName: values.lastName.trim(),
      branchId: values.branchId,
      email: values.email.trim() === "" ? undefined : values.email.trim(),
    },
  );
  return data.data;
}
