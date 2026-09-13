import { AppError } from "../../lib/app-error";
import { ErrorCode } from "../../lib/error-codes";
import { prisma, type TransactionClient } from "../../lib/prisma";
import { SAAS_ENTITLEMENT_KEY } from "./saas-catalog";

export interface OrganizationEntitlement {
  key: string;
  valueType: "BOOLEAN" | "LIMIT" | "UNLIMITED";
  intValue: number | null;
  boolValue: boolean | null;
}

export interface OrganizationSaasSnapshot {
  organizationId: string;
  subscriptionId: string;
  status: string;
  plan: { id: string; code: string; name: string };
  entitlements: OrganizationEntitlement[];
}

/** Public gym `/auth/me` SaaS payload (15.10 / 10.12). Informational — not an authorization input. */
export interface GymAuthSaas {
  subscription: { id: string; status: string };
  plan: { id: string; code: string; name: string };
  entitlements: Record<
    string,
    { valueType: OrganizationEntitlement["valueType"]; intValue: number | null; boolValue: boolean | null }
  >;
}

export function toGymAuthSaas(snapshot: OrganizationSaasSnapshot | null): GymAuthSaas | null {
  if (!snapshot) return null;
  return {
    subscription: { id: snapshot.subscriptionId, status: snapshot.status },
    plan: snapshot.plan,
    entitlements: Object.fromEntries(
      snapshot.entitlements.map((row) => [
        row.key,
        { valueType: row.valueType, intValue: row.intValue, boolValue: row.boolValue },
      ]),
    ),
  };
}

export interface AssertEntitlementOptions {
  /** How many new rows this write will add. Default 1. Ignored for BOOLEAN. */
  delta?: number;
  db?: TransactionClient;
}

/**
 * Read-only SaaS snapshot for one organization. Callers must pass the org id from JWT /
 * provisioned tenant context — never from an untrusted client body.
 */
export async function getOrganizationSaasSnapshot(
  organizationId: string,
  db: TransactionClient = prisma,
): Promise<OrganizationSaasSnapshot | null> {
  const subscription = await db.organizationSubscription.findUnique({
    where: { organizationId },
    include: {
      plan: { include: { entitlements: true } },
    },
  });
  if (!subscription) return null;

  return {
    organizationId: subscription.organizationId,
    subscriptionId: subscription.id,
    status: subscription.status,
    plan: {
      id: subscription.plan.id,
      code: subscription.plan.code,
      name: subscription.plan.name,
    },
    entitlements: subscription.plan.entitlements.map((row) => ({
      key: row.key,
      valueType: row.valueType,
      intValue: row.intValue,
      boolValue: row.boolValue,
    })),
  };
}

function isLimitKey(key: string): boolean {
  return key.endsWith(".max");
}

async function currentUsage(
  db: TransactionClient,
  organizationId: string,
  key: string,
): Promise<number> {
  switch (key) {
    case SAAS_ENTITLEMENT_KEY.MEMBERS_MAX:
      return db.member.count({
        where: { organizationId, deletedAt: null, status: { not: "ARCHIVED" } },
      });
    case SAAS_ENTITLEMENT_KEY.STAFF_MAX:
      return db.user.count({
        where: { organizationId, deletedAt: null },
      });
    case SAAS_ENTITLEMENT_KEY.BRANCHES_MAX:
      return db.branch.count({ where: { organizationId } });
    default:
      return 0;
  }
}

/**
 * Write-time SaaS gate (Phase 15.6 / Section 10.12).
 * Must run inside the same transaction that already locked the organization row
 * (`SELECT … FOR UPDATE`) so COUNT + insert cannot race under REPEATABLE READ.
 */
export async function assertEntitlement(
  organizationId: string,
  key: string,
  options: AssertEntitlementOptions = {},
): Promise<void> {
  const db = options.db ?? prisma;
  const delta = options.delta ?? 1;
  const snapshot = await getOrganizationSaasSnapshot(organizationId, db);
  const entitlement = snapshot?.entitlements.find((row) => row.key === key);

  if (!entitlement) {
    if (isLimitKey(key)) {
      throw new AppError(
        403,
        ErrorCode.PLAN_LIMIT_REACHED,
        "This organization's plan has reached its limit for this action",
        { key },
      );
    }
    throw new AppError(
      403,
      ErrorCode.FEATURE_DISABLED,
      "This organization's plan does not include this feature",
      { key },
    );
  }

  if (entitlement.valueType === "UNLIMITED") {
    return;
  }

  if (entitlement.valueType === "BOOLEAN") {
    if (entitlement.boolValue === true) return;
    throw new AppError(
      403,
      ErrorCode.FEATURE_DISABLED,
      "This organization's plan does not include this feature",
      { key },
    );
  }

  const limit = entitlement.intValue ?? 0;
  const used = await currentUsage(db, organizationId, key);
  if (used + delta > limit) {
    throw new AppError(
      403,
      ErrorCode.PLAN_LIMIT_REACHED,
      "This organization's plan has reached its limit for this action",
      { key },
    );
  }
}
