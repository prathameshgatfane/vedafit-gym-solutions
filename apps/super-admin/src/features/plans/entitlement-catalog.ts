import type { EntitlementRow } from "../organizations/organization.types";

export const SAAS_ENTITLEMENT_DEFS = [
  { key: "members.max", label: "Maximum members", kind: "limit" },
  { key: "branches.max", label: "Maximum branches", kind: "limit" },
  { key: "staff.max", label: "Maximum staff users", kind: "limit" },
  { key: "leads", label: "Leads and CRM", kind: "boolean" },
  { key: "trainers", label: "Trainer module", kind: "boolean" },
  { key: "reports.enabled", label: "Reports", kind: "boolean" },
  { key: "notifications.enabled", label: "Notifications", kind: "boolean" },
  { key: "whatsapp.enabled", label: "WhatsApp integration", kind: "boolean" },
  { key: "online_payments.enabled", label: "Online payments", kind: "boolean" },
  { key: "storage.max", label: "Storage limit", kind: "limit" },
  { key: "monthly_sms.max", label: "Monthly SMS limit", kind: "limit" },
] as const;

export type SaasEntitlementKey = (typeof SAAS_ENTITLEMENT_DEFS)[number]["key"];

export const SAAS_ENTITLEMENT_KEYS = SAAS_ENTITLEMENT_DEFS.map((row) => row.key);

const LABEL_BY_KEY = Object.fromEntries(
  SAAS_ENTITLEMENT_DEFS.map((row) => [row.key, row.label]),
) as Record<string, string>;

export function entitlementLabel(key: string): string {
  return LABEL_BY_KEY[key] ?? key;
}

export function isLimitEntitlementKey(key: string): boolean {
  return key.endsWith(".max");
}

export function formatEntitlementValue(row: Pick<EntitlementRow, "valueType" | "intValue" | "boolValue">): string {
  if (row.valueType === "UNLIMITED") return "Unlimited";
  if (row.valueType === "BOOLEAN") return row.boolValue ? "Enabled" : "Disabled";
  if (row.intValue === null || row.intValue === undefined) return "—";
  return String(row.intValue);
}

/** Restrictive defaults for a new plan — Trial catalog, not Growth. */
export function defaultEntitlementRows(): EntitlementRow[] {
  return SAAS_ENTITLEMENT_DEFS.map((def) => {
    if (def.kind === "boolean") {
      const enabled = def.key === "reports.enabled" || def.key === "notifications.enabled";
      return { key: def.key, valueType: "BOOLEAN", intValue: null, boolValue: enabled };
    }
    if (def.key === "members.max") {
      return { key: def.key, valueType: "LIMIT", intValue: 50, boolValue: null };
    }
    if (def.key === "branches.max") {
      return { key: def.key, valueType: "LIMIT", intValue: 1, boolValue: null };
    }
    if (def.key === "staff.max") {
      return { key: def.key, valueType: "LIMIT", intValue: 3, boolValue: null };
    }
    return { key: def.key, valueType: "LIMIT", intValue: 0, boolValue: null };
  });
}

export function completeEntitlementRows(existing: EntitlementRow[] = []): EntitlementRow[] {
  const byKey = new Map(existing.map((row) => [row.key, row]));
  return defaultEntitlementRows().map((fallback) => byKey.get(fallback.key) ?? fallback);
}
