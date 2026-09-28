import type { Prisma } from "@prisma/client";
import { AppError } from "../../lib/app-error";
import { ErrorCode } from "../../lib/error-codes";
import { logger } from "../../lib/logger";
import { generateTemporaryPassword } from "../../lib/password";
import { prisma } from "../../lib/prisma";
import { addDays, todayUtc } from "../../utils/dates";
import { buildPaginationMeta, paginationSkipTake } from "../../utils/pagination";
import { provisionOrganization } from "../organizations/organization-provisioning.service";
import { getOrganizationSaasSnapshot } from "../saas/saas-entitlements.service";
import {
  PLATFORM_AUDIT_ACTION,
  publicOrgAuditPayload,
  writePlatformAuditLog,
} from "./platform-audit";
import type {
  PlatformCreateOrganizationInput,
  PlatformOrganizationListQuery,
  PlatformSignupInput,
  PlatformSubscriptionPatchInput,
} from "./platform.schema";

function money(value: { toFixed(digits: number): string } | string | number): string {
  if (typeof value === "object" && value && "toFixed" in value) return value.toFixed(2);
  return Number(value).toFixed(2);
}

export interface PublicSignupResult {
  organization: {
    id: string;
    name: string;
    slug: string;
    email: string;
    phone: string | null;
    status: string;
    timezone: string;
  };
  branch: { id: string; name: string };
  owner: { id: string; name: string; email: string };
}

/**
 * Public gym signup. Delegates tenant writes to `provisionOrganization` — no second bootstrap.
 * Does not issue staff or platform tokens; the OWNER signs in at POST /auth/login.
 */
export async function signupOrganization(
  input: PlatformSignupInput,
): Promise<PublicSignupResult> {
  const provisioned = await provisionOrganization(
    {
      organization: {
        name: input.name,
        slug: input.slug,
        email: input.email,
        phone: input.phone,
        timezone: input.timezone,
      },
      owner: input.owner,
      branchName: input.branchName,
    },
    {
      afterProvision: async (tx, result) => {
        await writePlatformAuditLog(tx, {
          platformUserId: null,
          organizationId: result.organization.id,
          entityType: "Organization",
          entityId: result.organization.id,
          action: PLATFORM_AUDIT_ACTION.ORG_SIGNUP,
          afterJson: publicOrgAuditPayload({
            id: result.organization.id,
            slug: result.organization.slug,
            status: result.organization.status,
            ownerEmail: result.owner.email,
            subscription: result.subscription,
          }),
        });
      },
    },
  );

  logger.info(
    {
      organizationId: provisioned.organization.id,
      slug: provisioned.organization.slug,
      ownerEmail: provisioned.owner.email,
    },
    "ORG_SIGNUP",
  );

  return {
    organization: provisioned.organization,
    branch: provisioned.branch,
    owner: {
      id: provisioned.owner.id,
      name: provisioned.owner.name,
      email: provisioned.owner.email,
    },
  };
}

/**
 * Super Admin create (Phase D). Same `provisionOrganization` transaction as public signup, but
 * the operator chooses the SaaS plan. Client prices/entitlements are not in the schema.
 * Does not issue tokens. Audit row is 15.11.
 */
export async function createOrganizationAsOperator(
  input: PlatformCreateOrganizationInput,
  platformUserId: string,
): Promise<
  PublicSignupResult & {
    subscription: { id: string; planCode: string; status: string };
    credentials?: { email: string; temporaryPassword: string };
  }
