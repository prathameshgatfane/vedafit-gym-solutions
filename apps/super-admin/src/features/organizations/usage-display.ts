import { entitlementLabel, SAAS_ENTITLEMENT_DEFS } from "../plans/entitlement-catalog";
import type { CountUsage, EntitlementRow, UnavailableUsage, UsageMetric } from "./organization.types";

export const USAGE_LABELS = {
  members: "Members",
  branches: "Branches",
  staff: "Staff",
  trainers: "Trainers",
  leads: "Leads",
  storage: "Storage usage",
  monthlySms: "Monthly SMS usage",
  whatsapp: "WhatsApp usage",
  onlinePayments: "Online payment usage",
} as const;

export const FEATURE_LABELS = {
  leads: "Leads",
  trainers: "Trainers",
  reports: "Reports",
  notifications: "Notifications",
  whatsapp: "WhatsApp",
  onlinePayments: "Online Payments",
} as const;

const UNAVAILABLE_REASON_COPY: Record<string, string> = {
  NO_CONSUMPTION_PATH: "No consumption path currently implemented.",
};

export function isUnavailableUsage(value: UsageMetric): value is UnavailableUsage {
  return "available" in value && value.available === false;
}

export function isCountUsage(value: UsageMetric): value is CountUsage {
  return !isUnavailableUsage(value) && typeof (value as CountUsage).used === "number";
}

export function unavailableReasonCopy(reason: string): string {
  return UNAVAILABLE_REASON_COPY[reason] ?? reason;
}

export function overLimitBy(used: number, limit: number): number {
  return Math.max(used - limit, 0);
}

export function formatFeatureState(enabled: boolean): string {
  return enabled ? "Enabled" : "Disabled";
}

export function orderedEntitlements(rows: EntitlementRow[]): EntitlementRow[] {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const known = SAAS_ENTITLEMENT_DEFS.flatMap((def) => {
    const row = byKey.get(def.key);
    return row ? [row] : [];
  });
  const extras = rows.filter((row) => !SAAS_ENTITLEMENT_DEFS.some((def) => def.key === row.key));
  return [...known, ...extras];
}

export function entitlementDisplayLabel(key: string): string {
  return entitlementLabel(key);
}
