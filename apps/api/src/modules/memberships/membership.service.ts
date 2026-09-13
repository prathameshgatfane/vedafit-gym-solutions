import { Prisma, type MembershipStatus } from "@prisma/client";
import { prisma, withGeneratedId, type TransactionClient } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";
import { ErrorCode } from "../../lib/error-codes";
import { buildPaginationMeta, paginationSkipTake } from "../../utils/pagination";
import {
  addDays,
  daysBetween,
  formatCalendarDate,
  parseCalendarDate,
  termEndDate,
  todayUtc,
} from "../../utils/dates";
import { findSellablePlan } from "../membership-plans/membership-plan.service";
import { raiseInvoice } from "../invoices/invoice.service";
import type {
  ChangePlanInput,
  CreateMembershipInput,
  ListMembershipsQuery,
  RenewMembershipInput,
} from "./membership.schema";

export interface MembershipScope {
  organizationId: string;
  /** `null` for org-wide roles; otherwise every read and write is pinned to this branch. */
  branchId: string | null;
}

/**
 * Locked Decision 1.15.1, as data. Every status change in this module goes through
 * `assertTransition`, so "which moves are legal" is stated once here rather than implied by
 * whichever guards each handler happens to have.
 *
 * `EXPIRED` and `CANCELLED` are terminal: getting out of them is a *new membership*, not a
 * transition. `ACTIVE → EXPIRED` is listed because it is a real edge, but it is system-only —
 * the lazy expiry sweep below is its only caller; there is no "expire" endpoint.
 * `FROZEN → EXPIRED` is absent by design: a frozen clock is paused, so a frozen membership
 * cannot reach its deadline without being unfrozen first (1.15.2).
 */
const ALLOWED_TRANSITIONS: Record<MembershipStatus, readonly MembershipStatus[]> = {
  ACTIVE: ["FROZEN", "CANCELLED", "EXPIRED"],
  FROZEN: ["ACTIVE", "CANCELLED"],
  EXPIRED: [],
  CANCELLED: [],
};

function assertTransition(from: MembershipStatus, to: MembershipStatus, action: string): void {
  if (ALLOWED_TRANSITIONS[from].includes(to)) return;

  throw new AppError(
    409,
    ErrorCode.INVALID_MEMBERSHIP_TRANSITION,
    `Cannot ${action} a ${from} membership (${from} → ${to} is not a valid transition)`,
    { from, to, allowed: ALLOWED_TRANSITIONS[from] },
  );
}

const membershipInclude = {
  member: { select: { id: true, firstName: true, lastName: true, phone: true } },
  plan: { select: { id: true, name: true, status: true } },
} satisfies Prisma.MembershipInclude;

type MembershipRow = Prisma.MembershipGetPayload<{ include: typeof membershipInclude }>;

export interface MembershipResponse {
  id: string;
  organizationId: string;
  branchId: string;
  memberId: string;
  planId: string;
  priceAtPurchase: string;
  durationDaysAtPurchase: number;
  startDate: string;
  endDate: string;
  status: MembershipStatus;
  frozenAt: string | null;
  totalFrozenDays: number;
  previousMembershipId: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** A renewal bought before the current term ends starts in the future — still ACTIVE, not yet live. */
  isUpcoming: boolean;
  /** Days of access left, inclusive of today. Frozen terms report the paused figure, not a countdown. */
  daysRemaining: number;
  member: MembershipRow["member"];
  plan: MembershipRow["plan"];
}

function daysRemaining(row: MembershipRow, today: Date): number {
  if (row.status === "EXPIRED" || row.status === "CANCELLED") return 0;

  // While frozen the clock is stopped (1.15.2), so the countdown is measured from the day the
  // freeze began — otherwise the UI would show a frozen membership draining away.
  const from = row.status === "FROZEN" && row.frozenAt ? todayUtc(row.frozenAt) : today;
  return Math.max(0, daysBetween(from, row.endDate) + 1);
}

function toResponse(row: MembershipRow, today: Date = todayUtc()): MembershipResponse {
  return {
    id: row.id,
    organizationId: row.organizationId,
    branchId: row.branchId,
    memberId: row.memberId,
    planId: row.planId,
    // Fixed-2 string for the same reason as the plan's `price` — money never crosses the wire as
    // a float. This is the frozen snapshot, so it is what the member actually agreed to pay.
    priceAtPurchase: row.priceAtPurchase.toFixed(2),
    durationDaysAtPurchase: row.durationDaysAtPurchase,
    startDate: formatCalendarDate(row.startDate),
    endDate: formatCalendarDate(row.endDate),
    status: row.status,
    frozenAt: row.frozenAt ? row.frozenAt.toISOString() : null,
    totalFrozenDays: row.totalFrozenDays,
    previousMembershipId: row.previousMembershipId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    isUpcoming: row.startDate > today,
    daysRemaining: daysRemaining(row, today),
    member: row.member,
    plan: row.plan,
  };
}

