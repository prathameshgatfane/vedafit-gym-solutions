import type { ListParams } from "../../lib/url-list-params";

export type PlanStatus = "ACTIVE" | "INACTIVE";

/** Mirrors `MembershipPlanResponse` in apps/api/src/modules/membership-plans/membership-plan.service.ts. */
export interface MembershipPlan {
  id: string;
  organizationId: string;
  name: string;
  /** A fixed-2 decimal string, never a float — the API is deliberate about this. Format, don't compute. */
  price: string;
  durationDays: number;
  status: PlanStatus;
  createdAt: string;
  updatedAt: string;
}

export type PlanSortField = "name" | "price" | "durationDays" | "createdAt";

export type PlanListParams = ListParams<PlanSortField, PlanStatus>;

export const DEFAULT_PLAN_LIST_PARAMS: PlanListParams = {
  page: 1,
  limit: 10,
  search: "",
  status: "",
  sortBy: "name",
  sortOrder: "asc",
};

// Moved to lib/money.ts in Phase 6, when invoices and payments became callers too. Re-exported
// here so the screens that already import them from the plans module keep working.
export { formatDuration, formatPrice } from "../../lib/money";
