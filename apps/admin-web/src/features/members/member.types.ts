export type MemberStatus = "ACTIVE" | "INACTIVE" | "ARCHIVED";

/** Mirrors `MemberResponse` in apps/api/src/modules/members/member.service.ts. */
export interface Member {
  id: string;
  organizationId: string;
  branchId: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  /** `YYYY-MM-DD`, not an ISO instant — the API serializes it that way on purpose. */
  dateOfBirth: string | null;
  status: MemberStatus;
  createdAt: string;
  updatedAt: string;
}

export type MemberSortField = "createdAt" | "firstName" | "lastName" | "phone";

/** The Section 1.9 list convention, as the UI holds it. */
export interface MemberListParams {
  page: number;
  limit: number;
  search: string;
  status: MemberStatus | "";
  sortBy: MemberSortField;
  sortOrder: "asc" | "desc";
}

export const DEFAULT_LIST_PARAMS: MemberListParams = {
  page: 1,
  limit: 10,
  search: "",
  status: "",
  sortBy: "createdAt",
  sortOrder: "desc",
};
