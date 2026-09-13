import type { Prisma } from "@prisma/client";
import { AppError } from "../../lib/app-error";
import { ErrorCode } from "../../lib/error-codes";
import { prisma } from "../../lib/prisma";
import { ZERO } from "../../utils/money";
import { resolveOwnRoster, type OwnRoster } from "../../lib/own-roster";
import {
  addDays,
  formatCalendarDate,
  formatLocalMonth,
  localCalendarDate,
  localMonthBounds,
  localMonthOf,
  localMonthRangeDates,
  monthCountInclusive,
  monthsEndingAt,
  parseLocalMonth,
  safeTimeZone,
  todayUtc,
} from "../../utils/dates";
import type { DashboardQuery, ProfitLossQuery } from "./report.schema";

export interface ReportScope {
  organizationId: string;
  branchId: string | null;
  roleId: string;
  userId: string;
}

const REVENUE_TREND_MONTHS = 6;
const EXPIRING_LIST_LIMIT = 8;

/** Statuses that are not money in the bank. Written as a deny-list so a future gateway status
 * cannot silently count as collected (Locked Decision 1.18.1). */
const NON_COLLECTED_PAYMENT_STATUSES = ["FAILED", "PENDING"] as const;

export interface DashboardMembersWidget {
  total: number;
  /** Distinct members with an ACTIVE term covering today — not `MemberStatus.ACTIVE` (1.18.3). */
  active: number;
}

export interface DashboardRevenueWidget {
  month: string;
  total: string;
  trend: { month: string; total: string }[];
}

export interface DashboardOutstandingWidget {
  amount: string;
  invoiceCount: number;
}

export interface DashboardExpiringWidget {
  withinDays: number;
  count: number;
  items: {
    membershipId: string;
    memberId: string;
    firstName: string;
    lastName: string;
    phone: string;
    planName: string;
    endDate: string;
    daysRemaining: number;
  }[];
}

export interface DashboardAttendanceWidget {
  date: string;
  count: number;
}

export interface DashboardWidgets {
  members?: DashboardMembersWidget;
  revenue?: DashboardRevenueWidget;
  outstanding?: DashboardOutstandingWidget;
  expiring?: DashboardExpiringWidget;
  attendance?: DashboardAttendanceWidget;
}

export interface DashboardResponse {
  asOf: string;
  timezone: string;
  month: string;
  scope: { branchId: string | null; branchName: string | null };
  widgets: DashboardWidgets;
}

export interface ProfitLossResponse {
  timezone: string;
  from: string;
  to: string;
  scope: { branchId: string | null; branchName: string | null };
  revenue: string;
  expenses: string;
  net: string;
  byCategory: { category: string; total: string }[];
}

async function organizationTimeZone(organizationId: string): Promise<string> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true },
  });
  return safeTimeZone(organization?.timezone);
}

/**
 * Branch-scoped callers are pinned to their JWT branch. Org-wide callers may name one, and a
 * missing name means every branch — never guessed from "the first branch" or the member.
 */
async function resolveBranch(
  scope: ReportScope,
  requested: string | undefined,
): Promise<{ id: string | null; name: string | null }> {
  const branchId = scope.branchId ?? requested ?? null;
  if (!branchId) return { id: null, name: null };

  const branch = await prisma.branch.findFirst({
    where: { id: branchId, organizationId: scope.organizationId },
    select: { id: true, name: true },
  });
  if (!branch) {
    throw AppError.notFound(ErrorCode.BRANCH_NOT_FOUND, `Branch "${branchId}" not found`);
  }
  return branch;
}

async function permissionKeysFor(roleId: string): Promise<Set<string>> {
  const rows = await prisma.rolePermission.findMany({
    where: { roleId },
    select: { permission: { select: { key: true } } },
  });
  return new Set(rows.map((row) => row.permission.key));
}

function money(value: Prisma.Decimal | null | undefined): string {
  return (value ?? ZERO).toFixed(2);
}

function memberOnBooks(
  branchId: string | null,
  roster: OwnRoster,
): Prisma.MemberWhereInput {
  return {
    deletedAt: null,
    status: { not: "ARCHIVED" },
    ...(branchId ? { branchId } : {}),
    ...(roster.restricted ? { id: { in: roster.memberIds } } : {}),
  };
}

