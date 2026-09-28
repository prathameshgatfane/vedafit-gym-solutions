import type { EntitlementRow } from "../organizations/organization.types";

export interface SaasPlan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceMonthly: string;
  priceYearly: string;
  currency: string;
  trialDays: number;
  isActive: boolean;
  organizationCount?: number;
  createdAt?: string;
  updatedAt?: string;
  entitlements: EntitlementRow[];
}

export interface SaasPlanEntitlementInput {
  key: string;
  valueType: EntitlementRow["valueType"];
  intValue?: number | null;
  boolValue?: boolean | null;
}

export interface CreateSaasPlanInput {
  code: string;
  name: string;
  description?: string | null;
  priceMonthly: string;
  priceYearly: string;
  currency: string;
  trialDays: number;
  entitlements: SaasPlanEntitlementInput[];
}

export interface UpdateSaasPlanInput {
  name?: string;
  description?: string | null;
  priceMonthly?: string;
  priceYearly?: string;
  currency?: string;
  trialDays?: number;
  entitlements?: SaasPlanEntitlementInput[];
}