> {
  const plan = await prisma.saasPlan.findUnique({
    where: { id: input.planId },
    select: { id: true, code: true, isActive: true },
  });
  if (!plan) {
    throw AppError.notFound(ErrorCode.SAAS_PLAN_NOT_FOUND, "SaaS plan not found");
  }
  if (!plan.isActive) {
    throw AppError.conflict(
      ErrorCode.SAAS_PLAN_INACTIVE,
      "This SaaS plan is archived and cannot be assigned",
    );
  }

  const generated = input.generatePassword === true;
  const ownerPassword = generated ? generateTemporaryPassword() : input.owner.password!;

  const provisioned = await provisionOrganization(
    {
      organization: {
        name: input.name,
        slug: input.slug,
        email: input.email,
        phone: input.phone,
        timezone: input.timezone,
      },
      owner: {
        name: input.owner.name,
        email: input.owner.email,
        password: ownerPassword,
      },
      branchName: input.branchName,
      saas: {
        planCode: plan.code,
        subscriptionStatus: input.subscriptionStatus,
        billingInterval: input.billingInterval,
        currentPeriodEnd: input.currentPeriodEnd ? new Date(input.currentPeriodEnd) : undefined,
      },
    },
    {
      afterProvision: async (tx, result) => {
        await writePlatformAuditLog(tx, {
          platformUserId,
          organizationId: result.organization.id,
          entityType: "Organization",
          entityId: result.organization.id,
          action: PLATFORM_AUDIT_ACTION.ORG_PROVISIONED,
          afterJson: publicOrgAuditPayload({
            id: result.organization.id,
            slug: result.organization.slug,
            status: result.organization.status,
            ownerEmail: result.owner.email,
            subscription: result.subscription,
            credentialMode: generated ? "generated" : "manual",
          }),
        });
      },
    },
  );

  logger.info(
    { organizationId: provisioned.organization.id, platformUserId, slug: provisioned.organization.slug },
    "ORG_PROVISIONED",
  );

  return {
    organization: provisioned.organization,
    branch: provisioned.branch,
    owner: {
      id: provisioned.owner.id,
      name: provisioned.owner.name,
      email: provisioned.owner.email,
    },
    subscription: provisioned.subscription,
    ...(generated
      ? {
          credentials: {
            email: provisioned.owner.email,
            temporaryPassword: ownerPassword,
          },
        }
      : {}),
  };
}

function subscriptionSummary(
  subscription: {
    status: string;
    currentPeriodEnd: Date;
    plan: { code: string };
  } | null,
) {
  if (!subscription) return null;
  return {
    status: subscription.status,
    planCode: subscription.plan.code,
    currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
  };
}

export async function listPlatformOrganizations(query: PlatformOrganizationListQuery) {
  const where: Prisma.OrganizationWhereInput = {
    status: query.status,
    OR: query.search
      ? [
          { name: { contains: query.search } },
          { slug: { contains: query.search } },
          { email: { contains: query.search } },
        ]
      : undefined,
  };

  const [items, total] = await Promise.all([
    prisma.organization.findMany({
      where,
      orderBy: { [query.sortBy]: query.sortOrder },
      ...paginationSkipTake(query),
      select: {
        id: true,
        name: true,
        slug: true,
        email: true,
        phone: true,
        status: true,
        timezone: true,
        createdAt: true,
        subscription: { select: { status: true, currentPeriodEnd: true, plan: { select: { code: true } } } },
      },
    }),
    prisma.organization.count({ where }),
  ]);

  return {
    items: items.map((org) => ({
      id: org.id,
      name: org.name,
      slug: org.slug,
      email: org.email,
      phone: org.phone,
      status: org.status,
      timezone: org.timezone,
      createdAt: org.createdAt.toISOString(),
      subscription: subscriptionSummary(org.subscription),
    })),
    pagination: buildPaginationMeta(query.page, query.limit, total),
  };
}

