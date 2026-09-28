import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listSaasPlans } from "../plans/plans.api";
import {
  createOrganization,
  getOrganization,
  getOrganizationUsage,
  listOrganizations,
  updateOrganizationStatus,
  updateOrganizationSubscription,
} from "./organizations.api";
import type {
  OrganizationListQuery,
  OrganizationStatus,
  SubscriptionPatchInput,
} from "./organization.types";

export const organizationKeys = {
  all: ["platform", "organizations"] as const,
  list: (query: OrganizationListQuery) => [...organizationKeys.all, "list", query] as const,
  detail: (id: string) => [...organizationKeys.all, "detail", id] as const,
  usage: (id: string) => [...organizationKeys.all, "usage", id] as const,
};

export function useOrganizationList(query: OrganizationListQuery) {
  return useQuery({
    queryKey: organizationKeys.list(query),
    queryFn: () => listOrganizations(query),
  });
}

export function useOrganization(organizationId: string | undefined) {
  return useQuery({
    queryKey: organizationKeys.detail(organizationId ?? ""),
    queryFn: () => getOrganization(organizationId!),
    enabled: Boolean(organizationId),
  });
}

export function useOrganizationUsage(organizationId: string | undefined) {
  return useQuery({
    queryKey: organizationKeys.usage(organizationId ?? ""),
    queryFn: () => getOrganizationUsage(organizationId!),
    enabled: Boolean(organizationId),
  });
}

export function useCreateOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createOrganization,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: organizationKeys.all });
      await queryClient.invalidateQueries({ queryKey: ["platform", "dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["platform", "plans"] });
    },
  });
}

export function useUpdateOrganizationStatus(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (status: OrganizationStatus) =>
      updateOrganizationStatus(organizationId, status),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: organizationKeys.all });
      await queryClient.invalidateQueries({ queryKey: ["platform", "dashboard"] });
    },
  });
}

export function useUpdateOrganizationSubscription(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SubscriptionPatchInput) =>
      updateOrganizationSubscription(organizationId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: organizationKeys.all });
      await queryClient.invalidateQueries({ queryKey: ["platform", "dashboard"] });
    },
  });
}

export function useSaasPlanOptions() {
  return useQuery({
    queryKey: ["platform", "plans"],
    queryFn: listSaasPlans,
  });
}
