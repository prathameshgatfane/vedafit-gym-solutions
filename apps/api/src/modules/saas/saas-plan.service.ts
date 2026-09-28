import { Prisma, type SaasEntitlementValueType } from "@prisma/client";
import { AppError } from "../../lib/app-error";
import { ErrorCode } from "../../lib/error-codes";
import { logger } from "../../lib/logger";
import { prisma, withGeneratedId } from "../../lib/prisma";
import {
  PLATFORM_AUDIT_ACTION,
  writePlatformAuditLog,
} from "../platform/platform-audit";
import type { CreateSaasPlanInput, UpdateSaasPlanInput } from "../platform/platform.schema";

function money(value: { toFixed(digits: number): string } | string | number): string {
  if (typeof value === "object" && value && "toFixed" in value) return value.toFixed(2);
  return Number(value).toFixed(2);
}

function persistEntitlement(row: {
  key: string;
  valueType: SaasEntitlementValueType;
  intValue?: number | null;
  boolValue?: boolean | null;
}) {
  if (row.valueType === "UNLIMITED") {
    return { valueType: "UNLIMITED" as const, intValue: null, boolValue: null };
  }
  if (row.valueType === "BOOLEAN") {
    return { valueType: "BOOLEAN" as const, intValue: null, boolValue: row.boolValue === true };
  }
  return { valueType: "LIMIT" as const, intValue: row.intValue ?? 0, boolValue: null };
}

function entitlementPayload(
  rows: Array<{
    key: string;
    valueType: SaasEntitlementValueType;
    intValue: number | null;
    boolValue: boolean | null;
  }>,
) {
  return rows.map((row) => ({
    key: row.key,
    valueType: row.valueType,
    intValue: row.intValue,
    boolValue: row.boolValue,
  }));
}

function toSaasPlanResponse(
  plan: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    priceMonthly: { toFixed(digits: number): string };
    priceYearly: { toFixed(digits: number): string };
    currency: string;
    trialDays: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    entitlements: Array<{
      key: string;
      valueType: SaasEntitlementValueType;
      intValue: number | null;
      boolValue: boolean | null;
    }>;
  },
  organizationCount: number,
) {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    description: plan.description,
    priceMonthly: money(plan.priceMonthly),
    priceYearly: money(plan.priceYearly),
    currency: plan.currency,
    trialDays: plan.trialDays,
    isActive: plan.isActive,
    organizationCount,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
    entitlements: entitlementPayload(plan.entitlements),
  };
}

const planInclude = { entitlements: { orderBy: { key: "asc" as const } } };

async function organizationCountByPlanId(planIds: string[]) {
  if (planIds.length === 0) return new Map<string, number>();
  const rows = await prisma.organizationSubscription.groupBy({
    by: ["planId"],
    where: { planId: { in: planIds } },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.planId, row._count._all]));
}

export async function listSaasPlans() {
  const plans = await prisma.saasPlan.findMany({
    orderBy: { code: "asc" },
    include: planInclude,
  });
  const counts = await organizationCountByPlanId(plans.map((plan) => plan.id));
  return plans.map((plan) => toSaasPlanResponse(plan, counts.get(plan.id) ?? 0));
}

export async function getSaasPlan(planId: string) {
  const plan = await prisma.saasPlan.findUnique({
    where: { id: planId },
    include: planInclude,
  });
  if (!plan) {
    throw AppError.notFound(ErrorCode.SAAS_PLAN_NOT_FOUND, "SaaS plan not found");
  }
  const counts = await organizationCountByPlanId([plan.id]);
  return toSaasPlanResponse(plan, counts.get(plan.id) ?? 0);
}

export async function createSaasPlan(input: CreateSaasPlanInput, platformUserId: string) {
  const existing = await prisma.saasPlan.findUnique({ where: { code: input.code } });
  if (existing) {
    throw AppError.conflict(
      ErrorCode.DUPLICATE_SAAS_PLAN_CODE,
      `A SaaS plan with code "${input.code}" already exists`,
    );
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const plan = await tx.saasPlan.create({
        data: withGeneratedId({
          code: input.code,
          name: input.name,
          description: input.description ?? null,
          priceMonthly: input.priceMonthly,
          priceYearly: input.priceYearly,
          currency: input.currency,
          trialDays: input.trialDays,
          isActive: input.isActive,
        }),
      });

      for (const row of input.entitlements) {
        await tx.saasPlanEntitlement.create({
          data: withGeneratedId({
            planId: plan.id,
            key: row.key,
            ...persistEntitlement(row),
          }),
        });
      }

      const full = await tx.saasPlan.findUniqueOrThrow({
        where: { id: plan.id },
        include: planInclude,
      });

      await writePlatformAuditLog(tx, {
        platformUserId,
        organizationId: null,
        entityType: "SaasPlan",
        entityId: full.id,
        action: PLATFORM_AUDIT_ACTION.SAAS_PLAN_CREATED,
        afterJson: {
          code: full.code,
          name: full.name,
          isActive: full.isActive,
          priceMonthly: money(full.priceMonthly),
          priceYearly: money(full.priceYearly),
          entitlements: entitlementPayload(full.entitlements),
        },
      });

      return full;
    });

    logger.info({ planId: created.id, code: created.code, platformUserId }, "SAAS_PLAN_CREATED");
    return toSaasPlanResponse(created, 0);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw AppError.conflict(
        ErrorCode.DUPLICATE_SAAS_PLAN_CODE,
        `A SaaS plan with code "${input.code}" already exists`,
      );
    }
    throw error;
  }
}

