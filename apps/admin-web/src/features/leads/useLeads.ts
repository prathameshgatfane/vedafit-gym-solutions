import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useSessionStore } from "../../stores/session.store";
import { memberKeys } from "../members/useMembers";
import {
  convertLead,
  createLead,
  getLead,
  listLeadAssignees,
  listLeads,
  transitionLead,
  updateLead,
  type LeadPage,
} from "./leads.api";
import type { ConvertLeadValues, LeadFormValues } from "./lead.schema";
import type { Lead, LeadAssignee, LeadListParams, LeadStatus } from "./lead.types";

export const leadKeys = {
  all: (organizationId: string) => ["leads", organizationId] as const,
  list: (organizationId: string, params: LeadListParams) =>
    ["leads", organizationId, "list", params] as const,
  assignees: (organizationId: string) => ["leads", organizationId, "assignees"] as const,
  detail: (organizationId: string, leadId: string) =>
    ["leads", organizationId, "detail", leadId] as const,
};

function useOrganizationId(): string {
  const organizationId = useSessionStore((s) => s.organization?.id);
  return organizationId ?? "";
}

export function useLeadList(params: LeadListParams): UseQueryResult<LeadPage> {
  const organizationId = useOrganizationId();

  return useQuery({
    queryKey: leadKeys.list(organizationId, params),
    queryFn: () => listLeads(organizationId, params),
    enabled: organizationId !== "",
    placeholderData: keepPreviousData,
  });
}

export function useLeadAssignees(): UseQueryResult<LeadAssignee[]> {
  const organizationId = useOrganizationId();

  return useQuery({
    queryKey: leadKeys.assignees(organizationId),
    queryFn: () => listLeadAssignees(organizationId),
    enabled: organizationId !== "",
  });
}

export function useLead(leadId: string | undefined): UseQueryResult<Lead> {
  const organizationId = useOrganizationId();

  return useQuery({
    queryKey: leadKeys.detail(organizationId, leadId ?? ""),
    queryFn: () => getLead(organizationId, leadId!),
    enabled: organizationId !== "" && Boolean(leadId),
  });
}

function invalidateLeadCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  organizationId: string,
  lead?: Lead,
) {
  void queryClient.invalidateQueries({ queryKey: leadKeys.all(organizationId) });
  if (lead) {
    queryClient.setQueryData(leadKeys.detail(organizationId, lead.id), lead);
  }
}

export function useCreateLead(): UseMutationResult<Lead, unknown, LeadFormValues> {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (values: LeadFormValues) => createLead(organizationId, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: leadKeys.all(organizationId) });
    },
  });
}

export function useUpdateLead(
  leadId: string,
): UseMutationResult<Lead, unknown, LeadFormValues> {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (values: LeadFormValues) => updateLead(organizationId, leadId, values),
    onSuccess: (lead) => invalidateLeadCaches(queryClient, organizationId, lead),
  });
}

export function useTransitionLead(
  leadId: string,
): UseMutationResult<Lead, unknown, LeadStatus> {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (status: LeadStatus) => transitionLead(organizationId, leadId, status),
    onSuccess: (lead) => invalidateLeadCaches(queryClient, organizationId, lead),
  });
}

export function useConvertLead(
  leadId: string,
): UseMutationResult<Lead, unknown, ConvertLeadValues> {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (values: ConvertLeadValues) => convertLead(organizationId, leadId, values),
    onSuccess: (lead) => {
      invalidateLeadCaches(queryClient, organizationId, lead);
      void queryClient.invalidateQueries({ queryKey: memberKeys.all(organizationId) });
    },
  });
}
