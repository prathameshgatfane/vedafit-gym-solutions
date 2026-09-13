import { apiClient, type ApiPaginated, type ApiSuccess } from "../../lib/api-client";
import type { Attendance, AttendanceListParams } from "./attendance.types";

export interface AttendancePage {
  items: Attendance[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

function path(organizationId: string, suffix = ""): string {
  return `/organizations/${organizationId}/attendance${suffix}`;
}

export type AttendanceFilters = AttendanceListParams & {
  memberId?: string;
  branchId?: string;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  overridesOnly?: boolean;
};

function toQuery(params: AttendanceFilters) {
  const query: Record<string, string | number> = {
    page: params.page,
    limit: params.limit,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  };
  if (params.search.trim()) query.search = params.search.trim();
  if (params.memberId) query.memberId = params.memberId;
  if (params.branchId) query.branchId = params.branchId;
  if (params.date) query.date = params.date;
  if (params.dateFrom) query.dateFrom = params.dateFrom;
  if (params.dateTo) query.dateTo = params.dateTo;
  if (params.overridesOnly) query.overridesOnly = "true";
  return query;
}

export async function listAttendance(
  organizationId: string,
  params: AttendanceFilters,
): Promise<AttendancePage> {
  const { data } = await apiClient.get<ApiPaginated<Attendance>>(path(organizationId), {
    params: toQuery(params),
  });
  return { items: data.data, pagination: data.pagination };
}

/** Today's date and headcount as the *server* reckons them — see 1.17.4 on whose clock counts. */
export async function fetchToday(
  organizationId: string,
  branchId?: string,
): Promise<{ date: string; count: number }> {
  const { data } = await apiClient.get<ApiSuccess<{ date: string; count: number }>>(
    path(organizationId, "/today"),
    { params: branchId ? { branchId } : undefined },
  );
  return data.data;
}

export interface MarkAttendanceResult {
  attendance: Attendance;
  /** The member was already in today's register; nothing new was written (1.17.2). */
  alreadyCheckedIn: boolean;
}

/**
 * Records a check-in. Without `override`, a member no membership covers is refused with 409
 * `MEMBERSHIP_NOT_ACTIVE` — the caller is expected to ask a human and try again saying so
 * (1.17.1). Passing `override: true` speculatively would defeat the point of the refusal.
 */
export async function markAttendance(
  organizationId: string,
  input: { memberId: string; branchId?: string; override?: boolean },
): Promise<MarkAttendanceResult> {
  const { data } = await apiClient.post<ApiSuccess<MarkAttendanceResult>>(
    path(organizationId),
    input,
  );
  return data.data;
}
