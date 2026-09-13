import { useQuery } from "@tanstack/react-query";
import { listSaasPlans } from "./plans.api";

export function usePlans() {
  return useQuery({
    queryKey: ["platform", "plans"],
    queryFn: listSaasPlans,
  });
}
