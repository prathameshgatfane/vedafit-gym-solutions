import { Prisma, type MembershipPlan } from "@prisma/client";
import { prisma, withGeneratedId, type TransactionClient } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";
import { ErrorCode } from "../../lib/error-codes";
import { buildPaginationMeta, paginationSkipTake } from "../../utils/pagination";
import type {
  CreateMembershipPlanInput,
  ListMembershipPlansQuery,
  UpdateMembershipPlanInput,
} from "./membership-plan.schema";

/**
 * Plans are organization-wide — the model has no `branchId`, and a gym that sells the same plan
 * at two branches shouldn't have to maintain two rows. So, unlike members, there is no branch
 * filter here; a branch-scoped caller sees the whole org's catalog.
 */
export interface PlanScope {
  organizationId: string;
}

/**
 * Same InnoDB row lock the members and users modules use (Locked Decision 1.3): under REPEATABLE
 * READ, two concurrent "no plan by that name" checks can both succeed and both insert.
 */
async function lockOrganizationForWrite(tx: TransactionClient, organizationId: string) {
  await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId} FOR UPDATE`;
}

/**
 * Only *live* plans compete for a name. Retiring "Gold" and later selling a different "Gold"
 * is legitimate; two sellable plans with the same name on the same screen is just a mis-sale
 * waiting to happen. Note `name` is `utf8mb4_unicode_ci`, so this comparison is already
 * case-insensitive — "gold" collides with "Gold", which is what staff would expect.
 */
async function assertNameIsFree(
  tx: TransactionClient,
  organizationId: string,
  name: string,
  excludePlanId?: string,
) {
  const existing = await tx.membershipPlan.findFirst({
    where: {
      organizationId,
      name,
      status: "ACTIVE",
      id: excludePlanId ? { not: excludePlanId } : undefined,
    },
    select: { id: true },
  });

  if (existing) {
    throw AppError.conflict(
      ErrorCode.DUPLICATE_PLAN_NAME,
      `An active plan named "${name}" already exists`,
      { conflictingPlanId: existing.id },
    );
  }
}

export interface MembershipPlanResponse extends Omit<MembershipPlan, "price"> {
  /**
   * Serialized as a fixed-2 string, not a JSON number: `Decimal(10,2)` values like `1499.95`
   * have no exact IEEE-754 representation, and money that drifts in the last cent between the
   * API and a spreadsheet is a support ticket. Callers format it; they never do float math on it.
   */
  price: string;
}

export function toPlanResponse(plan: MembershipPlan): MembershipPlanResponse {
  return { ...plan, price: plan.price.toFixed(2) };
}

export const membershipPlanService = {
  async create(
    scope: PlanScope,
    input: CreateMembershipPlanInput,
  ): Promise<MembershipPlanResponse> {
    const plan = await prisma.$transaction(async (tx) => {
      await lockOrganizationForWrite(tx, scope.organizationId);
      await assertNameIsFree(tx, scope.organizationId, input.name);

      return tx.membershipPlan.create({
        data: withGeneratedId({
          organizationId: scope.organizationId,
          name: input.name,
          price: new Prisma.Decimal(input.price.toFixed(2)),
          durationDays: input.durationDays,
          status: input.status ?? "ACTIVE",
        }),
      });
    });

    return toPlanResponse(plan);
  },

  async list(scope: PlanScope, query: ListMembershipPlansQuery) {
    const where: Prisma.MembershipPlanWhereInput = {
      organizationId: scope.organizationId,
      status: query.status,
      name: query.search ? { contains: query.search } : undefined,
    };

    const [items, total] = await Promise.all([
      prisma.membershipPlan.findMany({
        where,
        // `id` breaks ties so a plan can't land on two pages when several share a sort value.
        orderBy: [{ [query.sortBy]: query.sortOrder }, { id: "asc" }],
        ...paginationSkipTake(query),
      }),
      prisma.membershipPlan.count({ where }),
    ]);

    return {
      items: items.map(toPlanResponse),
      pagination: buildPaginationMeta(query.page, query.limit, total),
    };
  },

  async getById(scope: PlanScope, planId: string): Promise<MembershipPlanResponse> {
    const plan = await prisma.membershipPlan.findFirst({
      where: { id: planId, organizationId: scope.organizationId },
    });

    if (!plan) {
      throw AppError.notFound(
        ErrorCode.MEMBERSHIP_PLAN_NOT_FOUND,
        `Membership plan "${planId}" not found`,
      );
    }

    return toPlanResponse(plan);
  },

  /**
   * Editing `price`/`durationDays` deliberately does not touch memberships already sold — see
   * Section 3's snapshot rationale and 1.15.3. This is the mechanism by which a price rise takes
   * effect: at each member's *next* term, never mid-term and never retroactively.
   */
  async update(
    scope: PlanScope,
    planId: string,
    input: UpdateMembershipPlanInput,
  ): Promise<MembershipPlanResponse> {
    const plan = await prisma.$transaction(async (tx) => {
      await lockOrganizationForWrite(tx, scope.organizationId);

      const existing = await tx.membershipPlan.findFirst({
        where: { id: planId, organizationId: scope.organizationId },
      });
      if (!existing) {
        throw AppError.notFound(
          ErrorCode.MEMBERSHIP_PLAN_NOT_FOUND,
          `Membership plan "${planId}" not found`,
        );
      }

      // Reactivating collides with live names too, so the check runs whenever the row could end
      // up ACTIVE under a name it doesn't already hold as ACTIVE.
      const nextName = input.name ?? existing.name;
      const nextStatus = input.status ?? existing.status;
      const nameBecomesLive =
        nextStatus === "ACTIVE" && (nextName !== existing.name || existing.status !== "ACTIVE");
      if (nameBecomesLive) {
        await assertNameIsFree(tx, scope.organizationId, nextName, planId);
      }

      return tx.membershipPlan.update({
        where: { id: planId },
        data: {
          name: input.name,
          price: input.price === undefined ? undefined : new Prisma.Decimal(input.price.toFixed(2)),
          durationDays: input.durationDays,
          status: input.status,
        },
      });
    });

    return toPlanResponse(plan);
  },
};

/**
 * Shared with the memberships module, which needs the plan row itself (not the response shape) to
 * take a price/duration snapshot. Kept here so "is this plan sellable?" has one definition.
 */
export async function findSellablePlan(
  tx: TransactionClient,
  organizationId: string,
  planId: string,
): Promise<MembershipPlan> {
  const plan = await tx.membershipPlan.findFirst({ where: { id: planId, organizationId } });

  if (!plan) {
    throw AppError.notFound(
      ErrorCode.MEMBERSHIP_PLAN_NOT_FOUND,
      `Membership plan "${planId}" not found`,
    );
  }

  if (plan.status !== "ACTIVE") {
    throw AppError.badRequest(
      ErrorCode.MEMBERSHIP_PLAN_INACTIVE,
      `Plan "${plan.name}" is retired and can no longer be sold`,
    );
  }

  return plan;
}
