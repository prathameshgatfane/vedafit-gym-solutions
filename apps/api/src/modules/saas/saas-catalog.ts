import type { OrganizationSubscriptionStatus, SaasBillingInterval } from "@prisma/client";
import { env } from "../../config/env";
import { generateId } from "../../lib/id";
import { prisma, withGeneratedId, type TransactionClient } from "../../lib/prisma";
import { addDays } from "../../utils/dates";

/** Section 10.11 seed catalog codes — stable identifiers, not display names. */
export const SAAS_PLAN_CODE = {
  TRIAL: "trial",
  STARTER: "starter",
  GROWTH: "growth",
} as const;

export const SAAS_ENTITLEMENT_KEY = {
  MEMBERS_MAX: "members.max",
  BRANCHES_MAX: "branches.max",
  STAFF_MAX: "staff.max",
  LEADS: "leads",
  TRAINERS: "trainers",
  REPORTS_ENABLED: "reports.enabled",
  NOTIFICATIONS_ENABLED: "notifications.enabled",
  WHATSAPP_ENABLED: "whatsapp.enabled",
  ONLINE_PAYMENTS_ENABLED: "online_payments.enabled",
  STORAGE_MAX: "storage.max",
  MONTHLY_SMS_MAX: "monthly_sms.max",
} as const;

type EntitlementSeed =
  | { key: string; valueType: "LIMIT"; intValue: number }
  | { key: string; valueType: "UNLIMITED" }
  | { key: string; valueType: "BOOLEAN"; boolValue: boolean };

interface PlanSeed {
  code: string;
  name: string;
  description: string;
  priceMonthly: string;
  priceYearly: string;
  trialDays: number;
  entitlements: EntitlementSeed[];
}

const COMMON_MODULE_FLAGS: EntitlementSeed[] = [
  { key: SAAS_ENTITLEMENT_KEY.REPORTS_ENABLED, valueType: "BOOLEAN", boolValue: true },
  { key: SAAS_ENTITLEMENT_KEY.NOTIFICATIONS_ENABLED, valueType: "BOOLEAN", boolValue: true },
  { key: SAAS_ENTITLEMENT_KEY.WHATSAPP_ENABLED, valueType: "BOOLEAN", boolValue: false },
  { key: SAAS_ENTITLEMENT_KEY.ONLINE_PAYMENTS_ENABLED, valueType: "BOOLEAN", boolValue: false },
  { key: SAAS_ENTITLEMENT_KEY.STORAGE_MAX, valueType: "LIMIT", intValue: 0 },
  { key: SAAS_ENTITLEMENT_KEY.MONTHLY_SMS_MAX, valueType: "LIMIT", intValue: 0 },
];

/**
 * v1 catalog from DEVELOPMENT_PLAN.md 10.11. Prices are INR stubs (0.00), not a commercial
 * promise — Super Admin can change them later. WhatsApp / storage / online payments keys exist
 * so 15.6 can refuse them; those products are not built in Phase 15.
 */
export const SAAS_PLAN_CATALOG: PlanSeed[] = [
  {
    code: SAAS_PLAN_CODE.TRIAL,
    name: "Trial",
    description: "Default signup trial",
    priceMonthly: "0.00",
    priceYearly: "0.00",
    trialDays: 14,
    entitlements: [
      { key: SAAS_ENTITLEMENT_KEY.MEMBERS_MAX, valueType: "LIMIT", intValue: 50 },
      { key: SAAS_ENTITLEMENT_KEY.BRANCHES_MAX, valueType: "LIMIT", intValue: 1 },
      { key: SAAS_ENTITLEMENT_KEY.STAFF_MAX, valueType: "LIMIT", intValue: 3 },
      { key: SAAS_ENTITLEMENT_KEY.LEADS, valueType: "BOOLEAN", boolValue: false },
      { key: SAAS_ENTITLEMENT_KEY.TRAINERS, valueType: "BOOLEAN", boolValue: false },
      ...COMMON_MODULE_FLAGS,
    ],
  },
  {
    code: SAAS_PLAN_CODE.STARTER,
    name: "Starter",
    description: "Paid stub — not a pricing promise",
    priceMonthly: "0.00",
    priceYearly: "0.00",
    trialDays: 14,
    entitlements: [
      { key: SAAS_ENTITLEMENT_KEY.MEMBERS_MAX, valueType: "LIMIT", intValue: 200 },
      { key: SAAS_ENTITLEMENT_KEY.BRANCHES_MAX, valueType: "LIMIT", intValue: 1 },
      { key: SAAS_ENTITLEMENT_KEY.STAFF_MAX, valueType: "LIMIT", intValue: 8 },
      { key: SAAS_ENTITLEMENT_KEY.LEADS, valueType: "BOOLEAN", boolValue: true },
      { key: SAAS_ENTITLEMENT_KEY.TRAINERS, valueType: "BOOLEAN", boolValue: true },
      ...COMMON_MODULE_FLAGS,
    ],
  },
  {
    code: SAAS_PLAN_CODE.GROWTH,
    name: "Growth",
    description: "Paid stub / Demo Gym backfill — members and staff unlimited",
    priceMonthly: "0.00",
    priceYearly: "0.00",
    trialDays: 14,
    entitlements: [
      { key: SAAS_ENTITLEMENT_KEY.MEMBERS_MAX, valueType: "UNLIMITED" },
      { key: SAAS_ENTITLEMENT_KEY.BRANCHES_MAX, valueType: "LIMIT", intValue: 5 },
      { key: SAAS_ENTITLEMENT_KEY.STAFF_MAX, valueType: "UNLIMITED" },
      { key: SAAS_ENTITLEMENT_KEY.LEADS, valueType: "BOOLEAN", boolValue: true },
      { key: SAAS_ENTITLEMENT_KEY.TRAINERS, valueType: "BOOLEAN", boolValue: true },
      ...COMMON_MODULE_FLAGS,
    ],
  },
];

