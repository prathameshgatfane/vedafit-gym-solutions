import { Prisma, type AttendanceOverrideReason } from "@prisma/client";
import { AppError } from "../../lib/app-error";
import { ErrorCode } from "../../lib/error-codes";
import { prisma, withGeneratedId, type TransactionClient } from "../../lib/prisma";
import {
  formatCalendarDate,
  localCalendarDate,
  parseCalendarDate,
  safeTimeZone,
} from "../../utils/dates";
import { buildPaginationMeta, paginationSkipTake } from "../../utils/pagination";
import { resolveOwnRoster, rosterAllows } from "../../lib/own-roster";
import type { ListAttendanceQuery, MarkAttendanceInput } from "./attendance.schema";

export interface AttendanceScope {
  organizationId: string;
  /** `null` for org-wide roles; otherwise every read and write is pinned to this branch. */
  branchId: string | null;
  /** The acting staff member, from the JWT. Recorded as `markedByUserId`. */
  userId: string;
  roleId: string;
}

const attendanceInclude = {
  member: { select: { id: true, firstName: true, lastName: true, phone: true } },
  branch: { select: { id: true, name: true } },
  membership: { select: { id: true, startDate: true, endDate: true, status: true } },
  markedBy: { select: { id: true, name: true } },
} satisfies Prisma.AttendanceInclude;

type AttendanceRow = Prisma.AttendanceGetPayload<{ include: typeof attendanceInclude }>;

export interface AttendanceResponse {
  id: string;
  organizationId: string;
  branchId: string;
  memberId: string;
  membershipId: string | null;
  checkedInAt: Date;
  /** `YYYY-MM-DD` in the organization's timezone — the day this visit counts as (1.17.4). */
  attendanceDate: string;
  overrideReason: AttendanceOverrideReason | null;
  /** Derived, so a client never has to know that "override" means "reason is not null". */
  isOverride: boolean;
  markedByUserId: string | null;
  member: AttendanceRow["member"];
  branch: AttendanceRow["branch"];
  membership: AttendanceRow["membership"];
  markedBy: AttendanceRow["markedBy"];
}

function toResponse(row: AttendanceRow): AttendanceResponse {
  return {
    id: row.id,
    organizationId: row.organizationId,
    branchId: row.branchId,
    memberId: row.memberId,
    membershipId: row.membershipId,
    checkedInAt: row.checkedInAt,
    attendanceDate: formatCalendarDate(row.attendanceDate),
    overrideReason: row.overrideReason,
    isOverride: row.overrideReason !== null,
    markedByUserId: row.markedByUserId,
    member: row.member,
    branch: row.branch,
    membership: row.membership,
    markedBy: row.markedBy,
  };
}

/**
 * The membership covering a member *on a given day*, and if none does, why not.
 *
 * "Covered" is `ACTIVE` and the day inside `[startDate, endDate]`. Everything else is an override
 * reason (1.17.1), and the reason is picked from the member's most relevant term rather than
 * defaulting to `NO_MEMBERSHIP` — the whole point of the enum is that "forgot to unfreeze" and
 * "never paid" are different conversations.
 *
 * Note what is deliberately *absent*: the Locked Decision 1.8 expiry sweep that every membership
 * read runs first. Attendance does not write to `memberships`, for two reasons. It doesn't need
 * to — the `startDate`/`endDate` predicate already refuses a lapsed term whatever its stored
 * status says, so a stale `ACTIVE` row cannot wave anyone through. And it must not: the sweep's
 * clock is `todayUtc()` (1.15) while `onDate` here is the gym's *local* day (1.17.4), and the two
 * disagree for the hours either side of UTC midnight. Sweeping on the local clock would expire
 * terms up to a day before the membership module thinks they end. Attendance reads memberships;
 * it does not get to retire them.
 */
async function resolveCoverage(
  tx: TransactionClient,
  organizationId: string,
  memberId: string,
  onDate: Date,
): Promise<
  | { covered: true; membershipId: string; reason: null }
  | { covered: false; membershipId: null; reason: AttendanceOverrideReason }
> {
  const covering = await tx.membership.findFirst({
    where: {
      organizationId,
      memberId,
      status: "ACTIVE",
      startDate: { lte: onDate },
      endDate: { gte: onDate },
    },
    orderBy: { endDate: "desc" },
  });

  if (covering) return { covered: true, membershipId: covering.id, reason: null };

  // Nothing covers today. A frozen term is the most actionable explanation, so it wins over a
  // stale expired one; then an early renewal that hasn't started; then whatever ended last.
  const frozen = await tx.membership.findFirst({
    where: { organizationId, memberId, status: "FROZEN" },
    orderBy: { updatedAt: "desc" },
  });
  if (frozen) return { covered: false, membershipId: null, reason: "FROZEN" };

  const upcoming = await tx.membership.findFirst({
    where: { organizationId, memberId, status: "ACTIVE", startDate: { gt: onDate } },
    orderBy: { startDate: "asc" },
  });
  if (upcoming) return { covered: false, membershipId: null, reason: "NOT_STARTED" };

  const latest = await tx.membership.findFirst({
    where: { organizationId, memberId },
    orderBy: { endDate: "desc" },
  });
  if (!latest) return { covered: false, membershipId: null, reason: "NO_MEMBERSHIP" };

  return {
    covered: false,
    membershipId: null,
    reason: latest.status === "CANCELLED" ? "CANCELLED" : "EXPIRED",
  };
}