/**
 * Locked Decision 1.8 / 1.15.1 — expiry with no scheduler.
 *
 * Every read and every write flips lapsed `ACTIVE` rows to `EXPIRED` before doing anything else,
 * as one indexed `UPDATE` rather than a row-by-row patch after the fact. Doing it *first* is what
 * makes the rest correct for free: `?status=ACTIVE` doesn't return yesterday's memberships, and a
 * freeze/renew guard sees the status the calendar says, not the one last written.
 *
 * Frozen rows are deliberately untouched — their clock is paused, so they cannot lapse.
 */
async function sweepExpired(
  client: TransactionClient | typeof prisma,
  where: Prisma.MembershipWhereInput,
  today: Date,
): Promise<void> {
  await client.membership.updateMany({
    where: { ...where, status: "ACTIVE", endDate: { lt: today } },
    data: { status: "EXPIRED" },
  });
}

async function lockOrganizationForWrite(tx: TransactionClient, organizationId: string) {
  await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId} FOR UPDATE`;
}

/**
 * Phase 6 — every term sold, renewed or switched into raises its bill in the same transaction as
 * the membership row. A sale with no invoice is revenue nobody can collect, and a term created
 * without one would have to be reconciled by hand later.
 *
 * The invoice is for `priceAtPurchase`, the snapshot, not the plan's current price: the bill has
 * to say what the member actually agreed to (1.15.3, 1.16.2). A zero-price term still gets an
 * invoice — it lands `PAID` with no payment rows, which is the honest record of a free term.
 *
 * Every caller already holds the organization lock, which is the order Locked Decision 1.16.4
 * requires: organization first, then the invoice sequence row.
 */
async function raiseInvoiceForTerm(
  tx: TransactionClient,
  membership: {
    id: string;
    organizationId: string;
    branchId: string;
    memberId: string;
    priceAtPurchase: Prisma.Decimal;
  },
  planName: string,
  what: "Membership" | "Renewal" | "Plan change",
): Promise<void> {
  await raiseInvoice(tx, {
    organizationId: membership.organizationId,
    // The branch that sold the term owns the revenue from it, whatever happens to the member's
    // own branch later (1.18.2).
    branchId: membership.branchId,
    memberId: membership.memberId,
    membershipId: membership.id,
    amountTotal: membership.priceAtPurchase,
    notes: `${what} — ${planName}`,
  });
}

/**
 * What the forfeited days were worth, at the old term's own snapshot daily rate — Locked
 * Decision 1.16.1. Surfaced so the operator sees the number, and deliberately *not* acted on:
 * this endpoint moves no money. Issuing it back is a separate, `payments.refund`-gated act.
 */
function forfeitedValueOf(
  source: { priceAtPurchase: Prisma.Decimal; durationDaysAtPurchase: number },
  forfeitedDays: number,
): string {
  if (source.durationDaysAtPurchase <= 0 || forfeitedDays <= 0) return "0.00";

  return source.priceAtPurchase
    .dividedBy(source.durationDaysAtPurchase)
    .times(forfeitedDays)
    .toFixed(2);
}

/** Branch-scoped callers are pinned to their own branch even when they name no branch at all. */
function resolveBranchFilter(scope: MembershipScope, requested?: string): string | undefined {
  return scope.branchId ?? requested;
}

async function findMemberOrThrow(tx: TransactionClient, scope: MembershipScope, memberId: string) {
  const member = await tx.member.findFirst({
    where: {
      id: memberId,
      organizationId: scope.organizationId,
      branchId: scope.branchId ?? undefined,
      deletedAt: null,
    },
    select: { id: true, branchId: true, status: true, firstName: true, lastName: true },
  });

  if (!member) {
    throw AppError.notFound(ErrorCode.MEMBER_NOT_FOUND, `Member "${memberId}" not found`);
  }

  if (member.status === "ARCHIVED") {
    throw AppError.badRequest(
      ErrorCode.VALIDATION_ERROR,
      `${member.firstName} ${member.lastName} is archived — restore the member before selling a membership`,
    );
  }

  return member;
}

/**
 * Locked Decision 1.15.1: at most one live (ACTIVE/FROZEN) membership per member at any given
 * date. Two overlapping terms would make "what is this member on?" unanswerable for attendance,
 * payments and every report. Stacking a term is what `renew` is for — it starts the new term the
 * day after the current one ends, so it never trips this.
 */
async function assertNoOverlap(
  tx: TransactionClient,
  organizationId: string,
  memberId: string,
  startDate: Date,
  endDate: Date,
) {
  const clash = await tx.membership.findFirst({
    where: {
      organizationId,
      memberId,
      status: { in: ["ACTIVE", "FROZEN"] },
      startDate: { lte: endDate },
      endDate: { gte: startDate },
    },
    select: { id: true, startDate: true, endDate: true },
  });

  if (clash) {
    throw AppError.conflict(
      ErrorCode.MEMBERSHIP_OVERLAP,
      `This member already has a membership running ${formatCalendarDate(clash.startDate)} to ${formatCalendarDate(clash.endDate)} — renew it instead of adding a second one`,
      { conflictingMembershipId: clash.id },
    );
  }
}

/** Loads a membership for a write, having first let it expire if the calendar says it has. */
async function loadForTransition(
  tx: TransactionClient,
  scope: MembershipScope,
  membershipId: string,
  today: Date,
): Promise<MembershipRow> {
  const where: Prisma.MembershipWhereInput = {
    id: membershipId,
    organizationId: scope.organizationId,
    branchId: scope.branchId ?? undefined,
  };

  await sweepExpired(tx, where, today);

  const membership = await tx.membership.findFirst({ where, include: membershipInclude });
  if (!membership) {
    throw AppError.notFound(
      ErrorCode.MEMBERSHIP_NOT_FOUND,
      `Membership "${membershipId}" not found`,
    );
  }

  return membership;
}

export const membershipService = {
  /**
   * Sells a term. The plan's price and duration are copied onto the row here and never read from
   * the plan again — Section 3's snapshot rationale, and the reason a later price change can't
   * reach this membership.
   */
  async create(
    scope: MembershipScope,
    input: CreateMembershipInput,
  ): Promise<MembershipResponse> {
    const today = todayUtc();

    const membership = await prisma.$transaction(async (tx) => {
      await lockOrganizationForWrite(tx, scope.organizationId);

      const member = await findMemberOrThrow(tx, scope, input.memberId);
      const plan = await findSellablePlan(tx, scope.organizationId, input.planId);

      const startDate = input.startDate ? parseCalendarDate(input.startDate) : today;
      const endDate = termEndDate(startDate, plan.durationDays);

      await sweepExpired(tx, { organizationId: scope.organizationId, memberId: member.id }, today);
      await assertNoOverlap(tx, scope.organizationId, member.id, startDate, endDate);

      const created = await tx.membership.create({
        data: withGeneratedId({
          organizationId: scope.organizationId,
          // Inherited from the member rather than taken from the request: a membership belongs
          // wherever the member does, and accepting it as input would be one more claim to police.
          branchId: member.branchId,
          memberId: member.id,
          planId: plan.id,
          priceAtPurchase: plan.price,
          durationDaysAtPurchase: plan.durationDays,
          startDate,
          endDate,
          // Backdated terms can be sold already-lapsed; the sweep on the next read settles it,
          // and writing EXPIRED here would need a transition that isn't ours to make.
          status: "ACTIVE",
        }),
        include: membershipInclude,
      });

      await raiseInvoiceForTerm(tx, created, plan.name, "Membership");
      return created;
    });

    return toResponse(membership, today);
  },

  async list(scope: MembershipScope, query: ListMembershipsQuery) {
    const today = todayUtc();

    // Kept separate from the search filter below because `updateMany` takes scalar conditions
    // only — it can't join to `member`. Sweeping the caller's whole scope rather than just the
    // rows matching their search is both harmless (the flip is idempotent) and more useful.
    const scopeWhere: Prisma.MembershipWhereInput = {
      organizationId: scope.organizationId,
      branchId: resolveBranchFilter(scope, query.branchId),
      memberId: query.memberId,
      planId: query.planId,
    };

    // Before the status filter is applied, not after — otherwise `?status=ACTIVE` would happily
    // return terms that ended last week.
    await sweepExpired(prisma, scopeWhere, today);

    const filtered: Prisma.MembershipWhereInput = {
      ...scopeWhere,
      status: query.status,
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

    const [items, total] = await Promise.all([
      prisma.membership.findMany({
        where: filtered,
        include: membershipInclude,
        // `id` breaks ties so a row can't appear on two pages when several share a sort value.
        orderBy: [{ [query.sortBy]: query.sortOrder }, { id: "asc" }],
        ...paginationSkipTake(query),
      }),
      prisma.membership.count({ where: filtered }),
    ]);

    return {
      items: items.map((row) => toResponse(row, today)),
      pagination: buildPaginationMeta(query.page, query.limit, total),
    };
  },

  async getById(scope: MembershipScope, membershipId: string): Promise<MembershipResponse> {
    const today = todayUtc();
    const where: Prisma.MembershipWhereInput = {
      id: membershipId,
      organizationId: scope.organizationId,
      branchId: scope.branchId ?? undefined,
    };

    await sweepExpired(prisma, where, today);

    const membership = await prisma.membership.findFirst({ where, include: membershipInclude });
    if (!membership) {
      throw AppError.notFound(
        ErrorCode.MEMBERSHIP_NOT_FOUND,
        `Membership "${membershipId}" not found`,
      );
    }

    return toResponse(membership, today);
  },

  /**
   * Locked Decision 1.15.3 — a renewal is a *new row*, and the source row is left exactly as it
   * is. Renewing early stacks the new term after the current one rather than throwing away paid
   * days, and the snapshot is taken at renewal time, which is how a price rise reaches a member.
   */
  async renew(
    scope: MembershipScope,
    membershipId: string,
    input: RenewMembershipInput,
  ): Promise<MembershipResponse> {
    const today = todayUtc();

    const membership = await prisma.$transaction(async (tx) => {
      await lockOrganizationForWrite(tx, scope.organizationId);

      const source = await loadForTransition(tx, scope, membershipId, today);

      if (source.status !== "ACTIVE" && source.status !== "EXPIRED") {
        throw new AppError(
          409,
          ErrorCode.INVALID_MEMBERSHIP_TRANSITION,
          source.status === "FROZEN"
            ? "Unfreeze this membership before renewing it"
            : `Cannot renew a ${source.status} membership — sell a new membership instead`,
          { status: source.status },
        );
      }

      const plan = await findSellablePlan(tx, scope.organizationId, input.planId ?? source.planId);

      // The day after the current term ends, or today if it already ended — never a gap, never
      // an overlap, and never a day of paid access lost to renewing early.
      const dayAfterSource = addDays(source.endDate, 1);
      const startDate = dayAfterSource > today ? dayAfterSource : today;
      const endDate = termEndDate(startDate, plan.durationDays);

      await assertNoOverlap(tx, scope.organizationId, source.memberId, startDate, endDate);

      const created = await tx.membership.create({
        data: withGeneratedId({
          organizationId: scope.organizationId,
          branchId: source.branchId,
          memberId: source.memberId,
          planId: plan.id,
          priceAtPurchase: plan.price,
          durationDaysAtPurchase: plan.durationDays,
          startDate,
          endDate,
          status: "ACTIVE",
          previousMembershipId: source.id,
        }),
        include: membershipInclude,
      });

      await raiseInvoiceForTerm(tx, created, plan.name, "Renewal");
      return created;
    });

    return toResponse(membership, today);
  },

  /**
   * Locked Decision 1.15.4 — mid-term upgrade/downgrade. The current term is cancelled and the
   * new plan starts fresh today; remaining days are **forfeited**, because crediting them is a
   * money question that needs the refund/credit-note concepts Phase 6 introduces. The forfeited
   * count is returned so the caller can say so out loud rather than quietly swallowing it.
   */
  async changePlan(
    scope: MembershipScope,
    membershipId: string,
    input: ChangePlanInput,
  ): Promise<{ membership: MembershipResponse; forfeitedDays: number; forfeitedValue: string }> {
    const today = todayUtc();

    const result = await prisma.$transaction(async (tx) => {
      await lockOrganizationForWrite(tx, scope.organizationId);

      const source = await loadForTransition(tx, scope, membershipId, today);

      // Cancelling the old term is the transition that has to be legal; going through the matrix
      // (rather than checking `status === "ACTIVE"` inline) keeps the FROZEN and terminal cases
      // answering with the same error every other endpoint gives.
      assertTransition(source.status, "CANCELLED", "change the plan on");

      if (source.status === "FROZEN") {
        throw new AppError(
          409,
          ErrorCode.INVALID_MEMBERSHIP_TRANSITION,
          "Unfreeze this membership before changing its plan",
          { status: source.status },
        );
      }

      if (source.planId === input.planId) {
        throw AppError.badRequest(
          ErrorCode.VALIDATION_ERROR,
          "This membership is already on that plan",
        );
      }

      const plan = await findSellablePlan(tx, scope.organizationId, input.planId);
      const forfeitedDays = Math.max(0, daysBetween(today, source.endDate) + 1);
      const forfeitedValue = forfeitedValueOf(source, forfeitedDays);

      await tx.membership.update({ where: { id: source.id }, data: { status: "CANCELLED" } });

      const membership = await tx.membership.create({
        data: withGeneratedId({
          organizationId: scope.organizationId,
          branchId: source.branchId,
          memberId: source.memberId,
          planId: plan.id,
          priceAtPurchase: plan.price,
          durationDaysAtPurchase: plan.durationDays,
          startDate: today,
          endDate: termEndDate(today, plan.durationDays),
          status: "ACTIVE",
          previousMembershipId: source.id,
        }),
        include: membershipInclude,
      });

      // The new plan is billed in full — Locked Decision 1.16.1 keeps this endpoint from moving
      // money in either direction. The old term's unpaid bill, if any, is left as it is: whether
      // to void it is an operator decision, taken through the invoice cancel route.
      await raiseInvoiceForTerm(tx, membership, plan.name, "Plan change");

      return { membership, forfeitedDays, forfeitedValue };
    });

    return {
      membership: toResponse(result.membership, today),
      forfeitedDays: result.forfeitedDays,
      forfeitedValue: result.forfeitedValue,
    };
  },

  /** Locked Decision 1.15.2 — the clock stops here and restarts in `unfreeze`. */
  async freeze(scope: MembershipScope, membershipId: string): Promise<MembershipResponse> {
    const today = todayUtc();

    const membership = await prisma.$transaction(async (tx) => {
      const source = await loadForTransition(tx, scope, membershipId, today);
      assertTransition(source.status, "FROZEN", "freeze");

      return tx.membership.update({
        where: { id: source.id },
        data: { status: "FROZEN", frozenAt: new Date() },
        include: membershipInclude,
      });
    });

    return toResponse(membership, today);
  },

  /**
   * Locked Decision 1.15.2 — `endDate` moves forward by however many whole days the freeze
   * lasted, so the member gets back exactly the access they paid for. Freezing and unfreezing on
   * the same day costs nothing and adds nothing.
   */
  async unfreeze(scope: MembershipScope, membershipId: string): Promise<MembershipResponse> {
    const today = todayUtc();

    const membership = await prisma.$transaction(async (tx) => {
      const source = await loadForTransition(tx, scope, membershipId, today);
      assertTransition(source.status, "ACTIVE", "unfreeze");

      // `frozenAt` is always set while FROZEN; falling back to today just means "no days added"
      // rather than throwing, so a row hand-edited in the database can still be recovered.
      const frozenDays = source.frozenAt ? Math.max(0, daysBetween(todayUtc(source.frozenAt), today)) : 0;

      return tx.membership.update({
        where: { id: source.id },
        data: {
          status: "ACTIVE",
          frozenAt: null,
          endDate: addDays(source.endDate, frozenDays),
          totalFrozenDays: source.totalFrozenDays + frozenDays,
        },
        include: membershipInclude,
      });
    });

    return toResponse(membership, today);
  },

  /** Terminal (1.15.1). Re-selling to this member is a new membership, not an un-cancel. */
  async cancel(scope: MembershipScope, membershipId: string): Promise<MembershipResponse> {
    const today = todayUtc();

    const membership = await prisma.$transaction(async (tx) => {
      const source = await loadForTransition(tx, scope, membershipId, today);
      assertTransition(source.status, "CANCELLED", "cancel");

      return tx.membership.update({
        where: { id: source.id },
        // `frozenAt` is cleared so a cancelled row doesn't look like it's still mid-freeze;
        // `totalFrozenDays` stays, since it's history.
        data: { status: "CANCELLED", frozenAt: null },
        include: membershipInclude,
      });
    });

    return toResponse(membership, today);
  },

  /** Member portal (1.23.3) — token memberId only, same lazy expiry as staff reads. */
  async listForMember(organizationId: string, memberId: string): Promise<MembershipResponse[]> {
    const today = todayUtc();
    await sweepExpired(prisma, { organizationId, memberId }, today);
    const rows = await prisma.membership.findMany({
      where: { organizationId, memberId },
      include: membershipInclude,
      orderBy: [{ startDate: "desc" }, { id: "asc" }],
    });
    return rows.map((row) => toResponse(row, today));
  },
};
