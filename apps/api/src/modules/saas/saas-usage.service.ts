import { AppError } from "../../lib/app-error";
import { ErrorCode } from "../../lib/error-codes";
import { prisma } from "../../lib/prisma";
import { isSaasLimitEntitlementKey, SAAS_ENTITLEMENT_KEY } from "./saas-catalog";
import {
  countOrganizationResourceUsage,
  type OrganizationEntitlement,
} from "./saas-entitlements.service";

export const USAGE_UNAVAILABLE_REASON = "NO_CONSUMPTION_PATH" as const;

export interface CountUsage {
  used: number;
  limit: number | null;
  unlimited: boolean;
  remaining: number | null;
  overLimit: boolean;
}

export interface UnavailableUsage {
  available: false;
  reason: typeof USAGE_UNAVAILABLE_REASON;
}

export interface FeatureFlag {
  enabled: boolean;
}

export interface OrganizationUsagePayload {
  organization: { id: string; name: string; slug: string };
  subscription: {
    id: string;
    status: string;
    billingInterval: string;
    plan: { id: string; code: string; name: string };
  } | null;
  usage: {
    members: CountUsage;
    branches: CountUsage;
    staff: CountUsage;
    trainers: CountUsage;
    leads: CountUsage;
    storage: UnavailableUsage;
    monthlySms: UnavailableUsage;
    whatsapp: UnavailableUsage;
    onlinePayments: UnavailableUsage;
  };
  features: {
    leads: FeatureFlag;
    trainers: FeatureFlag;
    reports: FeatureFlag;
    notifications: FeatureFlag;
    whatsapp: FeatureFlag;
    onlinePayments: FeatureFlag;
  };
}

const UNAVAILABLE: UnavailableUsage = {
  available: false,
  reason: USAGE_UNAVAILABLE_REASON,
};

function entitlementByKey(
  rows: OrganizationEntitlement[],
  key: string,
): OrganizationEntitlement | undefined {
  return rows.find((row) => row.key === key);
}

/**
 * LIMIT: used vs intValue; missing key fail-closes as limit 0.
 * UNLIMITED: used only; remaining/limit are null.
 * BOOLEAN: report the real count, but do not invent a numeric cap from the flag.
 */
function countUsage(
  used: number,
  entitlement: OrganizationEntitlement | undefined,
  key: string,
): CountUsage {
  if (entitlement?.valueType === "UNLIMITED") {
    return {
      used,
      limit: null,
      unlimited: true,
      remaining: null,
      overLimit: false,
    };
  }

  if (entitlement?.valueType === "BOOLEAN" || (!entitlement && !isSaasLimitEntitlementKey(key))) {
    return {
      used,
      limit: null,
      unlimited: false,
      remaining: null,
      overLimit: false,
    };
  }

  const limit = entitlement?.valueType === "LIMIT" ? (entitlement.intValue ?? 0) : 0;
  return {
    used,
    limit,
    unlimited: false,
    remaining: Math.max(limit - used, 0),
    overLimit: used > limit,
  };
}

function featureEnabled(entitlement: OrganizationEntitlement | undefined): FeatureFlag {
  return { enabled: entitlement?.valueType === "BOOLEAN" && entitlement.boolValue === true };
}

/**
 * Live usage against the current plan. Counts are aggregate queries (not per-row).
 * storage / monthly SMS / WhatsApp / online payments have no consumption path — unavailable,
 * never a fake zero.
 */
export async function getOrganizationUsage(organizationId: string): Promise<OrganizationUsagePayload> {
  const [org, counts] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        slug: true,
        subscription: {
          select: {
            id: true,
            status: true,
            billingInterval: true,
            plan: {
              select: {
                id: true,
                code: true,
                name: true,
                entitlements: {
                  select: { key: true, valueType: true, intValue: true, boolValue: true },
                },
              },
            },
          },
        },
      },
    }),
    countOrganizationResourceUsage(organizationId),
  ]);

  if (!org) {
    throw AppError.notFound(ErrorCode.ORGANIZATION_NOT_FOUND, `Organization "${organizationId}" not found`);
  }

  const entitlements = org.subscription?.plan.entitlements ?? [];

  return {
    organization: {
      id: org.id,
      name: org.name,
      slug: org.slug,
    },
    subscription: org.subscription
      ? {
          id: org.subscription.id,
          status: org.subscription.status,
          billingInterval: org.subscription.billingInterval,
          plan: {
            id: org.subscription.plan.id,
            code: org.subscription.plan.code,
            name: org.subscription.plan.name,
          },
        }
      : null,
    usage: {
      members: countUsage(
        counts.members,
        entitlementByKey(entitlements, SAAS_ENTITLEMENT_KEY.MEMBERS_MAX),
        SAAS_ENTITLEMENT_KEY.MEMBERS_MAX,
      ),
      branches: countUsage(
        counts.branches,
        entitlementByKey(entitlements, SAAS_ENTITLEMENT_KEY.BRANCHES_MAX),
        SAAS_ENTITLEMENT_KEY.BRANCHES_MAX,
      ),
      staff: countUsage(
        counts.staff,
        entitlementByKey(entitlements, SAAS_ENTITLEMENT_KEY.STAFF_MAX),
        SAAS_ENTITLEMENT_KEY.STAFF_MAX,
      ),
      trainers: countUsage(
        counts.trainers,
        entitlementByKey(entitlements, SAAS_ENTITLEMENT_KEY.TRAINERS),
        SAAS_ENTITLEMENT_KEY.TRAINERS,
      ),
      leads: countUsage(
        counts.leads,
        entitlementByKey(entitlements, SAAS_ENTITLEMENT_KEY.LEADS),
        SAAS_ENTITLEMENT_KEY.LEADS,
      ),
      storage: UNAVAILABLE,
      monthlySms: UNAVAILABLE,
      whatsapp: UNAVAILABLE,
      onlinePayments: UNAVAILABLE,
    },
    features: {
      leads: featureEnabled(entitlementByKey(entitlements, SAAS_ENTITLEMENT_KEY.LEADS)),
      trainers: featureEnabled(entitlementByKey(entitlements, SAAS_ENTITLEMENT_KEY.TRAINERS)),
      reports: featureEnabled(entitlementByKey(entitlements, SAAS_ENTITLEMENT_KEY.REPORTS_ENABLED)),
      notifications: featureEnabled(entitlementByKey(entitlements, SAAS_ENTITLEMENT_KEY.NOTIFICATIONS_ENABLED)),
      whatsapp: featureEnabled(entitlementByKey(entitlements, SAAS_ENTITLEMENT_KEY.WHATSAPP_ENABLED)),
      onlinePayments: featureEnabled(entitlementByKey(entitlements, SAAS_ENTITLEMENT_KEY.ONLINE_PAYMENTS_ENABLED)),
    },
  };
}