/**
 * Locked Decision 1.17.3 — the branch a check-in is stamped with is the branch it happened at,
 * derived from the JWT and never guessed from the member's home branch.
 */
async function resolveBranchForWrite(
  tx: TransactionClient,
  scope: AttendanceScope,
  requested: string | undefined,
): Promise<string> {
  if (scope.branchId) {
    // Belt and braces: `tenantScope` already rejects a smuggled `branchId` with this same code
    // before a handler runs, so in practice nothing reaches here. Kept so the service is still
    // correct if it is ever called from a route that doesn't mount that middleware.
    if (requested && requested !== scope.branchId) {
      throw new AppError(
        403,
        ErrorCode.BRANCH_MISMATCH,
        "You can only record attendance at your own branch",
      );
    }
    return scope.branchId;
  }

  if (!requested) {
    throw new AppError(
      400,
      ErrorCode.BRANCH_REQUIRED,
      "Say which branch this check-in happened at",
    );
  }

  const branch = await tx.branch.findFirst({
    where: { id: requested, organizationId: scope.organizationId },
    select: { id: true },
  });
  if (!branch) {
    throw new AppError(404, ErrorCode.BRANCH_NOT_FOUND, `Branch "${requested}" not found`);
  }

  return branch.id;
}

async function findMemberOrThrow(tx: TransactionClient, scope: AttendanceScope, memberId: string) {
  const member = await tx.member.findFirst({
    where: {
      id: memberId,
      organizationId: scope.organizationId,
      deletedAt: null,
      ...(scope.branchId ? { branchId: scope.branchId } : {}),
    },
  });

  if (!member) {
    throw new AppError(404, ErrorCode.MEMBER_NOT_FOUND, `Member "${memberId}" not found`);
  }
  return member;
}

async function organizationTimeZone(
  client: TransactionClient | typeof prisma,
  organizationId: string,
): Promise<string> {
  const organization = await client.organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true },
  });
  return safeTimeZone(organization?.timezone);
}

/** Branch-scoped callers are pinned to their own branch even when they ask for another. */
function resolveBranchFilter(scope: AttendanceScope, requested?: string): string | undefined {
  return scope.branchId ?? requested;
}

export interface MarkAttendanceResult {
  attendance: AttendanceResponse;
  /** True when the request was a repeat of a check-in already recorded today (1.17.2). */
  alreadyCheckedIn: boolean;
}