export async function updateSaasPlan(
  planId: string,
  input: UpdateSaasPlanInput,
  platformUserId: string,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.saasPlan.findUnique({
      where: { id: planId },
      include: planInclude,
    });
    if (!existing) {
      throw AppError.notFound(ErrorCode.SAAS_PLAN_NOT_FOUND, "SaaS plan not found");
    }

    if (
      input.name !== undefined ||
      input.description !== undefined ||
      input.priceMonthly !== undefined ||
      input.priceYearly !== undefined ||
      input.currency !== undefined ||
      input.trialDays !== undefined
    ) {
      await tx.saasPlan.update({
        where: { id: planId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.priceMonthly !== undefined ? { priceMonthly: input.priceMonthly } : {}),
          ...(input.priceYearly !== undefined ? { priceYearly: input.priceYearly } : {}),
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
          ...(input.trialDays !== undefined ? { trialDays: input.trialDays } : {}),
        },
      });
    }

    if (input.entitlements) {
      for (const row of input.entitlements) {
        const persisted = persistEntitlement(row);
        await tx.saasPlanEntitlement.upsert({
          where: { planId_key: { planId, key: row.key } },
          update: persisted,
          create: withGeneratedId({
            planId,
            key: row.key,
            ...persisted,
          }),
        });
      }
    }

    const updated = await tx.saasPlan.findUniqueOrThrow({
      where: { id: planId },
      include: planInclude,
    });

    await writePlatformAuditLog(tx, {
      platformUserId,
      organizationId: null,
      entityType: "SaasPlan",
      entityId: updated.id,
      action: PLATFORM_AUDIT_ACTION.SAAS_PLAN_UPDATED,
      beforeJson: {
        name: existing.name,
        description: existing.description,
        priceMonthly: money(existing.priceMonthly),
        priceYearly: money(existing.priceYearly),
        currency: existing.currency,
        trialDays: existing.trialDays,
      },
      afterJson: {
        name: updated.name,
        description: updated.description,
        priceMonthly: money(updated.priceMonthly),
        priceYearly: money(updated.priceYearly),
        currency: updated.currency,
        trialDays: updated.trialDays,
      },
    });

    if (input.entitlements) {
      await writePlatformAuditLog(tx, {
        platformUserId,
        organizationId: null,
        entityType: "SaasPlan",
        entityId: updated.id,
        action: PLATFORM_AUDIT_ACTION.PLAN_ENTITLEMENTS_CHANGED,
        beforeJson: { entitlements: entitlementPayload(existing.entitlements) },
        afterJson: { entitlements: entitlementPayload(updated.entitlements) },
      });
    }

    logger.info({ planId: updated.id, code: updated.code, platformUserId }, "SAAS_PLAN_UPDATED");
    const organizationCount = await tx.organizationSubscription.count({ where: { planId } });
    return toSaasPlanResponse(updated, organizationCount);
  });
}

export async function activateSaasPlan(planId: string, platformUserId: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.saasPlan.findUnique({
      where: { id: planId },
      include: planInclude,
    });
    if (!existing) {
      throw AppError.notFound(ErrorCode.SAAS_PLAN_NOT_FOUND, "SaaS plan not found");
    }

    const updated = existing.isActive
      ? existing
      : await tx.saasPlan.update({
          where: { id: planId },
          data: { isActive: true },
          include: planInclude,
        });

    if (!existing.isActive) {
      await writePlatformAuditLog(tx, {
        platformUserId,
        organizationId: null,
        entityType: "SaasPlan",
        entityId: updated.id,
        action: PLATFORM_AUDIT_ACTION.SAAS_PLAN_ACTIVATED,
        beforeJson: { isActive: false },
        afterJson: { isActive: true, code: updated.code },
      });
      logger.info({ planId: updated.id, code: updated.code, platformUserId }, "SAAS_PLAN_ACTIVATED");
    }

    const organizationCount = await tx.organizationSubscription.count({ where: { planId } });
    return toSaasPlanResponse(updated, organizationCount);
  });
}

export async function archiveSaasPlan(planId: string, platformUserId: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.saasPlan.findUnique({
      where: { id: planId },
      include: planInclude,
    });
    if (!existing) {
      throw AppError.notFound(ErrorCode.SAAS_PLAN_NOT_FOUND, "SaaS plan not found");
    }

    const updated = existing.isActive
      ? await tx.saasPlan.update({
          where: { id: planId },
          data: { isActive: false },
          include: planInclude,
        })
      : existing;

    if (existing.isActive) {
      await writePlatformAuditLog(tx, {
        platformUserId,
        organizationId: null,
        entityType: "SaasPlan",
        entityId: updated.id,
        action: PLATFORM_AUDIT_ACTION.SAAS_PLAN_ARCHIVED,
        beforeJson: { isActive: true },
        afterJson: { isActive: false, code: updated.code },
      });
      logger.info({ planId: updated.id, code: updated.code, platformUserId }, "SAAS_PLAN_ARCHIVED");
    }

    const organizationCount = await tx.organizationSubscription.count({ where: { planId } });
    return toSaasPlanResponse(updated, organizationCount);
  });
}
