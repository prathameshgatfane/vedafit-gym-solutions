export type OrganizationStatus = "ACTIVE" | "SUSPENDED";
export type SubscriptionStatus = "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELLED";
export type OrganizationSortField = "createdAt" | "name" | "slug";

export interface OrganizationListItem {
  id: string;
  name: string;
  slug: string;
  email: string;
  phone: string | null;
  status: OrganizationStatus;
  timezone: string;
  createdAt: string;
  subscription: {
    status: SubscriptionStatus;
    planCode: string;
    currentPeriodEnd: string;
  } | null;
}

export interface OrganizationDetail {
  organization: {
    id: string;
    name: string;
    slug: string;
    email: string;
    phone: string | null;
    status: OrganizationStatus;
    timezone: string;
    createdAt: string;
    updatedAt: string;
  };
  owner: { email: string } | null;
  subscription: {
    id: string;
    status: SubscriptionStatus;
    billingInterval: "MONTHLY" | "YEARLY";
    priceSnapshot: string;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    plan: { id: string; code: string; name: string };
  } | null;
  entitlements: EntitlementRow[];
}

export interface EntitlementRow {
  key: string;
  valueType: "BOOLEAN" | "LIMIT" | "UNLIMITED";
  intValue: number | null;
  boolValue: boolean | null;
}

export interface CreatedOrganization {
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
  subscription?: { id: string; planCode: string; status: string };
  credentials?: { email: string; temporaryPassword: string };
}

export interface OrganizationListQuery {
  page: number;
  limit: number;
  search?: string;
  status?: OrganizationStatus;
  sortBy: OrganizationSortField;
  sortOrder: "asc" | "desc";
}

export interface SubscriptionPatchInput {
  planId?: string;
  status?: SubscriptionStatus;
  billingInterval?: "MONTHLY" | "YEARLY";
  currentPeriodEnd?: string;
}

export interface CountUsage {
  used: number;
  limit: number | null;
  unlimited: boolean;
  remaining: number | null;
  overLimit: boolean;
}

export interface UnavailableUsage {
  available: false;
  reason: string;
}

export type UsageMetric = CountUsage | UnavailableUsage;

export interface FeatureFlag {
  enabled: boolean;
}

export interface OrganizationUsage {
  organization: { id: string; name: string; slug: string };
  subscription: {
    id: string;
    status: string;
    billingInterval: string;
    plan: { id: string; code: string; name: string };
  } | null;
  usage: {
    members: UsageMetric;
    branches: UsageMetric;
    staff: UsageMetric;
    trainers: UsageMetric;
    leads: UsageMetric;
    storage: UsageMetric;
    monthlySms: UsageMetric;
    whatsapp: UsageMetric;
    onlinePayments: UsageMetric;
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
