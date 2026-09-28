import { formatWhen } from "../../lib/format";
import { formatPrice } from "../../lib/money";
import { entitlementLabel, formatEntitlementValue } from "../plans/entitlement-catalog";
import type { EntitlementRow, OrganizationDetail, SubscriptionStatus } from "./organization.types";
import type { SaasPlan } from "../plans/plan.types";
import type { SubscriptionFormValues } from "./organization.schema";

export type BillingInterval = "MONTHLY" | "YEARLY";

const IMPACT_LABELS: Record<string, string> = {
  "members.max": "Members",
  "branches.max": "Branches",
  "staff.max": "Staff",
  leads: "Leads",
};

export function catalogPriceForInterval(
  plan: Pick<SaasPlan, "priceMonthly" | "priceYearly">,
  interval: BillingInterval,
): string {
  return interval === "YEARLY" ? plan.priceYearly : plan.priceMonthly;
}

export function resolveSubscriptionDraft(
  current: NonNullable<OrganizationDetail["subscription"]>,
  values: SubscriptionFormValues,
  periodEndIso?: string,
) {
  const status = (values.status || current.status) as SubscriptionStatus;
  const billingInterval = (values.billingInterval || current.billingInterval) as BillingInterval;
  return {
    planId: values.planId || current.plan.id,
    status,
    billingInterval,
    currentPeriodEnd: periodEndIso ?? current.currentPeriodEnd,
  };
}

export function formatEntitlementImpact(from: EntitlementRow, to: EntitlementRow): string {
  const left = formatEntitlementValue(from);
  const right = formatEntitlementValue(to);
  if (left === right) return `${left} (unchanged)`;
  return `${left} → ${right}`;
}

export function entitlementImpactRows(
  currentPlan: Pick<SaasPlan, "entitlements"> | undefined,
  nextPlan: Pick<SaasPlan, "entitlements"> | undefined,
): Array<{ key: string; label: string; summary: string; changed: boolean }> {
  if (!currentPlan || !nextPlan) return [];
  const currentByKey = new Map(currentPlan.entitlements.map((row) => [row.key, row]));
  const nextByKey = new Map(nextPlan.entitlements.map((row) => [row.key, row]));
  const keys = [...new Set([...currentByKey.keys(), ...nextByKey.keys()])];
  return keys.flatMap((key) => {
    const from = currentByKey.get(key);
    const to = nextByKey.get(key);
    if (!from || !to) return [];
    const left = formatEntitlementValue(from);
    const right = formatEntitlementValue(to);
    return [
      {
        key,
        label: IMPACT_LABELS[key] ?? entitlementLabel(key),
        summary: left === right ? `${left} (unchanged)` : `${left} → ${right}`,
        changed: left !== right,
      },
    ];
  });
}

export function subscriptionConfirmCopy(input: {
  organizationName: string;
  current: NonNullable<OrganizationDetail["subscription"]>;
  next: {
    plan: Pick<SaasPlan, "id" | "name" | "code" | "priceMonthly" | "priceYearly" | "entitlements">;
    status: SubscriptionStatus;
    billingInterval: BillingInterval;
    catalogPrice: string;
    currentPeriodEnd: string;
  };
  currentPlan?: Pick<SaasPlan, "entitlements">;
}) {
  const planChanged = input.next.plan.id !== input.current.plan.id;
  return {
    organizationName: input.organizationName,
    current: {
      plan: `${input.current.plan.name} (${input.current.plan.code})`,
      status: input.current.status,
      billingInterval: input.current.billingInterval,
      priceSnapshot: formatPrice(input.current.priceSnapshot),
      currentPeriodEnd: formatWhen(input.current.currentPeriodEnd),
    },
    next: {
      plan: `${input.next.plan.name} (${input.next.plan.code})`,
      status: input.next.status,
      billingInterval: input.next.billingInterval,
      catalogPrice: formatPrice(input.next.catalogPrice),
      currentPeriodEnd: formatWhen(input.next.currentPeriodEnd),
    },
    planChanged,
    entitlementImpact: planChanged
      ? entitlementImpactRows(input.currentPlan, input.next.plan)
      : [],
  };
}
