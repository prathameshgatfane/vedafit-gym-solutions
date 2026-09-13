import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useSessionStore } from "../../stores/session.store";
import {
  createPlan,
  getPlan,
  listPlans,
  listSellablePlans,
  setPlanStatus,
  updatePlan,
  type PlanPage,
} from "./plans.api";
import type { PlanFormValues } from "./plan.schema";
import type { MembershipPlan, PlanListParams } from "./plan.types";

/** Scoped by organization id so switching tenants can never serve another org's cached rows. */
export const planKeys = {
  all: (organizationId: string) => ["membership-plans", organizationId] as const,
  list: (organizationId: string, params: PlanListParams) =>
    ["membership-plans", organizationId, "list", params] as const,
  sellable: (organizationId: string) =>
    ["membership-plans", organizationId, "sellable"] as const,
  detail: (organizationId: string, planId: string) =>
    ["membership-plans", organizationId, "detail", planId] as const,
};

function useOrganizationId(): string {
  const organizationId = useSessionStore((s) => s.organization?.id);
  // Every plans screen sits behind ProtectedRoute, so the session is always populated here.
  return organizationId ?? "";
}

export function usePlanList(params: PlanListParams): UseQueryResult<PlanPage> {
  const organizationId = useOrganizationId();

  return useQuery({
    queryKey: planKeys.list(organizationId, params),
    queryFn: () => listPlans(organizationId, params),
    enabled: organizationId !== "",
    placeholderData: keepPreviousData,
  });
}

/** The plan picker's data source — every sellable plan, not a page of the admin table. */
export function useSellablePlans(): UseQueryResult<MembershipPlan[]> {
  const organizationId = useOrganizationId();

  return useQuery({
    queryKey: planKeys.sellable(organizationId),
    queryFn: () => listSellablePlans(organizationId),
    enabled: organizationId !== "",
  });
}

export function usePlan(planId: string | undefined): UseQueryResult<MembershipPlan> {
  const organizationId = useOrganizationId();

  return useQuery({
    queryKey: planKeys.detail(organizationId, planId ?? ""),
    queryFn: () => getPlan(organizationId, planId!),
    enabled: organizationId !== "" && Boolean(planId),
  });
}

export function useCreatePlan(): UseMutationResult<MembershipPlan, unknown, PlanFormValues> {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (values: PlanFormValues) => createPlan(organizationId, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: planKeys.all(organizationId) });
    },
  });
}

export function useUpdatePlan(
  planId: string,
): UseMutationResult<MembershipPlan, unknown, PlanFormValues> {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (values: PlanFormValues) => updatePlan(organizationId, planId, values),
    onSuccess: (plan) => {
      queryClient.setQueryData(planKeys.detail(organizationId, planId), plan);
      void queryClient.invalidateQueries({ queryKey: planKeys.all(organizationId) });
    },
  });
}

export function useSetPlanStatus(): UseMutationResult<
  MembershipPlan,
  unknown,
  { planId: string; status: "ACTIVE" | "INACTIVE" }
> {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ planId, status }: { planId: string; status: "ACTIVE" | "INACTIVE" }) =>
      setPlanStatus(organizationId, planId, status),
    onSuccess: (plan) => {
      queryClient.setQueryData(planKeys.detail(organizationId, plan.id), plan);
      void queryClient.invalidateQueries({ queryKey: planKeys.all(organizationId) });
    },
  });
}
