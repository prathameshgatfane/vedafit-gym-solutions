import type { ListParams } from "../../lib/url-list-params";

export type MembershipStatus = "ACTIVE" | "EXPIRED" | "FROZEN" | "CANCELLED";

/** Mirrors `MembershipResponse` in apps/api/src/modules/memberships/membership.service.ts. */
export interface Membership {
  id: string;
  organizationId: string;
  branchId: string;
  memberId: string;
  planId: string;
  /** Fixed-2 decimal string — the frozen price this term was sold at. Format, don't compute. */
  priceAtPurchase: string;
  durationDaysAtPurchase: number;
  /** `YYYY-MM-DD` calendar dates, not instants. `endDate` is the last day of access, inclusive. */
  startDate: string;
  endDate: string;
  status: MembershipStatus;
  frozenAt: string | null;
  totalFrozenDays: number;
  previousMembershipId: string | null;
  createdAt: string;
  updatedAt: string;
  /** A renewal bought before the current term ends is ACTIVE but not yet live. */
  isUpcoming: boolean;
  daysRemaining: number;
  member: { id: string; firstName: string; lastName: string; phone: string };
  plan: { id: string; name: string; status: "ACTIVE" | "INACTIVE" };
}

export type MembershipSortField = "startDate" | "endDate" | "createdAt";

export type MembershipListParams = ListParams<MembershipSortField, MembershipStatus>;

export const DEFAULT_MEMBERSHIP_LIST_PARAMS: MembershipListParams = {
  page: 1,
  limit: 10,
  search: "",
  status: "",
  sortBy: "endDate",
  sortOrder: "asc",
};

/**
 * Locked Decision 1.15.1, restated for the UI so a button is only offered when the API would
 * actually accept it. The server is still the authority — this just avoids presenting moves that
 * are guaranteed to fail.
 */
export function availableActions(membership: Membership): {
  canRenew: boolean;
  canChangePlan: boolean;
  canFreeze: boolean;
  canUnfreeze: boolean;
  canCancel: boolean;
} {
  const { status } = membership;
  return {
    canRenew: status === "ACTIVE" || status === "EXPIRED",
    canChangePlan: status === "ACTIVE",
    canFreeze: status === "ACTIVE",
    canUnfreeze: status === "FROZEN",
    canCancel: status === "ACTIVE" || status === "FROZEN",
  };
}
