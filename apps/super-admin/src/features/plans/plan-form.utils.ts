import type { EntitlementRow } from "../organizations/organization.types";
import {
  completeEntitlementRows,
  entitlementLabel,
  formatEntitlementValue,
} from "./entitlement-catalog";
import type { PlanFormValues } from "./plan.schema";
import type { CreateSaasPlanInput, SaasPlan, SaasPlanEntitlementInput } from "./plan.types";

export function toFormEntitlements(rows: EntitlementRow[]): PlanFormValues["entitlements"] {
  return completeEntitlementRows(rows).map((row) => ({
    key: row.key,
    valueType: row.valueType,
    intValue: row.valueType === "LIMIT" ? String(row.intValue ?? 0) : "",
    boolValue: row.valueType === "BOOLEAN" ? row.boolValue === true : undefined,
  }));
}

export function emptyPlanFormValues(): PlanFormValues {
  return {
    name: "",
    code: "",
    description: "",
    priceMonthly: "0.00",
    priceYearly: "0.00",
    currency: "INR",
    trialDays: 14,
    entitlements: toFormEntitlements([]),
  };
}

export function planToFormValues(plan: SaasPlan): PlanFormValues {
  return {
    name: plan.name,
    code: plan.code,
    description: plan.description ?? "",
    priceMonthly: plan.priceMonthly,
    priceYearly: plan.priceYearly,
    currency: plan.currency,
    trialDays: plan.trialDays,
    entitlements: toFormEntitlements(plan.entitlements),
  };
}

export function toApiEntitlements(
  rows: PlanFormValues["entitlements"],
): SaasPlanEntitlementInput[] {
  return rows.map((row) => {
    if (row.valueType === "UNLIMITED") {
      return { key: row.key, valueType: "UNLIMITED" };
    }
    if (row.valueType === "BOOLEAN") {
      return { key: row.key, valueType: "BOOLEAN", boolValue: row.boolValue === true };
    }
    return {
      key: row.key,
      valueType: "LIMIT",
      intValue: Number(row.intValue),
    };
  });
}

export function toCreatePlanInput(values: PlanFormValues): CreateSaasPlanInput {
  return {
    code: values.code,
    name: values.name,
    description: values.description || null,
    priceMonthly: values.priceMonthly,
    priceYearly: values.priceYearly,
    currency: values.currency,
    trialDays: values.trialDays,
    entitlements: toApiEntitlements(values.entitlements),
  };
}

export function formatEntitlementLine(row: {
  key: string;
  valueType: EntitlementRow["valueType"];
  intValue?: number | null | string;
  boolValue?: boolean | null;
}): string {
  const intValue =
    typeof row.intValue === "string" ? Number(row.intValue) : (row.intValue ?? null);
  return `${entitlementLabel(row.key)}: ${formatEntitlementValue({
    valueType: row.valueType,
    intValue: Number.isFinite(intValue) ? intValue : null,
    boolValue: row.boolValue ?? null,
  })}`;
}

export function planChangeLines(before: PlanFormValues, after: PlanFormValues): string[] {
  const lines: string[] = [];
  const fields: Array<keyof Pick<PlanFormValues, "name" | "description" | "priceMonthly" | "priceYearly" | "currency" | "trialDays">> =
    ["name", "description", "priceMonthly", "priceYearly", "currency", "trialDays"];
  for (const field of fields) {
    if (String(before[field]) !== String(after[field])) {
      lines.push(`${field}: ${String(before[field]) || "—"} → ${String(after[field]) || "—"}`);
    }
  }
  for (const next of after.entitlements) {
    const previous = before.entitlements.find((row) => row.key === next.key);
    if (!previous) continue;
    const prevLine = formatEntitlementLine(previous);
    const nextLine = formatEntitlementLine(next);
    if (prevLine !== nextLine) {
      lines.push(`${entitlementLabel(next.key)}: ${formatEntitlementValue({
        valueType: previous.valueType,
        intValue: previous.valueType === "LIMIT" ? Number(previous.intValue) : null,
        boolValue: previous.boolValue ?? null,
      })} → ${formatEntitlementValue({
        valueType: next.valueType,
        intValue: next.valueType === "LIMIT" ? Number(next.intValue) : null,
        boolValue: next.boolValue ?? null,
      })}`);
    }
  }
  return lines;
}