export const attendanceService = {
  /**
   * Records a check-in.
   *
   * Two rules shape the whole method. A member with no covering membership is refused once with
   * `MEMBERSHIP_NOT_ACTIVE` and only recorded when the caller resubmits with `override` (1.17.1),
   * so the exception is always deliberate. And the second check-in of a day is not an error: it
   * returns the row already there, so a double-click is a no-op rather than a scary dialog
   * (1.17.2).
   */
  async mark(scope: AttendanceScope, input: MarkAttendanceInput): Promise<MarkAttendanceResult> {
    const timeZone = await organizationTimeZone(prisma, scope.organizationId);
    const checkedInAt = new Date();
    const attendanceDate = localCalendarDate(checkedInAt, timeZone);

    const result = await prisma.$transaction(async (tx) => {
      const member = await findMemberOrThrow(tx, scope, input.memberId);
      const branchId = await resolveBranchForWrite(tx, scope, input.branchId);

      // Checked before coverage rather than after: if they are already in today's register, the
      // membership question was settled at the first check-in and re-asking it could refuse a
      // duplicate that is really a no-op.
      const existing = await tx.attendance.findUnique({
        where: { memberId_attendanceDate: { memberId: member.id, attendanceDate } },
        include: attendanceInclude,
      });
      if (existing) return { row: existing, alreadyCheckedIn: true };

      const coverage = await resolveCoverage(tx, scope.organizationId, member.id, attendanceDate);

      if (!coverage.covered && !input.override) {
        throw new AppError(
          409,
          ErrorCode.MEMBERSHIP_NOT_ACTIVE,
          overrideMessage(coverage.reason, member.firstName),
          { reason: coverage.reason, memberId: member.id, requiresOverride: true },
        );
      }

      const row = await tx.attendance.create({
        data: withGeneratedId({
          organizationId: scope.organizationId,
          branchId,
          memberId: member.id,
          checkedInAt,
          attendanceDate,
          membershipId: coverage.membershipId,
          overrideReason: coverage.reason,
          markedByUserId: scope.userId,
        }),
        include: attendanceInclude,
      });

      return { row, alreadyCheckedIn: false };
    });

    return {
      attendance: toResponse(result.row),
      alreadyCheckedIn: result.alreadyCheckedIn,
    };
  },

  async list(
    scope: AttendanceScope,
    query: ListAttendanceQuery,
  ): Promise<{ items: AttendanceResponse[]; pagination: ReturnType<typeof buildPaginationMeta> }> {
    const roster = await resolveOwnRoster(scope);
    if (roster.restricted && roster.memberIds.length === 0) {
      return { items: [], pagination: buildPaginationMeta(query.page, query.limit, 0) };
    }
    if (roster.restricted && query.memberId && !roster.memberIds.includes(query.memberId)) {
      return { items: [], pagination: buildPaginationMeta(query.page, query.limit, 0) };
    }

    const where: Prisma.AttendanceWhereInput = {
      organizationId: scope.organizationId,
      branchId: resolveBranchFilter(scope, query.branchId),
      memberId: query.memberId ?? (roster.restricted ? { in: roster.memberIds } : undefined),
      attendanceDate: dateFilter(query),
      // `NOT: null` rather than a boolean column, since 1.17.1 stores the *reason*.
      overrideReason: query.overridesOnly ? { not: null } : undefined,
      member: query.search
        ? {
            OR: [
              { firstName: { contains: query.search } },
              { lastName: { contains: query.search } },
              { phone: { contains: query.search } },
            ],
          }
        : undefined,
    };

    const [rows, total] = await Promise.all([
      prisma.attendance.findMany({
        where,
        include: attendanceInclude,
        orderBy: { [query.sortBy]: query.sortOrder },
        ...paginationSkipTake(query),
      }),
      prisma.attendance.count({ where }),
    ]);

    return {
      items: rows.map(toResponse),
      pagination: buildPaginationMeta(query.page, query.limit, total),
    };
  },

  async getById(scope: AttendanceScope, attendanceId: string): Promise<AttendanceResponse> {
    const roster = await resolveOwnRoster(scope);
    const row = await prisma.attendance.findFirst({
      where: {
        id: attendanceId,
        organizationId: scope.organizationId,
        branchId: scope.branchId ?? undefined,
      },
      include: attendanceInclude,
    });

    if (!row || !rosterAllows(roster, row.memberId)) {
      throw new AppError(
        404,
        ErrorCode.ATTENDANCE_NOT_FOUND,
        `Attendance "${attendanceId}" not found`,
      );
    }
    return toResponse(row);
  },

  /**
   * What the check-in screen needs before anyone presses anything: today's date in the gym's own
   * timezone, and how many are already in. Returned from the server rather than computed in the
   * browser, because the browser's timezone is not the gym's (1.17.4).
   */
  async today(scope: AttendanceScope, branchId?: string): Promise<{ date: string; count: number }> {
    const timeZone = await organizationTimeZone(prisma, scope.organizationId);
    const attendanceDate = localCalendarDate(new Date(), timeZone);
    const roster = await resolveOwnRoster(scope);

    if (roster.restricted && roster.memberIds.length === 0) {
      return { date: formatCalendarDate(attendanceDate), count: 0 };
    }

    const count = await prisma.attendance.count({
      where: {
        organizationId: scope.organizationId,
        branchId: resolveBranchFilter(scope, branchId),
        attendanceDate,
        memberId: roster.restricted ? { in: roster.memberIds } : undefined,
      },
    });

    return { date: formatCalendarDate(attendanceDate), count };
  },

  async listForMember(organizationId: string, memberId: string): Promise<AttendanceResponse[]> {
    const rows = await prisma.attendance.findMany({
      where: { organizationId, memberId },
      include: attendanceInclude,
      orderBy: [{ checkedInAt: "desc" }, { id: "asc" }],
    });
    return rows.map(toResponse);
  },
};

/** `date` is shorthand for a one-day range; `dateFrom`/`dateTo` are inclusive on both ends. */
function dateFilter(query: ListAttendanceQuery): Prisma.DateTimeFilter | undefined {
  if (query.date) {
    const day = parseCalendarDate(query.date);
    return { gte: day, lte: day };
  }

  if (!query.dateFrom && !query.dateTo) return undefined;

  return {
    gte: query.dateFrom ? parseCalendarDate(query.dateFrom) : undefined,
    lte: query.dateTo ? parseCalendarDate(query.dateTo) : undefined,
  };
}

/**
 * The refusal is the only place staff learn *why* a member isn't covered, so it says which of the
 * five situations this is in words a front desk can act on.
 */
function overrideMessage(reason: AttendanceOverrideReason, firstName: string): string {
  switch (reason) {
    case "FROZEN":
      return `${firstName}'s membership is frozen — unfreeze it, or check them in as an override`;
    case "EXPIRED":
      return `${firstName}'s membership has expired — renew it, or check them in as an override`;
    case "CANCELLED":
      return `${firstName}'s membership was cancelled — sell a new one, or check them in as an override`;
    case "NOT_STARTED":
      return `${firstName}'s membership hasn't started yet — check them in as an override if they're training today`;
    default:
      return `${firstName} has no membership — sell one, or check them in as an override`;
  }
}
