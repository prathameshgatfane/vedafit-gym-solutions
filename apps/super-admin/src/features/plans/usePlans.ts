import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  activateSaasPlan,
  archiveSaasPlan,
  createSaasPlan,
  getSaasPlan,
  listSaasPlans,
  updateSaasPlan,
} from "./plans.api";
import type { CreateSaasPlanInput, UpdateSaasPlanInput } from "./plan.types";

export const planKeys = {
  all: ["platform", "plans"] as const,
  detail: (id: string) => [...planKeys.all, "detail", id] as const,
};

export function usePlans() {
  return useQuery({
    queryKey: planKeys.all,
    queryFn: listSaasPlans,
  });
}

export function usePlan(planId: string | undefined) {
  return useQuery({
    queryKey: planKeys.detail(planId ?? ""),
    queryFn: () => getSaasPlan(planId!),
    enabled: Boolean(planId),
  });
}

function useInvalidatePlans() {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: planKeys.all });
  };
}

export function useCreatePlan() {
  const invalidate = useInvalidatePlans();
  return useMutation({
    mutationFn: (input: CreateSaasPlanInput) => createSaasPlan(input),
    onSuccess: invalidate,
  });
}

export function useUpdatePlan(planId: string) {
  const invalidate = useInvalidatePlans();
  return useMutation({
    mutationFn: (input: UpdateSaasPlanInput) => updateSaasPlan(planId, input),
    onSuccess: invalidate,
  });
}

export function useActivatePlan() {
  const invalidate = useInvalidatePlans();
  return useMutation({
    mutationFn: (planId: string) => activateSaasPlan(planId),
    onSuccess: invalidate,
  });
}

export function useArchivePlan() {
  const invalidate = useInvalidatePlans();
  return useMutation({
    mutationFn: (planId: string) => archiveSaasPlan(planId),
    onSuccess: invalidate,
  });
}
