import type { ListParams } from "../../lib/url-list-params";

/** Why a visit was recorded without a covering membership (Locked Decision 1.17.1). */
export type AttendanceOverrideReason =
  | "NO_MEMBERSHIP"
  | "EXPIRED"
  | "FROZEN"
  | "CANCELLED"
  | "NOT_STARTED";

/** Mirrors `AttendanceResponse` in apps/api/src/modules/attendance/attendance.service.ts. */
export interface Attendance {
  id: string;
  organizationId: string;
  branchId: string;
  memberId: string;
  membershipId: string | null;
  checkedInAt: string;
  /** `YYYY-MM-DD` in the gym's timezone — the day this counts as, not the browser's (1.17.4). */
  attendanceDate: string;
  overrideReason: AttendanceOverrideReason | null;
  isOverride: boolean;
  markedByUserId: string | null;
  member: { id: string; firstName: string; lastName: string; phone: string };
  branch: { id: string; name: string };
  membership: { id: string; startDate: string; endDate: string; status: string } | null;
  markedBy: { id: string; name: string } | null;
}

export type AttendanceSortField = "checkedInAt" | "attendanceDate";

/**
 * Attendance has no status enum of its own — a check-in either happened or didn't. The slot is
 * filled with `never` so the shared list hook still type-checks, and the register's own filters
 * (date, branch, overrides-only) travel as extra URL keys instead.
 */
export type AttendanceListParams = ListParams<AttendanceSortField, never>;

export const DEFAULT_ATTENDANCE_LIST_PARAMS: AttendanceListParams = {
  page: 1,
  limit: 20,
  search: "",
  status: "",
  sortBy: "checkedInAt",
  sortOrder: "desc",
};

export type AttendanceExtraKey = "date" | "branchId" | "overridesOnly";

const OVERRIDE_LABELS: Record<AttendanceOverrideReason, string> = {
  NO_MEMBERSHIP: "No membership",
  EXPIRED: "Expired",
  FROZEN: "Frozen",
  CANCELLED: "Cancelled",
  NOT_STARTED: "Not started",
};

export function overrideLabel(reason: AttendanceOverrideReason): string {
  return OVERRIDE_LABELS[reason];
}

/** The time of day a member arrived, which is the only part of the instant the register shows. */
export function formatCheckInTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

/** `YYYY-MM-DD` → "Monday, 7 September 2026", for a heading nobody has to decode. */
export function formatRegisterDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;

  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00.000Z`));
}