export async function getPlatformOrganization(organizationId: string) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      slug: true,
      email: true,
      phone: true,
      status: true,
      timezone: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!org) {
    throw AppError.notFound(ErrorCode.ORGANIZATION_NOT_FOUND, `Organization "${organizationId}" not found`);
  }

  const [owner, subscription] = await Promise.all([
    prisma.user.findFirst({
      where: { organizationId, deletedAt: null, role: { name: "OWNER" } },
      select: { email: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.organizationSubscription.findUnique({
      where: { organizationId },
      include: { plan: { select: { id: true, code: true, name: true } } },
    }),
  ]);

  const snapshot = await getOrganizationSaasSnapshot(organizationId);

  return {
    organization: {
      ...org,
      createdAt: org.createdAt.toISOString(),
      updatedAt: org.updatedAt.toISOString(),
    },
    owner: owner ? { email: owner.email } : null,
    subscription: subscription
      ? {
          id: subscription.id,
          status: subscription.status,
          billingInterval: subscription.billingInterval,
          priceSnapshot: money(subscription.priceSnapshot),
          currentPeriodStart: subscription.currentPeriodStart.toISOString(),
          currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
          plan: subscription.plan,
        }
      : null,
    entitlements: snapshot?.entitlements ?? [],
  };
}

export async function updateOrganizationStatus(
  organizationId: string,
  status: "ACTIVE" | "SUSPENDED",
  platformUserId: string,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, status: true },
    });
    if (!existing) {
      throw AppError.notFound(
        ErrorCode.ORGANIZATION_NOT_FOUND,
        `Organization "${organizationId}" not found`,
      );
    }

    const updated = await tx.organization.update({
      where: { id: organizationId },
      data: { status },
    });

    await writePlatformAuditLog(tx, {
      platformUserId,
      organizationId,
      entityType: "Organization",
      entityId: organizationId,
      action:
        status === "SUSPENDED"
          ? PLATFORM_AUDIT_ACTION.ORG_SUSPENDED
          : PLATFORM_AUDIT_ACTION.ORG_ACTIVATED,
      beforeJson: { status: existing.status },
      afterJson: { status: updated.status },
    });

    return updated;
  });
}

const subscriptionPlanSelect = {
  id: true,
  code: true,
  name: true,
  isActive: true,
  priceMonthly: true,
  priceYearly: true,
} as const;

function catalogPriceForInterval(
  plan: { priceMonthly: Prisma.Decimal; priceYearly: Prisma.Decimal },
  interval: "MONTHLY" | "YEARLY",
) {
  return interval === "YEARLY" ? plan.priceYearly : plan.priceMonthly;
}

function toSubscriptionResponse(
  organization: { id: string; status: string },
  subscription: {
    id: string;
    status: string;
    billingInterval: "MONTHLY" | "YEARLY";
    priceSnapshot: { toFixed(digits: number): string };
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    plan: { id: string; code: string; name: string };
  },
) {
  return {
    organization: { id: organization.id, status: organization.status },
    subscription: {
      id: subscription.id,
      status: subscription.status,
      billingInterval: subscription.billingInterval,
      priceSnapshot: money(subscription.priceSnapshot),
      currentPeriodStart: subscription.currentPeriodStart.toISOString(),
      currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
      plan: {
        id: subscription.plan.id,
        code: subscription.plan.code,
        name: subscription.plan.name,
      },
    },
  };
}

function subscriptionAuditPayload(row: {
  plan: { id: string; code: string };
  status: string;
  billingInterval: string;
  priceSnapshot: { toFixed(digits: number): string };
  currentPeriodEnd: Date;
}) {
  return {
    planId: row.plan.id,
    planCode: row.plan.code,
    status: row.status,
    billingInterval: row.billingInterval,
    priceSnapshot: money(row.priceSnapshot),
    currentPeriodEnd: row.currentPeriodEnd.toISOString(),
  };
}