async function membersWidget(
  organizationId: string,
  branchId: string | null,
  today: Date,
  roster: OwnRoster,
): Promise<DashboardMembersWidget> {
  if (roster.restricted && roster.memberIds.length === 0) {
    return { total: 0, active: 0 };
  }

  const onBooks = memberOnBooks(branchId, roster);

  const [total, covering] = await Promise.all([
    prisma.member.count({
      where: { organizationId, ...onBooks },
    }),
    prisma.membership.findMany({
      where: {
        organizationId,
        status: "ACTIVE",
        startDate: { lte: today },
        endDate: { gte: today },
        member: { organizationId, ...onBooks },
      },
      distinct: ["memberId"],
      select: { memberId: true },
    }),
  ]);

  return { total, active: covering.length };
}

async function sumCollectedPayments(
  organizationId: string,
  branchId: string | null,
  start: Date,
  end: Date,
): Promise<Prisma.Decimal> {
  const aggregated = await prisma.payment.aggregate({
    where: {
      organizationId,
      ...(branchId ? { branchId } : {}),
      paidAt: { gte: start, lt: end },
      status: { notIn: [...NON_COLLECTED_PAYMENT_STATUSES] },
    },
    _sum: { amount: true },
  });
  return aggregated._sum.amount ?? ZERO;
}

async function revenueWidget(
  organizationId: string,
  branchId: string | null,
  timeZone: string,
  now: Date,
): Promise<DashboardRevenueWidget> {
  const thisMonth = localMonthOf(now, timeZone);
  const months = monthsEndingAt(thisMonth, REVENUE_TREND_MONTHS);

  const trend = await Promise.all(
    months.map(async (month) => {
      const { start, end } = localMonthBounds(month, timeZone);
      const total = await sumCollectedPayments(organizationId, branchId, start, end);
      return { month: formatLocalMonth(month), total: money(total) };
    }),
  );

  return {
    month: formatLocalMonth(thisMonth),
    total: trend[trend.length - 1]?.total ?? "0.00",
    trend,
  };
}

async function outstandingWidget(
  organizationId: string,
  branchId: string | null,
  roster: OwnRoster,
): Promise<DashboardOutstandingWidget> {
  if (roster.restricted && roster.memberIds.length === 0) {
    return { amount: "0.00", invoiceCount: 0 };
  }

  const where: Prisma.InvoiceWhereInput = {
    organizationId,
    amountPending: { gt: 0 },
    member: memberOnBooks(branchId, roster),
  };

  const [aggregated, invoiceCount] = await Promise.all([
    prisma.invoice.aggregate({ where, _sum: { amountPending: true } }),
    prisma.invoice.count({ where }),
  ]);

  return { amount: money(aggregated._sum.amountPending), invoiceCount };
}

async function expiringWidget(
  organizationId: string,
  branchId: string | null,
  today: Date,
  withinDays: number,
  roster: OwnRoster,
): Promise<DashboardExpiringWidget> {
  if (roster.restricted && roster.memberIds.length === 0) {
    return { withinDays, count: 0, items: [] };
  }

  const windowEnd = addDays(today, withinDays - 1);
  const where: Prisma.MembershipWhereInput = {
    organizationId,
    status: "ACTIVE",
    startDate: { lte: today },
    endDate: { gte: today, lte: windowEnd },
    member: memberOnBooks(branchId, roster),
  };

  const [count, rows] = await Promise.all([
    prisma.membership.count({ where }),
    prisma.membership.findMany({
      where,
      orderBy: [{ endDate: "asc" }, { id: "asc" }],
      take: EXPIRING_LIST_LIMIT,
      select: {
        id: true,
        memberId: true,
        endDate: true,
        member: { select: { firstName: true, lastName: true, phone: true } },
        plan: { select: { name: true } },
      },
    }),
  ]);

  return {
    withinDays,
    count,
    items: rows.map((row) => ({
      membershipId: row.id,
      memberId: row.memberId,
      firstName: row.member.firstName,
      lastName: row.member.lastName,
      phone: row.member.phone,
      planName: row.plan.name,
      endDate: formatCalendarDate(row.endDate),
      daysRemaining: Math.round((row.endDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000)),
    })),
  };
}

async function attendanceWidget(
  organizationId: string,
  branchId: string | null,
  gymToday: Date,
  roster: OwnRoster,
): Promise<DashboardAttendanceWidget> {
  if (roster.restricted && roster.memberIds.length === 0) {
    return { date: formatCalendarDate(gymToday), count: 0 };
  }

  const count = await prisma.attendance.count({
    where: {
      organizationId,
      attendanceDate: gymToday,
      ...(branchId ? { branchId } : {}),
      ...(roster.restricted ? { memberId: { in: roster.memberIds } } : {}),
    },
  });

  return { date: formatCalendarDate(gymToday), count };
}