export async function syncSaasPlanCatalog(db: TransactionClient = prisma): Promise<void> {
  for (const plan of SAAS_PLAN_CATALOG) {
    const existing = await db.saasPlan.findUnique({ where: { code: plan.code } });
    const planId = existing?.id ?? generateId();

    if (existing) {
      await db.saasPlan.update({
        where: { id: existing.id },
        data: {
          name: plan.name,
          description: plan.description,
          priceMonthly: plan.priceMonthly,
          priceYearly: plan.priceYearly,
          currency: "INR",
          trialDays: plan.trialDays,
          isActive: true,
        },
      });
    } else {
      await db.saasPlan.create({
        data: {
          id: planId,
          code: plan.code,
          name: plan.name,
          description: plan.description,
          priceMonthly: plan.priceMonthly,
          priceYearly: plan.priceYearly,
          currency: "INR",
          trialDays: plan.trialDays,
          isActive: true,
        },
      });
    }

    for (const entitlement of plan.entitlements) {
      await db.saasPlanEntitlement.upsert({
        where: { planId_key: { planId, key: entitlement.key } },
        update: {
          valueType: entitlement.valueType,
          intValue: entitlement.valueType === "LIMIT" ? entitlement.intValue : null,
          boolValue: entitlement.valueType === "BOOLEAN" ? entitlement.boolValue : null,
        },
        create: {
          id: generateId(),
          planId,
          key: entitlement.key,
          valueType: entitlement.valueType,
          intValue: entitlement.valueType === "LIMIT" ? entitlement.intValue : null,
          boolValue: entitlement.valueType === "BOOLEAN" ? entitlement.boolValue : null,
        },
      });
    }
  }
}

export interface AttachSubscriptionInput {
  organizationId: string;
  planCode: string;
  status: OrganizationSubscriptionStatus;
  billingInterval?: SaasBillingInterval;
}

function periodEnd(
  start: Date,
  status: OrganizationSubscriptionStatus,
  interval: SaasBillingInterval,
  trialDays: number,
): Date {
  if (status === "TRIAL") {
    return addDays(start, trialDays);
  }
  return addDays(start, interval === "YEARLY" ? 365 : 30);
}

/**
 * Creates the single live subscription for a new org. Caller must already be in a transaction
 * that created the organization. Does not overwrite an existing row.
 */
export async function attachOrganizationSubscription(
  tx: TransactionClient,
  input: AttachSubscriptionInput,
): Promise<{ id: string; planCode: string; status: OrganizationSubscriptionStatus }> {
  const existing = await tx.organizationSubscription.findUnique({
    where: { organizationId: input.organizationId },
  });
  if (existing) {
    const plan = await tx.saasPlan.findUnique({ where: { id: existing.planId } });
    return { id: existing.id, planCode: plan?.code ?? input.planCode, status: existing.status };
  }

  const plan = await tx.saasPlan.findUnique({ where: { code: input.planCode } });
  if (!plan) {
    throw new Error(`SaaS plan "${input.planCode}" is missing — syncSaasPlanCatalog first`);
  }

  const interval = input.billingInterval ?? "MONTHLY";
  const start = new Date();
  const created = await tx.organizationSubscription.create({
    data: withGeneratedId({
      organizationId: input.organizationId,
      planId: plan.id,
      status: input.status,
      billingInterval: interval,
      priceSnapshot: plan.priceMonthly,
      currentPeriodStart: start,
      currentPeriodEnd: periodEnd(start, input.status, interval, env.SAAS_TRIAL_DAYS),
    }),
  });

  return { id: created.id, planCode: plan.code, status: created.status };
}

/**
 * Seed / backfill: if the org has no subscription, attach `planCode`. Existing rows are left
 * alone so a re-seed cannot duplicate or silently rewrite a later Super Admin assignment.
 */
export async function ensureOrganizationSubscription(
  organizationId: string,
  input: Omit<AttachSubscriptionInput, "organizationId">,
  db: TransactionClient = prisma,
): Promise<{ id: string; created: boolean; planCode: string }> {
  const existing = await db.organizationSubscription.findUnique({
    where: { organizationId },
    include: { plan: true },
  });
  if (existing) {
    return { id: existing.id, created: false, planCode: existing.plan.code };
  }

  const attached = await attachOrganizationSubscription(db, { organizationId, ...input });
  return { id: attached.id, created: true, planCode: attached.planCode };
}

export async function backfillMissingOrganizationSubscriptions(
  db: TransactionClient = prisma,
): Promise<number> {
  const orgs = await db.organization.findMany({
    where: { subscription: { is: null } },
    select: { id: true },
  });
  for (const org of orgs) {
    await ensureOrganizationSubscription(
      org.id,
      {
        planCode: SAAS_PLAN_CODE.GROWTH,
        status: "ACTIVE",
        billingInterval: "YEARLY",
      },
      db,
    );
  }
  return orgs.length;
}
