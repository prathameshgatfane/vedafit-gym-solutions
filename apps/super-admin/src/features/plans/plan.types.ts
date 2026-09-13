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
  entitlements: EntitlementRow[];
}