export const reportService = {
  /**
   * One read, several widgets, no writes (Locked Decision 1.18.7). Widgets the caller is not
   * entitled to are omitted from the payload entirely (1.18.6).
   */
  async dashboard(scope: ReportScope, query: DashboardQuery): Promise<DashboardResponse> {
    const now = new Date();
    const [keys, branch, timeZone, roster] = await Promise.all([
      permissionKeysFor(scope.roleId),
      resolveBranch(scope, query.branchId),
      organizationTimeZone(scope.organizationId),
      resolveOwnRoster(scope),
    ]);

    const today = todayUtc(now);
    const gymToday = localCalendarDate(now, timeZone);
    const widgets: DashboardWidgets = {};

    const jobs: Promise<void>[] = [];

    if (keys.has("members.view")) {
      jobs.push(
        membersWidget(scope.organizationId, branch.id, today, roster).then((value) => {
          widgets.members = value;
        }),
      );
    }
    if (keys.has("reports.view")) {
      jobs.push(
        revenueWidget(scope.organizationId, branch.id, timeZone, now).then((value) => {
          widgets.revenue = value;
        }),
      );
    }
    if (keys.has("invoices.view")) {
      jobs.push(
        outstandingWidget(scope.organizationId, branch.id, roster).then((value) => {
          widgets.outstanding = value;
        }),
      );
    }
    if (keys.has("memberships.view")) {
      jobs.push(
        expiringWidget(
          scope.organizationId,
          branch.id,
          today,
          query.expiringWithinDays,
          roster,
        ).then((value) => {
          widgets.expiring = value;
        }),
      );
    }
    if (keys.has("attendance.view")) {
      jobs.push(
        attendanceWidget(scope.organizationId, branch.id, gymToday, roster).then((value) => {
          widgets.attendance = value;
        }),
      );
    }

    await Promise.all(jobs);

    return {
      asOf: now.toISOString(),
      timezone: timeZone,
      month: formatLocalMonth(localMonthOf(now, timeZone)),
      scope: { branchId: branch.id, branchName: branch.name },
      widgets,
    };
  },

  /**
   * Revenue vs expenses over gym-local months (1.21.4). Never writes. Org-level expenses
   * (`branchId` null) appear only when the scope is the whole gym (1.21.1).
   */
  async profitLoss(scope: ReportScope, query: ProfitLossQuery): Promise<ProfitLossResponse> {
    const now = new Date();
    const [branch, timeZone] = await Promise.all([
      resolveBranch(scope, query.branchId),
      organizationTimeZone(scope.organizationId),
    ]);

    const current = formatLocalMonth(localMonthOf(now, timeZone));
    const from = parseLocalMonth(query.from ?? query.to ?? current);
    const to = parseLocalMonth(query.to ?? query.from ?? current);
    const months = monthCountInclusive(from, to);
    if (months < 1 || months > 24) {
      throw AppError.badRequest(
        ErrorCode.EXPENSE_RANGE_INVALID,
        months < 1
          ? "`from` must be the same month as `to`, or earlier"
          : "The P&L window cannot exceed 24 months",
      );
    }

    const paymentWindow = {
      start: localMonthBounds(from, timeZone).start,
      end: localMonthBounds(to, timeZone).end,
    };
    const expenseWindow = localMonthRangeDates(from, to);

    const expenseWhere: Prisma.ExpenseWhereInput = {
      organizationId: scope.organizationId,
      expenseDate: { gte: expenseWindow.start, lt: expenseWindow.end },
      ...(branch.id ? { branchId: branch.id } : {}),
    };

    const [revenueTotal, expenseTotal, grouped] = await Promise.all([
      sumCollectedPayments(
        scope.organizationId,
        branch.id,
        paymentWindow.start,
        paymentWindow.end,
      ),
      prisma.expense.aggregate({ where: expenseWhere, _sum: { amount: true } }),
      prisma.expense.groupBy({
        by: ["category"],
        where: expenseWhere,
        _sum: { amount: true },
      }),
    ]);

    const expenses = expenseTotal._sum.amount ?? ZERO;
    const net = revenueTotal.minus(expenses);

    const byCategory = grouped
      .map((row) => ({
        category: row.category,
        total: money(row._sum.amount),
      }))
      .sort((a, b) => Number(b.total) - Number(a.total) || a.category.localeCompare(b.category));

    return {
      timezone: timeZone,
      from: formatLocalMonth(from),
      to: formatLocalMonth(to),
      scope: { branchId: branch.id, branchName: branch.name },
      revenue: money(revenueTotal),
      expenses: money(expenses),
      net: money(net),
      byCategory,
    };
  },
};
