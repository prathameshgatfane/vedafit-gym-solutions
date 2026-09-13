import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useCallback } from "react";
import { useSessionStore } from "../../stores/session.store";
import {
  fetchToday,
  listAttendance,
  markAttendance,
  type AttendanceFilters,
  type AttendancePage,
  type MarkAttendanceResult,
} from "./attendance.api";

export const attendanceKeys = {
  all: (organizationId: string) => ["attendance", organizationId] as const,
  list: (organizationId: string, params: unknown) =>
    ["attendance", organizationId, "list", params] as const,
  today: (organizationId: string, branchId: string) =>
    ["attendance", organizationId, "today", branchId] as const,
};

function useOrganizationId(): string {
  const organizationId = useSessionStore((s) => s.organization?.id);
  return organizationId ?? "";
}

export function useAttendanceList(params: AttendanceFilters): UseQueryResult<AttendancePage> {
  const organizationId = useOrganizationId();

  return useQuery({
    queryKey: attendanceKeys.list(organizationId, params),
    queryFn: () => listAttendance(organizationId, params),
    enabled: organizationId !== "",
    placeholderData: keepPreviousData,
  });
}

/**
 * The gym's today and its current headcount. Asked of the server rather than computed here, so
 * the register agrees with the unique constraint about which day it is (1.17.4).
 */
export function useAttendanceToday(
  branchId?: string,
): UseQueryResult<{ date: string; count: number }> {
  const organizationId = useOrganizationId();

  return useQuery({
    queryKey: attendanceKeys.today(organizationId, branchId ?? ""),
    queryFn: () => fetchToday(organizationId, branchId),
    enabled: organizationId !== "",
  });
}

export function useInvalidateAttendance(): () => void {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();

  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: attendanceKeys.all(organizationId) });
  }, [queryClient, organizationId]);
}

export function useMarkAttendance(): UseMutationResult<
  MarkAttendanceResult,
  unknown,
  { memberId: string; branchId?: string; override?: boolean }
> {
  const organizationId = useOrganizationId();
  const invalidate = useInvalidateAttendance();

  return useMutation({
    mutationFn: (input: { memberId: string; branchId?: string; override?: boolean }) =>
      markAttendance(organizationId, input),
    // Invalidated even on a repeat check-in: the headcount may have moved for other reasons
    // while the desk was looking at a stale one.
    onSuccess: () => invalidate(),
  });
}
