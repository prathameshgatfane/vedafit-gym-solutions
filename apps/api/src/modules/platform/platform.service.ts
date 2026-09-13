import type { Prisma } from "@prisma/client";
import { AppError } from "../../lib/app-error";
import { ErrorCode } from "../../lib/error-codes";
import { logger } from "../../lib/logger";
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
 * Super Admin create (15.8 / 10.7). Same provisioning as public signup; the client still cannot
 * choose plan or org status. Does not issue tokens. Audit row is 15.11.
 */
export async function createOrganizationAsOperator(
  input: PlatformSignupInput,
  platformUserId: string,
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
      include: { plan: { select: { id: true, code: true } } },
    });
    if (!existing) {
      throw AppError.notFound(
        ErrorCode.ORGANIZATION_SUBSCRIPTION_NOT_FOUND,
        "This organization has no SaaS subscription",
      );
    }

    const data: Prisma.OrganizationSubscriptionUpdateInput = {};
    let nextPlan: { id: string; code: string; name: string } | null = null;

    if (input.planId) {
      const plan = await tx.saasPlan.findUnique({ where: { id: input.planId } });
      if (!plan) {
        throw AppError.notFound(ErrorCode.SAAS_PLAN_NOT_FOUND, "SaaS plan not found");
      }
      nextPlan = { id: plan.id, code: plan.code, name: plan.name };
      data.plan = { connect: { id: plan.id } };
      data.priceSnapshot =
        existing.billingInterval === "YEARLY" ? plan.priceYearly : plan.priceMonthly;
    }

    if (input.status) {
      data.status = input.status;
    }

    if (input.currentPeriodEnd) {
      data.currentPeriodEnd = new Date(input.currentPeriodEnd);
    }

    const updated = await tx.organizationSubscription.update({
      where: { organizationId },
      data,
      include: { plan: { select: { id: true, code: true, name: true } } },
    });

    const beforePeriodEnd = existing.currentPeriodEnd.toISOString();
    const afterPeriodEnd = updated.currentPeriodEnd.toISOString();
    const planChanged = Boolean(nextPlan && nextPlan.id !== existing.plan.id);

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
      beforeJson: {
        planId: existing.plan.id,
        planCode: existing.plan.code,
        status: existing.status,
        currentPeriodEnd: beforePeriodEnd,
      },
      afterJson: {
        planId: updated.plan.id,
        planCode: updated.plan.code,
        status: updated.status,
        currentPeriodEnd: afterPeriodEnd,
        priceSnapshot: money(updated.priceSnapshot),
      },
    });

    return {
      organization: { id: orgExists.id, status: orgExists.status },
      subscription: {
        id: updated.id,
        status: updated.status,
        billingInterval: updated.billingInterval,
        priceSnapshot: money(updated.priceSnapshot),
        currentPeriodStart: updated.currentPeriodStart.toISOString(),
        currentPeriodEnd: afterPeriodEnd,
        plan: updated.plan,
      },
    };
  });
}

export async function listSaasPlans() {
  const plans = await prisma.saasPlan.findMany({
    orderBy: { code: "asc" },
    include: { entitlements: { orderBy: { key: "asc" } } },
  });

  return plans.map((plan) => ({
    id: plan.id,
    code: plan.code,
    name: plan.name,
    description: plan.description,
    priceMonthly: money(plan.priceMonthly),
    priceYearly: money(plan.priceYearly),
    currency: plan.currency,
    trialDays: plan.trialDays,
    isActive: plan.isActive,
    entitlements: plan.entitlements.map((row) => ({
      key: row.key,
      valueType: row.valueType,
      intValue: row.intValue,
      boolValue: row.boolValue,
    })),
  }));
}

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
