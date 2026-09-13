import { useQuery } from "@tanstack/react-query";
import { fetchDashboard } from "./dashboard.api";

export function useDashboard() {
  return useQuery({
    queryKey: ["platform", "dashboard"],
    queryFn: fetchDashboard,
  });
}