export async function updateOrganizationSubscription(
  organizationId: string,
  input: PlatformSubscriptionPatchInput,
  platformUserId: string,
) {
  return prisma.$transaction(async (tx) => {
    const orgExists = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, status: true },
    });
    if (!orgExists) {
      throw AppError.notFound(
        ErrorCode.ORGANIZATION_NOT_FOUND,
        `Organization "${organizationId}" not found`,
      );
    }

    const existing = await tx.organizationSubscription.findUnique({
      where: { organizationId },
      include: { plan: { select: subscriptionPlanSelect } },
    });
    if (!existing) {
      throw AppError.notFound(
        ErrorCode.ORGANIZATION_SUBSCRIPTION_NOT_FOUND,
        "This organization has no SaaS subscription",
      );
    }

    let nextPlan = existing.plan;
    if (input.planId) {
      const plan = await tx.saasPlan.findUnique({
        where: { id: input.planId },
        select: subscriptionPlanSelect,
      });
      if (!plan) {
        throw AppError.notFound(ErrorCode.SAAS_PLAN_NOT_FOUND, "SaaS plan not found");
      }
      if (!plan.isActive && plan.id !== existing.planId) {
        throw AppError.conflict(
          ErrorCode.SAAS_PLAN_INACTIVE,
          "This SaaS plan is archived and cannot be assigned",
        );
      }
      nextPlan = plan;
    }

    const nextStatus = input.status ?? existing.status;
    const nextInterval = input.billingInterval ?? existing.billingInterval;
    const nextPeriodEnd = input.currentPeriodEnd
      ? new Date(input.currentPeriodEnd)
      : existing.currentPeriodEnd;

    if (Number.isNaN(nextPeriodEnd.getTime()) || nextPeriodEnd.getTime() <= existing.currentPeriodStart.getTime()) {
      throw AppError.badRequest(
        ErrorCode.VALIDATION_ERROR,
        "Period end must be after the subscription start",
      );
    }

    const planChanged = nextPlan.id !== existing.planId;
    const intervalChanged = nextInterval !== existing.billingInterval;
    const statusChanged = nextStatus !== existing.status;
    const periodChanged = nextPeriodEnd.getTime() !== existing.currentPeriodEnd.getTime();
    const nextSnapshot = planChanged || intervalChanged
      ? catalogPriceForInterval(nextPlan, nextInterval)
      : existing.priceSnapshot;
    const snapshotChanged = money(nextSnapshot) !== money(existing.priceSnapshot);
    const configChanged = planChanged || intervalChanged || statusChanged || periodChanged;

    if (!configChanged) {
      return toSubscriptionResponse(orgExists, existing);
    }

    const data: Prisma.OrganizationSubscriptionUpdateInput = {};
    if (planChanged) {
      data.plan = { connect: { id: nextPlan.id } };
    }
    if (intervalChanged) {
      data.billingInterval = nextInterval;
    }
    if (statusChanged) {
      data.status = nextStatus;
    }
    if (periodChanged) {
      data.currentPeriodEnd = nextPeriodEnd;
    }
    if (snapshotChanged) {
      data.priceSnapshot = nextSnapshot;
    }

    const updated = await tx.organizationSubscription.update({
      where: { organizationId },
      data,
      include: { plan: { select: { id: true, code: true, name: true } } },
    });

    if (planChanged) {
      await writePlatformAuditLog(tx, {
        platformUserId,
        organizationId,
        entityType: "OrganizationSubscription",
        entityId: updated.id,
        action: PLATFORM_AUDIT_ACTION.PLAN_CHANGED,
        beforeJson: { planId: existing.plan.id, planCode: existing.plan.code },
        afterJson: {
          planId: updated.plan.id,
          planCode: updated.plan.code,
          priceSnapshot: money(updated.priceSnapshot),
        },
      });
    }

    await writePlatformAuditLog(tx, {
      platformUserId,
      organizationId,
      entityType: "OrganizationSubscription",
      entityId: updated.id,
      action: PLATFORM_AUDIT_ACTION.SUBSCRIPTION_CHANGED,
      beforeJson: subscriptionAuditPayload(existing),
      afterJson: subscriptionAuditPayload(updated),
    });

    return toSubscriptionResponse(orgExists, updated);
  });
}

export { listSaasPlans } from "../saas/saas-plan.service";

/**
 * Fleet counts (10.7). `trialsEnding` = TRIAL rows whose period end is on or before 14 days
 * from today (UTC). `signupsThisPeriod` = organizations created in the current UTC calendar month.
 */
export async function getPlatformDashboard() {
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const trialsCutoff = addDays(todayUtc(), 14);

  const [activeOrgs, suspendedOrgs, trialsEnding, signupsThisPeriod] = await Promise.all([
    prisma.organization.count({ where: { status: "ACTIVE" } }),
    prisma.organization.count({ where: { status: "SUSPENDED" } }),
    prisma.organizationSubscription.count({
      where: { status: "TRIAL", currentPeriodEnd: { lte: trialsCutoff } },
    }),
    prisma.organization.count({ where: { createdAt: { gte: monthStart } } }),
  ]);

  return {
    organizationsByStatus: { ACTIVE: activeOrgs, SUSPENDED: suspendedOrgs },
    trialsEnding,
    signupsThisPeriod,
  };
}
